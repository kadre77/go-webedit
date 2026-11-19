package server

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

// contentSecurityPolicy allows only the app's own scripts, styles and
// requests: no inline script, no eval, no framing. styleNonce, when set, also
// allows <style> elements carrying it: CodeMirror injects its styles that way.
func contentSecurityPolicy(styleNonce string) string {
	style := "style-src 'self'"
	if styleNonce != "" {
		style += " 'nonce-" + styleNonce + "'"
	}
	return "default-src 'self'; script-src 'self'; " + style + "; " +
		"img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; " +
		"base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
}

// securityHeaders sets the security headers on every response.
func securityHeaders(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		h := c.Response().Header()
		h.Set("Content-Security-Policy", contentSecurityPolicy(""))
		h.Set("Strict-Transport-Security", "max-age=31536000")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("X-Frame-Options", "DENY")
		return next(c)
	}
}

// noStoreAPI forbids caching any API response, errors included: a browser
// that answered from its cache would hide a change made elsewhere, and file
// contents must not be kept in a browser or proxy cache. It sits ahead of
// the Origin check so that rejections carry it too.
func noStoreAPI(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		if p := c.Request().URL.Path; p == "/api" || strings.HasPrefix(p, "/api/") {
			c.Response().Header().Set("Cache-Control", "no-store")
		}
		return next(c)
	}
}

// logRequests logs one line per request: method, path, status and duration.
// It records the path only, never the query string (OAuth codes and state
// arrive there) or any header (cookies, authorization).
func logRequests(log *slog.Logger) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			start := time.Now()
			if err := next(c); err != nil {
				c.Error(err)
			}
			log.Info("request",
				"method", c.Request().Method,
				"path", c.Request().URL.Path,
				"status", c.Response().Status,
				"duration", time.Since(start).Round(time.Microsecond))
			return nil
		}
	}
}

var errForbiddenOrigin = &Error{
	Status:  http.StatusForbidden,
	Code:    "forbidden-origin",
	Message: "The request did not come from this app.",
}

// requireOrigin refuses state-changing requests whose Origin header is not
// exactly the public base URL, so another site can't make the Owner's
// browser change anything.
func requireOrigin(origin string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			switch c.Request().Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
			default:
				if c.Request().Header.Get("Origin") != origin {
					return errForbiddenOrigin
				}
			}
			return next(c)
		}
	}
}
