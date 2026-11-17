package server_test

import (
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"testing"
)

func TestSignOutNeedsTheAppsOrigin(t *testing.T) {
	ts := newTestServer(t)
	for name, origin := range map[string]string{
		"no Origin":      "",
		"another site":   "https://evil.example",
		"null":           "null",
		"other scheme":   "https://" + ts.Listener.Addr().String(),
		"trailing slash": ts.URL + "/",
	} {
		t.Run(name, func(t *testing.T) {
			res := signOut(t, ts, origin)
			if res.StatusCode != http.StatusForbidden {
				t.Errorf("status = %d, want 403", res.StatusCode)
			}
			if c := cookie(res, sessionCookie); c != nil {
				t.Errorf("session cookie touched: %+v", c)
			}
		})
	}
}

func TestStateChangingAPIRequestsNeedTheAppsOrigin(t *testing.T) {
	ts := newTestServer(t)
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		req, _ := http.NewRequest(method, ts.URL+"/api/file?path=a.md", nil)
		req.Header.Set("Origin", "https://evil.example")
		res, body := ts.do(t, req)
		t.Run(method, func(t *testing.T) {
			assertError(t, res.StatusCode, body, http.StatusForbidden, "forbidden-origin")
		})
	}
}

func TestReadsNeedNoOrigin(t *testing.T) {
	ts := newTestServer(t)
	if res, body := get(t, ts, "/api/tree"); res.StatusCode != http.StatusOK {
		t.Errorf("status = %d, body %s", res.StatusCode, body)
	}
}

func TestEveryResponseCarriesTheSecurityHeaders(t *testing.T) {
	ts := newTestServer(t)
	signedOut := newSignedOutServer(t, nil)
	responses := map[string]*http.Response{}
	responses["app page"], _ = get(t, ts, "/")
	responses["client route"], _ = get(t, ts, "/signin?reason=signed-out")
	responses["asset"], _ = get(t, ts, "/assets/app-abc.js")
	responses["missing asset"], _ = get(t, ts, "/assets/gone.js")
	responses["API JSON"], _ = get(t, ts, "/api/tree")
	responses["API error"], _ = get(t, ts, "/api/file?path=..")
	responses["unknown API route"], _ = get(t, ts, "/api/nope")
	responses["unauthorized"], _ = get(t, signedOut, "/api/tree")
	responses["sign-in redirect"], _ = get(t, signedOut, "/auth/signin")
	responses["forbidden origin"] = signOut(t, ts, "https://evil.example")

	for name, res := range responses {
		t.Run(name, func(t *testing.T) {
			h := res.Header
			csp := h.Get("Content-Security-Policy")
			for _, d := range []string{"default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'"} {
				if !strings.Contains(csp, d) {
					t.Errorf("CSP %q lacks %q", csp, d)
				}
			}
			for _, bad := range []string{"unsafe-inline", "unsafe-eval", "*"} {
				if strings.Contains(csp, bad) {
					t.Errorf("CSP %q allows %q", csp, bad)
				}
			}
			if hsts := h.Get("Strict-Transport-Security"); !strings.HasPrefix(hsts, "max-age=") || hsts == "max-age=0" {
				t.Errorf("Strict-Transport-Security = %q", hsts)
			}
			if got := h.Get("X-Content-Type-Options"); got != "nosniff" {
				t.Errorf("X-Content-Type-Options = %q", got)
			}
			if got := h.Get("Referrer-Policy"); got != "same-origin" {
				t.Errorf("Referrer-Policy = %q", got)
			}
		})
	}
}

func TestLogsNeverRecordTokensCodesOrCookies(t *testing.T) {
	ts := newSignedOutServer(t, nil)
	start := ts.startSignIn(t)
	cb := callbackPath(t, start)
	u, _ := url.Parse(cb)
	oauth := cookie(start, oauthCookie)
	res := ts.callback(t, cb, oauth)
	ts.session = cookie(res, sessionCookie)
	get(t, ts, "/api/tree")
	get(t, ts, "/api/file?path=missing.md")
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/tree", nil)
	req.Header.Set("Authorization", "Bearer secret-bearer-token")
	ts.do(t, req)
	ts.fake.Revoke()
	get(t, ts, "/api/tree") // a logged Dropbox failure
	signOut(t, ts, ts.URL)
	token, _ := ts.storedToken(t)

	logs := ts.logs.String()
	for name, secret := range map[string]string{
		"OAuth code":     u.Query().Get("code"),
		"OAuth state":    u.Query().Get("state"),
		"OAuth cookie":   oauth.Value,
		"session cookie": ts.session.Value,
		"refresh token":  token,
		"bearer token":   "secret-bearer-token",
	} {
		if secret == "" {
			t.Fatalf("%s is empty; the test is broken", name)
		}
		if strings.Contains(logs, secret) {
			t.Errorf("logs contain the %s", name)
		}
	}
	// The log is not just empty: requests are recorded.
	for _, want := range []string{"/auth/callback", "/api/tree", "status=401"} {
		if !strings.Contains(logs, want) {
			t.Errorf("logs lack %q:\n%s", want, logs)
		}
	}
}

var nonceMeta = regexp.MustCompile(`<meta name="csp-nonce" content="([A-Za-z0-9_-]{22,})">`)

// The editor's styles are injected as a <style> element, so the app page
// carries a fresh nonce that its CSP allows for styles (and nothing else).
func TestTheAppPageCarriesAFreshStyleNonce(t *testing.T) {
	ts := newTestServer(t)
	seen := map[string]bool{}
	for _, path := range []string{"/", "/signin", "/index.html"} {
		res, body := get(t, ts, path)
		m := nonceMeta.FindStringSubmatch(body)
		if m == nil {
			t.Fatalf("%s: no nonce meta in %s", path, body)
		}
		nonce := m[1]
		if seen[nonce] {
			t.Errorf("%s: nonce %q reused", path, nonce)
		}
		seen[nonce] = true
		csp := res.Header.Get("Content-Security-Policy")
		if !strings.Contains(csp, "style-src 'self' 'nonce-"+nonce+"'") {
			t.Errorf("%s: CSP %q does not allow the nonce for styles", path, csp)
		}
		if strings.Count(csp, nonce) != 1 {
			t.Errorf("%s: the nonce must be allowed for styles only: %q", path, csp)
		}
		if cc := res.Header.Get("Cache-Control"); cc != "no-store" {
			t.Errorf("%s: Cache-Control = %q; a cached page would reuse its nonce", path, cc)
		}
	}
}
