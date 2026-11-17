// Package server builds the HTTP server: the JSON API under /api and the
// embedded Solid app everywhere else.
package server

import (
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/kadre77/webedit/internal/dropbox"
)

const indexPage = "index.html"

// Options configure the server.
type Options struct {
	Frontend       fs.FS // the built Solid app, with index.html at its root
	Dropbox        dropbox.Port
	Tokens         TokenSaver // where sign-in stores the refresh token
	OwnerAccountID string     // the only Dropbox account allowed to sign in
	BaseURL        *url.URL   // public base URL, scheme and host only
	SessionSecret  []byte
	Now            func() time.Time // defaults to time.Now
	Logger         *slog.Logger     // defaults to slog.Default()
	// TestFake, set only in test mode, is the fake Dropbox behind Dropbox.
	// It enables a hook that changes files in it as another device would.
	TestFake *dropbox.Fake
}

// New returns the server's HTTP handler.
func New(o Options) *echo.Echo {
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.Logger == nil {
		o.Logger = slog.Default()
	}
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	e.HTTPErrorHandler = errorHandler(o.Logger)
	e.Use(logRequests(o.Logger), securityHeaders, requireOrigin(o.BaseURL.String()))

	a := &auth{
		port:    o.Dropbox,
		tokens:  o.Tokens,
		owner:   o.OwnerAccountID,
		baseURL: o.BaseURL,
		sign:    signer{secret: o.SessionSecret},
		now:     o.Now,
		log:     o.Logger,
	}
	e.GET("/auth/signin", a.start)
	e.GET(callbackPath, a.callback)
	e.POST("/auth/signout", a.signOut)

	api := e.Group("/api")
	api.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})
	api.GET("/session", a.session)
	fh := &fileHandlers{port: o.Dropbox, now: o.Now}
	api.GET("/tree", fh.tree, a.requireSession)
	api.GET("/file", fh.open, a.requireSession)
	api.PUT("/file", fh.save, a.requireSession)
	api.GET("/file/rev", fh.check, a.requireSession)
	api.POST("/file/copy", fh.saveCopy, a.requireSession)
	api.POST("/files", fh.createFile, a.requireSession)
	api.POST("/folders", fh.createFolder, a.requireSession)
	api.POST("/move", fh.move, a.requireSession)
	api.DELETE("/entry", fh.delete, a.requireSession)
	if o.TestFake != nil {
		api.PUT("/test/file", changeFakeFile(o.TestFake), a.requireSession)
		api.DELETE("/test/file", deleteFakeFile(o.TestFake), a.requireSession)
	}
	notFound := func(echo.Context) error { return echo.ErrNotFound }
	e.Any("/api", notFound)
	api.Any("/*", notFound)

	e.GET("/*", serveApp(o.Frontend))
	return e
}

// serveApp serves files from the frontend build, and the app page for any
// other path so the Solid app can route on the client. Missing files under
// /assets/ are 404s instead: a stale hashed bundle must not come back as HTML.
func serveApp(frontend fs.FS) echo.HandlerFunc {
	return func(c echo.Context) error {
		name := strings.TrimPrefix(path.Clean("/"+c.Request().URL.Path), "/")
		if name != "" && name != indexPage {
			if fi, err := fs.Stat(frontend, name); err == nil && fi.Mode().IsRegular() {
				http.ServeFileFS(c.Response(), c.Request(), frontend, name)
				return nil
			}
			if strings.HasPrefix(name, "assets/") {
				return echo.ErrNotFound
			}
		}
		return serveIndex(c, frontend)
	}
}

// serveIndex serves index.html with a fresh CSP nonce, in a meta tag for the
// editor and in the page's Content-Security-Policy. The page is never
// cached, so a nonce is never reused.
func serveIndex(c echo.Context, frontend fs.FS) error {
	page, err := fs.ReadFile(frontend, indexPage)
	if err != nil {
		return err
	}
	nonce := randomToken()
	meta := `<meta name="csp-nonce" content="` + nonce + `">`
	html := strings.Replace(string(page), "</head>", meta+"</head>", 1)
	h := c.Response().Header()
	h.Set("Content-Security-Policy", contentSecurityPolicy(nonce))
	h.Set("Cache-Control", "no-store")
	return c.HTML(http.StatusOK, html)
}

// apiError is the one JSON error shape the API uses.
type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Rev     string `json:"rev,omitempty"` // a conflict's current revision
}

// errorCodes maps HTTP statuses that Echo raises on its own to API codes.
var errorCodes = map[int]string{
	http.StatusNotFound:         "not-found",
	http.StatusMethodNotAllowed: "method-not-allowed",
}

func errorHandler(log *slog.Logger) echo.HTTPErrorHandler {
	return func(err error, c echo.Context) { handleError(log, err, c) }
}

func handleError(log *slog.Logger, err error, c echo.Context) {
	if c.Response().Committed {
		return
	}
	status, message := http.StatusInternalServerError, "internal error"
	var ae *Error
	var he *echo.HTTPError
	if errors.As(err, &ae) {
		if ae.Err != nil {
			log.Error("request failed", "code", ae.Code, "err", ae.Err)
		}
		writeError(log, c, ae.Status, apiError{Code: ae.Code, Message: ae.Message, Rev: ae.Rev})
		return
	}
	if errors.As(err, &he) {
		status = he.Code
		if m, ok := he.Message.(string); ok {
			message = m
		}
	} else {
		log.Error("request failed", "err", err)
	}
	code, ok := errorCodes[status]
	if !ok {
		code = "internal"
		if status < http.StatusInternalServerError {
			code = "bad-request"
		}
	}
	writeError(log, c, status, apiError{Code: code, Message: message})
}

func writeError(log *slog.Logger, c echo.Context, status int, body apiError) {
	var err error
	if c.Request().Method == http.MethodHead {
		err = c.NoContent(status)
	} else {
		err = c.JSON(status, body)
	}
	if err != nil {
		log.Error("writing error response", "err", err)
	}
}

// Error is an API failure with a machine-readable code. Handlers return it
// and the error handler writes it in the one JSON error shape.
type Error struct {
	Status  int
	Code    string
	Message string
	Rev     string // for a Save Conflict, the file's current revision
	Err     error  // the underlying cause, logged but never sent
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func (e *Error) Unwrap() error { return e.Err }

// changeFakeFile is the test-mode hook: it writes a file in the fake
// Dropbox as another device would, so browser tests can provoke Save
// Conflicts and outside changes. The body is {path, content}, content
// written as is.
func changeFakeFile(fake *dropbox.Fake) echo.HandlerFunc {
	return func(c echo.Context) error {
		var req contentRequest
		if err := decodeContentBody(c, &req); err != nil {
			return err
		}
		p, err := cleanPath(req.Path)
		if err != nil {
			return err
		}
		e, err := fake.Write(p, []byte(req.Content))
		if err != nil {
			return dropboxError(err)
		}
		return c.JSON(http.StatusOK, fileRev{Path: apiPath(e.Path), Rev: e.Rev})
	}
}

// deleteFakeFile is the test-mode hook that deletes a file in the fake
// Dropbox as another device would, so browser tests can reopen a Tab whose
// file is gone. The path is the "path" query parameter.
func deleteFakeFile(fake *dropbox.Fake) echo.HandlerFunc {
	return func(c echo.Context) error {
		p, err := cleanPath(c.QueryParam("path"))
		if err != nil {
			return err
		}
		if err := fake.Delete(c.Request().Context(), p); err != nil {
			return dropboxError(err)
		}
		return c.NoContent(http.StatusNoContent)
	}
}
