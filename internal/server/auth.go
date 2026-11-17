package server

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/kadre77/webedit/internal/dropbox"
)

const (
	sessionCookie   = "webedit_session"
	sessionLifetime = 30 * 24 * time.Hour
	oauthCookie     = "webedit_oauth"
	oauthLifetime   = 10 * time.Minute
	callbackPath    = "/auth/callback"

	sessionPurpose = "session"
	oauthPurpose   = "oauth"
)

// Reasons the sign-in page shows, passed as /signin?reason=...
const (
	reasonInvalidState = "invalid-state" // missing, expired or mismatched OAuth state
	reasonDenied       = "denied"        // the Owner said no at Dropbox
	reasonFailed       = "failed"        // the code exchange or saving the token failed
	reasonNotOwner     = "not-owner"     // a Dropbox account other than the Owner's
	reasonSignedOut    = "signed-out"
)

// TokenSaver stores the Owner's refresh token, replacing any earlier one.
type TokenSaver interface {
	Save(refreshToken string) error
}

// auth is the sign-in flow (Dropbox OAuth with PKCE, ADR 0002) and the
// signed session cookie.
type auth struct {
	port    dropbox.Port
	tokens  TokenSaver
	owner   string
	baseURL *url.URL
	sign    signer
	now     func() time.Time
	log     *slog.Logger
}

func (a *auth) redirectURI() string { return a.baseURL.String() + callbackPath }

func (a *auth) setCookie(c echo.Context, name, value, path string, maxAge time.Duration) {
	c.SetCookie(&http.Cookie{
		Name:     name,
		Value:    value,
		Path:     path,
		MaxAge:   int(maxAge.Seconds()),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
}

func (a *auth) clearCookie(c echo.Context, name, path string) {
	a.setCookie(c, name, "", path, -time.Second) // a negative Max-Age deletes it
}

func signInPage(reason string) string { return "/signin?reason=" + url.QueryEscape(reason) }

// start begins sign-in: it binds a fresh state and PKCE verifier to this
// browser in a short-lived signed cookie and sends the browser to Dropbox.
func (a *auth) start(c echo.Context) error {
	state, verifier := randomToken(), randomToken()
	expiry := a.now().Add(oauthLifetime).Unix()
	payload := state + "|" + verifier + "|" + strconv.FormatInt(expiry, 10)
	a.setCookie(c, oauthCookie, a.sign.sign(oauthPurpose, payload), callbackPath, oauthLifetime)
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	return c.Redirect(http.StatusSeeOther, a.port.AuthorizeURL(state, challenge, a.redirectURI()))
}

// callback finishes sign-in: it checks the state against the cookie,
// exchanges the code, accepts only the Owner's account, stores the refresh
// token and issues the session.
func (a *auth) callback(c echo.Context) error {
	a.clearCookie(c, oauthCookie, callbackPath)
	fail := func(reason string) error { return c.Redirect(http.StatusSeeOther, signInPage(reason)) }

	verifier, ok := a.checkState(c)
	if !ok {
		return fail(reasonInvalidState)
	}
	if c.QueryParam("error") != "" {
		return fail(reasonDenied)
	}
	ctx := c.Request().Context()
	tok, err := a.port.ExchangeCode(ctx, c.QueryParam("code"), verifier, a.redirectURI())
	if err != nil {
		a.log.Warn("sign-in: code exchange failed", "err", err)
		return fail(reasonFailed)
	}
	if subtle.ConstantTimeCompare([]byte(tok.AccountID), []byte(a.owner)) != 1 {
		a.log.Warn("sign-in: refused a Dropbox account that is not the Owner", "account_id", tok.AccountID)
		return fail(reasonNotOwner)
	}
	if err := a.tokens.Save(tok.RefreshToken); err != nil {
		a.log.Error("sign-in: saving the refresh token failed", "err", err)
		return fail(reasonFailed)
	}
	expiry := a.now().Add(sessionLifetime).Unix()
	a.setCookie(c, sessionCookie, a.sign.sign(sessionPurpose, a.owner+"|"+strconv.FormatInt(expiry, 10)), "/", sessionLifetime)
	return c.Redirect(http.StatusSeeOther, "/")
}

// checkState returns the PKCE verifier if the OAuth cookie is genuine,
// unexpired and bound to the state Dropbox sent back.
func (a *auth) checkState(c echo.Context) (verifier string, ok bool) {
	ck, err := c.Cookie(oauthCookie)
	if err != nil {
		return "", false
	}
	payload, ok := a.sign.verify(oauthPurpose, ck.Value)
	if !ok {
		return "", false
	}
	parts := strings.Split(payload, "|")
	if len(parts) != 3 || !a.unexpired(parts[2]) {
		return "", false
	}
	state := c.QueryParam("state")
	if state == "" || subtle.ConstantTimeCompare([]byte(state), []byte(parts[0])) != 1 {
		return "", false
	}
	return parts[1], true
}

func (a *auth) unexpired(unix string) bool {
	n, err := strconv.ParseInt(unix, 10, 64)
	return err == nil && a.now().Unix() < n
}

// signedIn reports whether the request carries a valid session: signed with
// the current secret, unexpired, and for the Owner's account.
func (a *auth) signedIn(c echo.Context) bool {
	ck, err := c.Cookie(sessionCookie)
	if err != nil {
		return false
	}
	payload, ok := a.sign.verify(sessionPurpose, ck.Value)
	if !ok {
		return false
	}
	account, expiry, ok := strings.Cut(payload, "|")
	return ok && account == a.owner && a.unexpired(expiry)
}

// signOut clears the session cookie.
func (a *auth) signOut(c echo.Context) error {
	a.clearCookie(c, sessionCookie, "/")
	return c.Redirect(http.StatusSeeOther, signInPage(reasonSignedOut))
}

// session is the session-status API.
func (a *auth) session(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]bool{"signedIn": a.signedIn(c)})
}

var errUnauthorized = &Error{Status: http.StatusUnauthorized, Code: "unauthorized", Message: "Sign in to continue."}

// requireSession refuses requests without a valid session.
func (a *auth) requireSession(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		if !a.signedIn(c) {
			return errUnauthorized
		}
		return next(c)
	}
}
