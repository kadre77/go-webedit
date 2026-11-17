package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"testing"
	"testing/fstest"

	"github.com/kadre77/webedit/internal/dropbox"
	"github.com/kadre77/webedit/internal/server"
)

type checkedFile struct {
	Path string `json:"path"`
	Rev  string `json:"rev"`
}

func TestCheckFileReturnsTheCurrentRevision(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"Notes/Today.md": {Data: []byte("a\n")}})
	f := opened(t, ts, "Notes/Today.md")

	res, body := get(t, ts, "/api/file/rev?path=notes/today.md")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, body %s", res.StatusCode, body)
	}
	if got := decode[checkedFile](t, body); got.Path != "Notes/Today.md" || got.Rev != f.Rev {
		t.Errorf("check = %+v, want rev %s", got, f.Rev)
	}

	// Another device saves: the check now reports the new revision.
	if status, body := saveFile(t, ts, "Notes/Today.md", "b\n", f.Rev); status != http.StatusOK {
		t.Fatalf("save: status = %d, body %s", status, body)
	}
	_, rev := ts.stored(t, "/Notes/Today.md")
	_, body = get(t, ts, "/api/file/rev?path=Notes/Today.md")
	if got := decode[checkedFile](t, body); got.Rev != rev || rev == f.Rev {
		t.Errorf("after a save: check = %+v, stored rev %s", got, rev)
	}
}

func TestCheckFileRefusesMissingFilesFoldersAndBadPaths(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"Notes/a.md": {Data: []byte("a")}})
	res, body := get(t, ts, "/api/file/rev?path=Notes/gone.md")
	assertError(t, res.StatusCode, body, http.StatusNotFound, "not-found")
	res, body = get(t, ts, "/api/file/rev?path=Notes")
	assertError(t, res.StatusCode, body, http.StatusBadRequest, "not-a-file")
	res, body = get(t, ts, "/api/file/rev?path=../a.md")
	assertError(t, res.StatusCode, body, http.StatusBadRequest, "invalid-path")
}

// sendContent sends {path, content} as JSON from the app's own origin.
func sendContent(t *testing.T, ts *testServer, method, url, path, content string) (int, string) {
	t.Helper()
	body, err := json.Marshal(map[string]string{"path": path, "content": content})
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(method, ts.URL+url, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", ts.URL)
	res, resBody := ts.do(t, req)
	return res.StatusCode, resBody
}

// saveCopy saves content (LF line endings) as a conflicted copy of path.
func saveCopy(t *testing.T, ts *testServer, path, content string) (int, string) {
	t.Helper()
	return sendContent(t, ts, http.MethodPost, "/api/file/copy", path, content)
}

func TestSaveAsCopyWritesASiblingAndLeavesTheOriginal(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"Notes/Today.md": {Data: []byte("theirs\r\nend\r\n")}})
	_, origRev := ts.stored(t, "/Notes/Today.md")

	// The test server's clock reads 2026-11-17 12:00:00 UTC.
	status, body := saveCopy(t, ts, "notes/today.md", "mine\nend\n")
	if status != http.StatusOK {
		t.Fatalf("status = %d, body %s", status, body)
	}
	got := decode[savedFile](t, body)
	const want = "Notes/Today (conflicted copy 2026-11-17 120000).md"
	content, rev := ts.stored(t, "/"+want)
	if got.Path != want || got.Rev != rev {
		t.Errorf("response %+v, want path %q and rev %s", got, want, rev)
	}
	if content != "mine\r\nend\r\n" {
		t.Errorf("copy holds %q, want the original's CRLF line endings", content)
	}
	if content, rev := ts.stored(t, "/Notes/Today.md"); content != "theirs\r\nend\r\n" || rev != origRev {
		t.Errorf("original changed: %q at %s", content, rev)
	}
}

func TestSaveAsCopyPicksAFreeName(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{
		"Notes/Today.md": {Data: []byte("theirs\n")},
		"Notes/Today (conflicted copy 2026-11-17 120000).md": {Data: []byte("earlier copy\n")},
		"Makefile": {Data: []byte("all:\n")},
	})
	status, body := saveCopy(t, ts, "Notes/Today.md", "mine\n")
	if status != http.StatusOK {
		t.Fatalf("status = %d, body %s", status, body)
	}
	if got := decode[savedFile](t, body); got.Path != "Notes/Today (conflicted copy 2026-11-17 120000 2).md" {
		t.Errorf("path = %q", got.Path)
	}
	if content, _ := ts.stored(t, "/Notes/Today (conflicted copy 2026-11-17 120000).md"); content != "earlier copy\n" {
		t.Errorf("the earlier copy was overwritten: %q", content)
	}

	// A name without an extension gets the suffix at the end.
	status, body = saveCopy(t, ts, "Makefile", "all: x\n")
	if got := decode[savedFile](t, body); status != http.StatusOK || got.Path != "Makefile (conflicted copy 2026-11-17 120000)" {
		t.Errorf("status %d, body %s", status, body)
	}
}

func TestSaveAsCopyOfAFileDeletedElsewhereStillSavesTheDraft(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"Notes/a.md": {Data: []byte("a")}})
	status, body := saveCopy(t, ts, "Notes/gone.md", "mine\n")
	if status != http.StatusOK {
		t.Fatalf("status = %d, body %s", status, body)
	}
	if content, _ := ts.stored(t, "/Notes/gone (conflicted copy 2026-11-17 120000).md"); content != "mine\n" {
		t.Errorf("copy holds %q", content)
	}
}

func TestSaveAsCopyIsNotStoppedByAnOriginalNowOver5MB(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"big.log": {Data: bytes.Repeat([]byte("a\r\n"), fiveMB/3+1)}})
	status, body := saveCopy(t, ts, "big.log", "mine\n")
	if status != http.StatusOK {
		t.Fatalf("status = %d, body %.200s", status, body)
	}
	if content, _ := ts.stored(t, "/big (conflicted copy 2026-11-17 120000).log"); content != "mine\n" {
		t.Errorf("copy holds %q", content)
	}
}

func TestSaveAsCopyRefusesBadRequests(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"Notes/a.md": {Data: []byte("a")}})
	status, body := saveCopy(t, ts, "../a.md", "x")
	assertError(t, status, body, http.StatusBadRequest, "invalid-path")
	status, body = saveCopy(t, ts, "", "x")
	assertError(t, status, body, http.StatusBadRequest, "invalid-path")
}

// changeElsewhere writes content to path through the test-mode hook, as
// another device would.
func changeElsewhere(t *testing.T, ts *testServer, path, content string) (int, string) {
	t.Helper()
	return sendContent(t, ts, http.MethodPut, "/api/test/file", path, content)
}

func withTestHooks(o *server.Options) {
	o.TestFake = o.Dropbox.(*dropbox.Fake)
}

func TestTestModeHookChangesAFileInTheFakeDropbox(t *testing.T) {
	ts := newSignedOutServer(t, fstest.MapFS{"Notes/Today.md": {Data: []byte("a\n")}}, withTestHooks)
	ts.signIn(t)
	f := opened(t, ts, "Notes/Today.md")

	if status, body := changeElsewhere(t, ts, "notes/today.md", "theirs\n"); status != http.StatusOK {
		t.Fatalf("status = %d, body %s", status, body)
	}
	if content, rev := ts.stored(t, "/Notes/Today.md"); content != "theirs\n" || rev == f.Rev {
		t.Errorf("stored %q at %s, opened at %s", content, rev, f.Rev)
	}
	if status, body := changeElsewhere(t, ts, "Notes/New.md", "new\n"); status != http.StatusOK {
		t.Fatalf("new file: status = %d, body %s", status, body)
	}
	if content, _ := ts.stored(t, "/Notes/New.md"); content != "new\n" {
		t.Errorf("new file holds %q", content)
	}
}

func TestTheTestModeHookIsAbsentOutsideTestMode(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"Notes/Today.md": {Data: []byte("a\n")}})
	status, body := changeElsewhere(t, ts, "Notes/Today.md", "theirs\n")
	assertError(t, status, body, http.StatusNotFound, "not-found")
	if content, _ := ts.stored(t, "/Notes/Today.md"); content != "a\n" {
		t.Errorf("stored %q", content)
	}
}

// deleteElsewhere deletes path through the test-mode hook, as another device
// would.
func deleteElsewhere(t *testing.T, ts *testServer, path string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodDelete, ts.URL+"/api/test/file?path="+url.QueryEscape(path), nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", ts.URL)
	res, body := ts.do(t, req)
	return res.StatusCode, body
}

func TestTestModeHookDeletesAFileInTheFakeDropbox(t *testing.T) {
	ts := newSignedOutServer(t, fstest.MapFS{"Notes/Today.md": {Data: []byte("a\n")}}, withTestHooks)
	ts.signIn(t)

	if status, body := deleteElsewhere(t, ts, "notes/today.md"); status != http.StatusNoContent {
		t.Fatalf("status = %d, body %s", status, body)
	}
	res, body := get(t, ts, "/api/file?path=Notes/Today.md")
	assertError(t, res.StatusCode, body, http.StatusNotFound, "not-found")

	status, body := deleteElsewhere(t, ts, "Notes/Today.md")
	assertError(t, status, body, http.StatusNotFound, "not-found")
	status, body = deleteElsewhere(t, ts, "../x.md")
	assertError(t, status, body, http.StatusBadRequest, "invalid-path")
}

func TestTheTestModeDeleteHookIsAbsentOutsideTestMode(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"Notes/Today.md": {Data: []byte("a\n")}})
	status, body := deleteElsewhere(t, ts, "Notes/Today.md")
	assertError(t, status, body, http.StatusNotFound, "not-found")
	if content, _ := ts.stored(t, "/Notes/Today.md"); content != "a\n" {
		t.Errorf("stored %q", content)
	}
}
