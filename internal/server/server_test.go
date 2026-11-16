package server_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/kadre77/webedit/internal/server"
)

const indexHTML = `<!doctype html><title>webedit</title><div id="root"></div>`

// newTestServer runs the real server in-process with a stand-in frontend
// build.
func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	frontend := fstest.MapFS{
		"index.html":         {Data: []byte(indexHTML)},
		"assets/app-abc.js":  {Data: []byte(`console.log("app")`)},
		"assets/app-abc.css": {Data: []byte(`body{}`)},
	}
	ts := httptest.NewServer(server.New(frontend))
	t.Cleanup(ts.Close)
	return ts
}

func get(t *testing.T, ts *httptest.Server, path string) (*http.Response, string) {
	t.Helper()
	res, err := http.Get(ts.URL + path)
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
	if res.StatusCode != http.StatusOK || body != indexHTML {
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
		if res.StatusCode != http.StatusOK || body != indexHTML {
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
	res, err := http.Post(ts.URL+"/api/health", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode < 400 || res.StatusCode >= 500 {
		t.Fatalf("status = %d", res.StatusCode)
	}
	var got struct{ Code, Message string }
	if err := json.Unmarshal(body, &got); err != nil || got.Code == "" {
		t.Errorf("body = %s", body)
	}
}
