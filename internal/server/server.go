// Package server builds the HTTP server: the JSON API under /api and the
// embedded Solid app everywhere else.
package server

import (
	"errors"
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/kadre77/webedit/internal/dropbox"
)

const indexPage = "index.html"

// New returns the server's HTTP handler. frontend holds the built Solid app,
// with index.html at its root.
func New(frontend fs.FS, port dropbox.Port) *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	e.HTTPErrorHandler = handleError

	api := e.Group("/api")
	api.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})
	fh := &fileHandlers{port: port}
	api.GET("/tree", fh.tree)
	api.GET("/file", fh.open)
	notFound := func(echo.Context) error { return echo.ErrNotFound }
	e.Any("/api", notFound)
	api.Any("/*", notFound)

	e.GET("/*", serveApp(frontend))
	return e
}

// serveApp serves files from the frontend build, and index.html for any other
// path so the Solid app can route on the client. Missing files under
// /assets/ are 404s instead: a stale hashed bundle must not come back as HTML.
func serveApp(frontend fs.FS) echo.HandlerFunc {
	return func(c echo.Context) error {
		name := strings.TrimPrefix(path.Clean("/"+c.Request().URL.Path), "/")
		if name != "" {
			if fi, err := fs.Stat(frontend, name); err == nil && fi.Mode().IsRegular() {
				return serveFile(c, frontend, name)
			}
			if strings.HasPrefix(name, "assets/") {
				return echo.ErrNotFound
			}
		}
		return serveFile(c, frontend, indexPage)
	}
}

func serveFile(c echo.Context, fsys fs.FS, name string) error {
	http.ServeFileFS(c.Response(), c.Request(), fsys, name)
	return nil
}

// apiError is the one JSON error shape the API uses.
type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// errorCodes maps HTTP statuses that Echo raises on its own to API codes.
var errorCodes = map[int]string{
	http.StatusNotFound:         "not-found",
	http.StatusMethodNotAllowed: "method-not-allowed",
}

func handleError(err error, c echo.Context) {
	if c.Response().Committed {
		return
	}
	status, message := http.StatusInternalServerError, "internal error"
	var ae *Error
	var he *echo.HTTPError
	if errors.As(err, &ae) {
		if ae.Err != nil {
			c.Logger().Error(ae.Err)
		}
		writeError(c, ae.Status, ae.Code, ae.Message)
		return
	}
	if errors.As(err, &he) {
		status = he.Code
		if m, ok := he.Message.(string); ok {
			message = m
		}
	} else {
		c.Logger().Error(err)
	}
	code, ok := errorCodes[status]
	if !ok {
		code = "internal"
		if status < http.StatusInternalServerError {
			code = "bad-request"
		}
	}
	writeError(c, status, code, message)
}

func writeError(c echo.Context, status int, code, message string) {
	var err error
	if c.Request().Method == http.MethodHead {
		err = c.NoContent(status)
	} else {
		err = c.JSON(status, apiError{Code: code, Message: message})
	}
	if err != nil {
		c.Logger().Error(err)
	}
}

// Error is an API failure with a machine-readable code. Handlers return it
// and the error handler writes it in the one JSON error shape.
type Error struct {
	Status  int
	Code    string
	Message string
	Err     error // the underlying cause, logged but never sent
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func (e *Error) Unwrap() error { return e.Err }
