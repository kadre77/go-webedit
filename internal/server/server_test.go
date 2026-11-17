package server_test

import (
	"bytes"
	"encoding/json"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httptest"
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

const indexHTML = `<!doctype html><html><head><title>webedit</title></head><body><div id="root"></div></body></html>`

// isApp reports whether body is the app page (index.html, with the CSP
// nonce added).
func isApp(body string) bool {
	return strings.Contains(body, `<div id="root"></div>`) && strings.Contains(body, "<title>webedit</title>")
}

var (
	tokenKey      = bytes.Repeat([]byte{7}, 32)
	sessionSecret = []byte("test-session-secret-0123456789abcdef")
)

const ownerID = "dbid:owner"

// testServer is the real server running in-process, wired to a fake Dropbox,
// a token store in a temporary data directory, a clock the test controls
// and a captured log.
type testServer struct {
	*httptest.Server
	fake      *dropbox.Fake
	tokenPath string
	now       time.Time
	logs      *bytes.Buffer
	session   *http.Cookie // sent with every request when set
}

// serverOption adjusts the server's options before it starts.
type serverOption func(*server.Options)

// newSignedOutServer starts a server with a fake Dropbox seeded from seed
// (which may be nil) and no session.
func newSignedOutServer(t *testing.T, seed fs.FS, opts ...serverOption) *testServer {
	t.Helper()
	fake, err := dropbox.NewFake(ownerID, seed)
	if err != nil {
		t.Fatal(err)
	}
	return startServer(t, fake, filepath.Join(t.TempDir(), "data", "refresh-token"), opts...)
}

func startServer(t *testing.T, fake *dropbox.Fake, tokenPath string, opts ...serverOption) *testServer {
	t.Helper()
	tokens, err := tokenstore.Open(tokenPath, tokenKey)
	if err != nil {
		t.Fatal(err)
	}
	frontend := fstest.MapFS{
		"index.html":         {Data: []byte(indexHTML)},
		"assets/app-abc.js":  {Data: []byte(`console.log("app")`)},
		"assets/app-abc.css": {Data: []byte(`body{}`)},
	}
	ts := &testServer{
		Server:    httptest.NewUnstartedServer(nil),
		fake:      fake,
		tokenPath: tokenPath,
		now:       time.Date(2026, 11, 17, 12, 0, 0, 0, time.UTC),
		logs:      &bytes.Buffer{},
	}
	o := server.Options{
		Frontend:       frontend,
		Dropbox:        fake,
		Tokens:         tokens,
		OwnerAccountID: ownerID,
		BaseURL:        &url.URL{Scheme: "http", Host: ts.Listener.Addr().String()},
		SessionSecret:  sessionSecret,
		Now:            func() time.Time { return ts.now },
		Logger:         slog.New(slog.NewTextHandler(ts.logs, nil)),
	}
	for _, opt := range opts {
		opt(&o)
	}
	ts.Config.Handler = server.New(o)
	ts.Start()
	t.Cleanup(ts.Close)
	return ts
}

// newTestServer starts a signed-in server with an empty fake Dropbox.
func newTestServer(t *testing.T) *testServer {
	t.Helper()
	return newTestServerWith(t, nil)
}

// newTestServerWith starts a signed-in server with a fake Dropbox seeded
// from seed.
func newTestServerWith(t *testing.T, seed fs.FS) *testServer {
	t.Helper()
	ts := newSignedOutServer(t, seed)
	ts.signIn(t)
	if ts.session == nil {
		t.Fatal("signing in gave no session")
	}
	return ts
}

// do sends req to the server without following redirects, with the session
// cookie if there is one, and returns the response and its body.
func (ts *testServer) do(t *testing.T, req *http.Request) (*http.Response, string) {
	t.Helper()
	if ts.session != nil {
		req.AddCookie(ts.session)
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return res, string(body)
}

func get(t *testing.T, ts *testServer, path string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, ts.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	return ts.do(t, req)
}

func TestHealthCheckReportsOK(t *testing.T) {
	ts := newTestServer(t)
	res, body := get(t, ts, "/api/health")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, body %s", res.StatusCode, body)
	}
	var got map[string]string
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatalf("body is not JSON: %s", body)
	}
	if got["status"] != "ok" {
		t.Errorf("body = %s", body)
	}
}

func TestRootServesTheApp(t *testing.T) {
	ts := newTestServer(t)
	res, body := get(t, ts, "/")
	if res.StatusCode != http.StatusOK || !isApp(body) {
		t.Fatalf("status = %d, body %q", res.StatusCode, body)
	}
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("Content-Type = %q", ct)
	}
}

func TestBuiltAssetsAreServed(t *testing.T) {
	ts := newTestServer(t)
	res, body := get(t, ts, "/assets/app-abc.js")
	if res.StatusCode != http.StatusOK || body != `console.log("app")` {
		t.Fatalf("status = %d, body %q", res.StatusCode, body)
	}
	if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "javascript") {
		t.Errorf("Content-Type = %q", ct)
	}
}

func TestUnknownAppRoutesServeTheApp(t *testing.T) {
	ts := newTestServer(t)
	for _, path := range []string{"/edit/notes/today.md", "/settings", "/a/b/c"} {
		res, body := get(t, ts, path)
		if res.StatusCode != http.StatusOK || !isApp(body) {
			t.Errorf("%s: status = %d, body %q", path, res.StatusCode, body)
		}
	}
}

func TestMissingAssetIsNotFound(t *testing.T) {
	// A stale hashed asset must not come back as index.html, or the browser
	// would try to run HTML as a script.
	ts := newTestServer(t)
	res, _ := get(t, ts, "/assets/gone-123.js")
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", res.StatusCode)
	}
}

func TestUnknownAPIRoutesReturnJSON404(t *testing.T) {
	ts := newTestServer(t)
	for _, path := range []string{"/api/nope", "/api", "/api/health/extra"} {
		res, body := get(t, ts, path)
		if res.StatusCode != http.StatusNotFound {
			t.Errorf("%s: status = %d", path, res.StatusCode)
			continue
		}
		if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
			t.Errorf("%s: Content-Type = %q", path, ct)
		}
		var got struct{ Code, Message string }
		if err := json.Unmarshal([]byte(body), &got); err != nil {
			t.Errorf("%s: body is not JSON: %s", path, body)
			continue
		}
		if got.Code != "not-found" || got.Message == "" {
			t.Errorf("%s: body = %s", path, body)
		}
	}
}

func TestWrongMethodOnAPIReturnsJSON(t *testing.T) {
	ts := newTestServer(t)
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/health", nil)
	req.Header.Set("Origin", ts.URL)
	res, body := ts.do(t, req)
	if res.StatusCode < 400 || res.StatusCode >= 500 {
		t.Fatalf("status = %d", res.StatusCode)
	}
	var got struct{ Code, Message string }
	if err := json.Unmarshal([]byte(body), &got); err != nil || got.Code == "" {
		t.Errorf("body = %s", body)
	}
}
