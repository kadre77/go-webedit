package server_test

import (
	"errors"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/kadre77/webedit/internal/dropbox"
	"github.com/kadre77/webedit/internal/server"
	"github.com/kadre77/webedit/internal/tokenstore"
)

const (
	sessionCookie = "webedit_session"
	oauthCookie   = "webedit_oauth"
	thirtyDays    = 30 * 24 * time.Hour
)

// cookie returns the named cookie a response sets, or nil.
func cookie(res *http.Response, name string) *http.Cookie {
	for _, c := range res.Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

// startSignIn requests the sign-in start and returns the response: a
// redirect to the authorize URL (with the fake, that is straight back to the
// callback with a code) that sets the short-lived OAuth cookie.
func (ts *testServer) startSignIn(t *testing.T) *http.Response {
	t.Helper()
	res, body := get(t, ts, "/auth/signin")
	if res.StatusCode != http.StatusFound && res.StatusCode != http.StatusSeeOther {
		t.Fatalf("sign-in start: status = %d, body %s", res.StatusCode, body)
	}
	return res
}

// callbackPath turns the authorize redirect into a request path on the
// test server.
func callbackPath(t *testing.T, res *http.Response) string {
	t.Helper()
	u, err := url.Parse(res.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	return u.RequestURI()
}

// callback requests path with the given OAuth cookie (which may be nil).
func (ts *testServer) callback(t *testing.T, path string, oauth *http.Cookie) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, ts.URL+path, nil)
	if oauth != nil {
		req.AddCookie(oauth)
	}
	res, _ := ts.do(t, req)
	return res
}

// signIn runs the whole sign-in flow and returns the callback's response.
// If it issues a session, the server keeps sending it.
func (ts *testServer) signIn(t *testing.T) *http.Response {
	t.Helper()
	start := ts.startSignIn(t)
	res := ts.callback(t, callbackPath(t, start), cookie(start, oauthCookie))
	if c := cookie(res, sessionCookie); c != nil && c.MaxAge > 0 {
		ts.session = c
	}
	return res
}

// storedToken reopens the token file the way a restarted server would.
func (ts *testServer) storedToken(t *testing.T) (string, error) {
	t.Helper()
	s, err := tokenstore.Open(ts.tokenPath, tokenKey)
	if err != nil {
		t.Fatal(err)
	}
	return s.RefreshToken()
}

func assertRedirect(t *testing.T, res *http.Response, want string) {
	t.Helper()
	if res.StatusCode != http.StatusSeeOther && res.StatusCode != http.StatusFound {
		t.Errorf("status = %d, want a redirect to %s", res.StatusCode, want)
	}
	if got := res.Header.Get("Location"); got != want {
		t.Errorf("Location = %q, want %q", got, want)
	}
}

func TestSignInAsTheOwnerStartsASession(t *testing.T) {
	ts := newSignedOutServer(t, nil)
	res := ts.signIn(t)
	assertRedirect(t, res, "/")

	c := cookie(res, sessionCookie)
	if c == nil {
		t.Fatal("no session cookie")
	}
	if !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteLaxMode || c.Path != "/" {
		t.Errorf("cookie flags: HttpOnly %v, Secure %v, SameSite %v, Path %q", c.HttpOnly, c.Secure, c.SameSite, c.Path)
	}
	if c.MaxAge != int(thirtyDays.Seconds()) {
		t.Errorf("Max-Age = %d, want 30 days", c.MaxAge)
	}
	if strings.Contains(c.Value, "refresh") {
		t.Errorf("session cookie holds the refresh token: %s", c.Value)
	}

	if _, body := get(t, ts, "/api/session"); !strings.Contains(body, `"signedIn":true`) {
		t.Errorf("session API: %s", body)
	}
	if res, body := get(t, ts, "/api/tree"); res.StatusCode != http.StatusOK {
		t.Errorf("tree: status = %d, body %s", res.StatusCode, body)
	}
	if tok, err := ts.storedToken(t); err != nil || !strings.HasPrefix(tok, "fake-refresh-token") {
		t.Errorf("stored token = %q, %v", tok, err)
	}
	if res := cookie(res, oauthCookie); res == nil || res.MaxAge >= 0 {
		t.Errorf("the OAuth cookie is not cleared: %+v", res)
	}
}

// recordingPort records the authorize request the server makes.
type recordingPort struct {
	*dropbox.Fake
	state, challenge, redirectURI string
}

func (p *recordingPort) AuthorizeURL(state, challenge, redirectURI string) string {
	p.state, p.challenge, p.redirectURI = state, challenge, redirectURI
	return p.Fake.AuthorizeURL(state, challenge, redirectURI)
}

func TestSignInStartUsesPKCEAndAFreshStateBoundToTheBrowser(t *testing.T) {
	fake, _ := dropbox.NewFake(ownerID, nil)
	rec := &recordingPort{Fake: fake}
	ts := startServer(t, fake, filepath.Join(t.TempDir(), "refresh-token"),
		func(o *server.Options) { o.Dropbox = rec })

	res := ts.startSignIn(t)
	if rec.redirectURI != ts.URL+"/auth/callback" {
		t.Errorf("redirect URI = %q", rec.redirectURI)
	}
	if len(rec.challenge) != 43 || strings.ContainsAny(rec.challenge, "+/=") {
		t.Errorf("challenge %q is not an unpadded base64url SHA-256", rec.challenge)
	}
	if len(rec.state) < 32 {
		t.Errorf("state %q is too short to be unguessable", rec.state)
	}
	c := cookie(res, oauthCookie)
	if c == nil {
		t.Fatal("no OAuth cookie")
	}
	if !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteLaxMode {
		t.Errorf("cookie flags: HttpOnly %v, Secure %v, SameSite %v", c.HttpOnly, c.Secure, c.SameSite)
	}
	if c.MaxAge <= 0 || c.MaxAge > 15*60 {
		t.Errorf("OAuth cookie Max-Age = %d, want short-lived", c.MaxAge)
	}

	first := rec.state
	ts.startSignIn(t)
	if rec.state == first {
		t.Error("two sign-ins got the same state")
	}
}

func assertNotSignedIn(t *testing.T, ts *testServer, res *http.Response) {
	t.Helper()
	if c := cookie(res, sessionCookie); c != nil && c.MaxAge > 0 {
		t.Errorf("a session cookie was issued")
	}
	if _, err := ts.storedToken(t); !errors.Is(err, tokenstore.ErrNoToken) {
		t.Errorf("a refresh token was stored (err = %v)", err)
	}
}

func TestCallbackRefusesAMissingOrMismatchedState(t *testing.T) {
	ts := newSignedOutServer(t, nil)
	withState := func(path, state string) string {
		u, _ := url.Parse(path)
		q := u.Query()
		if state == "" {
			q.Del("state")
		} else {
			q.Set("state", state)
		}
		u.RawQuery = q.Encode()
		return u.RequestURI()
	}
	cases := map[string]func() (string, *http.Cookie){
		"no cookie": func() (string, *http.Cookie) {
			return callbackPath(t, ts.startSignIn(t)), nil
		},
		"cookie from another sign-in": func() (string, *http.Cookie) {
			a, b := ts.startSignIn(t), ts.startSignIn(t)
			return callbackPath(t, a), cookie(b, oauthCookie)
		},
		"state missing": func() (string, *http.Cookie) {
			res := ts.startSignIn(t)
			return withState(callbackPath(t, res), ""), cookie(res, oauthCookie)
		},
		"state changed": func() (string, *http.Cookie) {
			res := ts.startSignIn(t)
			return withState(callbackPath(t, res), "attacker-state"), cookie(res, oauthCookie)
		},
		"tampered cookie": func() (string, *http.Cookie) {
			res := ts.startSignIn(t)
			c := cookie(res, oauthCookie)
			c.Value = "x" + c.Value
			return callbackPath(t, res), c
		},
		"expired cookie": func() (string, *http.Cookie) {
			res := ts.startSignIn(t)
			ts.now = ts.now.Add(11 * time.Minute)
			return callbackPath(t, res), cookie(res, oauthCookie)
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			path, oauth := c()
			res := ts.callback(t, path, oauth)
			assertRedirect(t, res, "/signin?reason=invalid-state")
			assertNotSignedIn(t, ts, res)
		})
	}
}

func TestOtherDropboxAccountsAreRefused(t *testing.T) {
	ts := newSignedOutServer(t, nil)
	ts.fake.SignInAs("dbid:stranger")
	res := ts.signIn(t)
	assertRedirect(t, res, "/signin?reason=not-owner")
	assertNotSignedIn(t, ts, res)
}

func TestARefusedAccountDoesNotReplaceTheOwnersToken(t *testing.T) {
	ts := newTestServer(t)
	before, _ := ts.storedToken(t)
	ts.session = nil
	ts.fake.SignInAs("dbid:stranger")
	ts.signIn(t)
	if after, err := ts.storedToken(t); err != nil || after != before {
		t.Errorf("token = %q, %v; want the Owner's %q", after, err, before)
	}
}

func TestDenyingAtDropboxIsReported(t *testing.T) {
	ts := newSignedOutServer(t, nil)
	start := ts.startSignIn(t)
	u, _ := url.Parse(callbackPath(t, start))
	q := url.Values{"state": {u.Query().Get("state")}, "error": {"access_denied"}}
	res := ts.callback(t, u.Path+"?"+q.Encode(), cookie(start, oauthCookie))
	assertRedirect(t, res, "/signin?reason=denied")
	assertNotSignedIn(t, ts, res)
}

func TestARejectedCodeIsReported(t *testing.T) {
	ts := newSignedOutServer(t, nil)
	start := ts.startSignIn(t)
	path := callbackPath(t, start)
	ts.callback(t, path, cookie(start, oauthCookie)) // uses up the code
	res := ts.callback(t, path, cookie(start, oauthCookie))
	assertRedirect(t, res, "/signin?reason=failed")
	if c := cookie(res, sessionCookie); c != nil && c.MaxAge > 0 {
		t.Error("a session cookie was issued")
	}
}

func TestAPIRoutesNeedASession(t *testing.T) {
	ts := newSignedOutServer(t, fstest.MapFS{"a.md": {Data: []byte("a")}})
	for _, path := range []string{"/api/tree", "/api/file?path=a.md"} {
		res, body := get(t, ts, path)
		assertError(t, res.StatusCode, body, http.StatusUnauthorized, "unauthorized")
	}
	if res, _ := get(t, ts, "/api/health"); res.StatusCode != http.StatusOK {
		t.Errorf("health: status = %d", res.StatusCode)
	}
	if res, body := get(t, ts, "/api/session"); res.StatusCode != http.StatusOK || !strings.Contains(body, `"signedIn":false`) {
		t.Errorf("session: status = %d, body %s", res.StatusCode, body)
	}
}

func assertSessionRefused(t *testing.T, ts *testServer) {
	t.Helper()
	res, body := get(t, ts, "/api/tree")
	assertError(t, res.StatusCode, body, http.StatusUnauthorized, "unauthorized")
	if _, body := get(t, ts, "/api/session"); !strings.Contains(body, `"signedIn":false`) {
		t.Errorf("session API: %s", body)
	}
}

func TestATamperedSessionIsRefused(t *testing.T) {
	ts := newTestServer(t)
	v := ts.session.Value
	flip := func(i int) string {
		b := []byte(v)
		if b[i] == 'A' {
			b[i] = 'B'
		} else {
			b[i] = 'A'
		}
		return string(b)
	}
	for name, value := range map[string]string{
		"first character changed":  flip(0),
		"middle character changed": flip(len(v) / 2),
		"last character changed":   flip(len(v) - 1),
		"truncated":                v[:len(v)-4],
		"garbage":                  "not-a-session",
	} {
		t.Run(name, func(t *testing.T) {
			ts.session = &http.Cookie{Name: sessionCookie, Value: value}
			assertSessionRefused(t, ts)
		})
	}
}

func TestASessionLastsThirtyDays(t *testing.T) {
	ts := newTestServer(t)
	ts.now = ts.now.Add(thirtyDays - time.Minute)
	if res, _ := get(t, ts, "/api/tree"); res.StatusCode != http.StatusOK {
		t.Fatalf("just before 30 days: status = %d", res.StatusCode)
	}
	ts.now = ts.now.Add(2 * time.Minute)
	assertSessionRefused(t, ts)
}

func TestRotatingTheSessionSecretEndsEverySession(t *testing.T) {
	ts := newTestServer(t)
	rotated := startServer(t, ts.fake, ts.tokenPath, func(o *server.Options) {
		o.SessionSecret = []byte("a-brand-new-session-secret-0123456789")
	})
	rotated.session = ts.session
	assertSessionRefused(t, rotated)
}

func signOut(t *testing.T, ts *testServer, origin string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/auth/signout", nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	res, _ := ts.do(t, req)
	return res
}

func TestSignOutClearsTheSession(t *testing.T) {
	ts := newTestServer(t)
	res := signOut(t, ts, ts.URL)
	assertRedirect(t, res, "/signin?reason=signed-out")
	c := cookie(res, sessionCookie)
	if c == nil || c.MaxAge >= 0 || c.Value != "" {
		t.Errorf("session cookie not cleared: %+v", c)
	}
}

func TestRevokedDropboxAuthorizationAsksToSignInAgain(t *testing.T) {
	ts := newTestServer(t)
	ts.fake.Revoke()
	res, body := get(t, ts, "/api/tree")
	assertError(t, res.StatusCode, body, http.StatusUnauthorized, "reauthorize")

	ts.session = nil
	ts.signIn(t)
	if res, body := get(t, ts, "/api/tree"); res.StatusCode != http.StatusOK {
		t.Errorf("after signing in again: status = %d, body %s", res.StatusCode, body)
	}
}

func TestChangingTheConfiguredOwnerEndsTheOldOwnersSessions(t *testing.T) {
	ts := newTestServer(t)
	changed := startServer(t, ts.fake, ts.tokenPath, func(o *server.Options) {
		o.OwnerAccountID = "dbid:new-owner"
	})
	changed.session = ts.session
	assertSessionRefused(t, changed)
}
