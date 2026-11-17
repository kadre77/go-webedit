package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"testing/fstest"

	"github.com/kadre77/webedit/internal/dropbox"
)

// sendJSON sends v as a JSON body from the app's own origin.
func sendJSON(t *testing.T, ts *testServer, method, url string, v any) (int, string) {
	t.Helper()
	body, err := json.Marshal(v)
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

func createFile(t *testing.T, ts *testServer, path string) (int, string) {
	t.Helper()
	return sendJSON(t, ts, http.MethodPost, "/api/files", map[string]string{"path": path})
}

func createFolder(t *testing.T, ts *testServer, path string) (int, string) {
	t.Helper()
	return sendJSON(t, ts, http.MethodPost, "/api/folders", map[string]string{"path": path})
}

func move(t *testing.T, ts *testServer, from, to string) (int, string) {
	t.Helper()
	return sendJSON(t, ts, http.MethodPost, "/api/move", map[string]string{"from": from, "to": to})
}

func deleteEntry(t *testing.T, ts *testServer, path string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodDelete, ts.URL+"/api/entry?path="+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", ts.URL)
	res, body := ts.do(t, req)
	return res.StatusCode, body
}

// exists reports whether the fake Dropbox has anything at path, and its
// display path.
func (ts *testServer) exists(t *testing.T, path string) (string, bool) {
	t.Helper()
	e, err := ts.fake.Metadata(context.Background(), path)
	if errors.Is(err, dropbox.ErrNotFound) {
		return "", false
	}
	if err != nil {
		t.Fatal(err)
	}
	return e.Path, true
}

type entryResponse struct {
	Path string `json:"path"`
	Kind string `json:"kind"`
	Rev  string `json:"rev"`
}

func TestCreateFileMakesAnEmptyFileThatOpens(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"Notes/a.md": {Data: []byte("a")}})

	status, body := createFile(t, ts, "notes/New.md")
	if status != http.StatusCreated {
		t.Fatalf("status = %d, body %s", status, body)
	}
	got := decode[entryResponse](t, body)
	content, rev := ts.stored(t, "/Notes/New.md")
	if content != "" {
		t.Errorf("stored %q, want an empty file", content)
	}
	if got.Path != "Notes/New.md" || got.Kind != "file" || got.Rev != rev {
		t.Errorf("response %+v, stored rev %s", got, rev)
	}
	if f := opened(t, ts, "Notes/New.md"); f.Rev != rev || f.Content != "" {
		t.Errorf("opened %+v", f)
	}
}

func TestCreateFileFailsWhenThePathIsTaken(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{
		"Notes/Today.md": {Data: []byte("mine")},
		"Notes/Sub/x.md": {Data: []byte("x")},
	})
	for _, p := range []string{"Notes/Today.md", "notes/TODAY.md", "Notes/Sub"} {
		status, body := createFile(t, ts, p)
		assertError(t, status, body, http.StatusConflict, "already-exists")
	}
	if content, _ := ts.stored(t, "/Notes/Today.md"); content != "mine" {
		t.Errorf("a refused create changed the file: %q", content)
	}
}

func TestCreateFolderMakesAFolder(t *testing.T) {
	ts := newTestServer(t)
	status, body := createFolder(t, ts, "Projects/Ideas")
	if status != http.StatusCreated {
		t.Fatalf("status = %d, body %s", status, body)
	}
	if got := decode[entryResponse](t, body); got.Path != "Projects/Ideas" || got.Kind != "folder" {
		t.Errorf("response %+v", got)
	}
	if p, ok := ts.exists(t, "/projects/ideas"); !ok || p != "/Projects/Ideas" {
		t.Errorf("stored at %q, %v", p, ok)
	}
}

func TestCreateFolderFailsWhenThePathIsTaken(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"Notes/Today.md": {Data: []byte("mine")}})
	for _, p := range []string{"Notes", "NOTES", "notes/today.md"} {
		status, body := createFolder(t, ts, p)
		assertError(t, status, body, http.StatusConflict, "already-exists")
	}
}

func TestCreateRefusesBadRequests(t *testing.T) {
	ts := newTestServer(t)
	for _, create := range []func(*testing.T, *testServer, string) (int, string){createFile, createFolder} {
		status, body := create(t, ts, "../x.md")
		assertError(t, status, body, http.StatusBadRequest, "invalid-path")
		status, body = create(t, ts, "")
		assertError(t, status, body, http.StatusBadRequest, "invalid-path")
	}
	status, body := sendJSON(t, ts, http.MethodPost, "/api/files", "not an object")
	assertError(t, status, body, http.StatusBadRequest, "bad-request")
}

func TestMoveRenamesAFile(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"Notes/Today.md": {Data: []byte("today")}})
	status, body := move(t, ts, "notes/today.md", "Archive/2026.md")
	if status != http.StatusOK {
		t.Fatalf("status = %d, body %s", status, body)
	}
	if got := decode[entryResponse](t, body); got.Path != "Archive/2026.md" || got.Kind != "file" {
		t.Errorf("response %+v", got)
	}
	if content, _ := ts.stored(t, "/Archive/2026.md"); content != "today" {
		t.Errorf("moved content %q", content)
	}
	if _, ok := ts.exists(t, "/Notes/Today.md"); ok {
		t.Error("the old path is still there")
	}
}

func TestMoveRenamesAFolderWithEverythingInIt(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{
		"Notes/a.md":     {Data: []byte("a")},
		"Notes/Sub/b.md": {Data: []byte("b")},
	})
	status, body := move(t, ts, "Notes", "Old Notes")
	if status != http.StatusOK {
		t.Fatalf("status = %d, body %s", status, body)
	}
	if got := decode[entryResponse](t, body); got.Path != "Old Notes" || got.Kind != "folder" {
		t.Errorf("response %+v", got)
	}
	if content, _ := ts.stored(t, "/Old Notes/Sub/b.md"); content != "b" {
		t.Errorf("moved content %q", content)
	}
}

func TestMoveCanChangeOnlyTheCase(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"notes.md": {Data: []byte("n")}})
	status, body := move(t, ts, "notes.md", "Notes.md")
	if status != http.StatusOK {
		t.Fatalf("status = %d, body %s", status, body)
	}
	if p, _ := ts.exists(t, "/notes.md"); p != "/Notes.md" {
		t.Errorf("display path %q", p)
	}
}

func TestMoveFailsWhenTheDestinationExists(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{
		"a.md":       {Data: []byte("a")},
		"B.md":       {Data: []byte("b")},
		"Notes/c.md": {Data: []byte("c")},
	})
	for _, to := range []string{"B.md", "b.md", "Notes"} {
		status, body := move(t, ts, "a.md", to)
		assertError(t, status, body, http.StatusConflict, "already-exists")
	}
	if content, _ := ts.stored(t, "/B.md"); content != "b" {
		t.Errorf("a refused move changed the destination: %q", content)
	}
	if content, _ := ts.stored(t, "/a.md"); content != "a" {
		t.Errorf("a refused move changed the source: %q", content)
	}
}

func TestMoveRefusesBadRequests(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"Notes/a.md": {Data: []byte("a")}})
	status, body := move(t, ts, "gone.md", "x.md")
	assertError(t, status, body, http.StatusNotFound, "not-found")
	status, body = move(t, ts, "Notes/a.md", "../a.md")
	assertError(t, status, body, http.StatusBadRequest, "invalid-path")
	status, body = move(t, ts, "/Notes/a.md", "a.md")
	assertError(t, status, body, http.StatusBadRequest, "invalid-path")
	status, body = move(t, ts, "Notes", "Notes/Inside")
	assertError(t, status, body, http.StatusBadRequest, "bad-request")
}

func TestDeleteRemovesAFile(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"Notes/a.md": {Data: []byte("a")}, "Notes/b.md": {Data: []byte("b")}})
	status, body := deleteEntry(t, ts, "notes/A.md")
	if status != http.StatusNoContent {
		t.Fatalf("status = %d, body %s", status, body)
	}
	if _, ok := ts.exists(t, "/Notes/a.md"); ok {
		t.Error("still there")
	}
	if _, ok := ts.exists(t, "/Notes/b.md"); !ok {
		t.Error("deleted a sibling")
	}
}

func TestDeleteRemovesAFolderWithEverythingInIt(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"Notes/Sub/a.md": {Data: []byte("a")}, "keep.md": {Data: []byte("k")}})
	status, body := deleteEntry(t, ts, "Notes")
	if status != http.StatusNoContent {
		t.Fatalf("status = %d, body %s", status, body)
	}
	for _, p := range []string{"/Notes", "/Notes/Sub/a.md"} {
		if _, ok := ts.exists(t, p); ok {
			t.Errorf("%s still there", p)
		}
	}
	if _, ok := ts.exists(t, "/keep.md"); !ok {
		t.Error("deleted something outside the folder")
	}
}

func TestDeleteRefusesMissingEntriesAndBadPaths(t *testing.T) {
	ts := newTestServer(t)
	status, body := deleteEntry(t, ts, "gone.md")
	assertError(t, status, body, http.StatusNotFound, "not-found")
	status, body = deleteEntry(t, ts, "..")
	assertError(t, status, body, http.StatusBadRequest, "invalid-path")
	status, body = deleteEntry(t, ts, "")
	assertError(t, status, body, http.StatusBadRequest, "invalid-path")
}

func TestFileManagementNeedsASession(t *testing.T) {
	ts := newSignedOutServer(t, fstest.MapFS{"a.md": {Data: []byte("a")}})
	for name, call := range map[string]func() (int, string){
		"create file":   func() (int, string) { return createFile(t, ts, "b.md") },
		"create folder": func() (int, string) { return createFolder(t, ts, "B") },
		"move":          func() (int, string) { return move(t, ts, "a.md", "b.md") },
		"delete":        func() (int, string) { return deleteEntry(t, ts, "a.md") },
	} {
		t.Run(name, func(t *testing.T) {
			status, body := call()
			assertError(t, status, body, http.StatusUnauthorized, "unauthorized")
		})
	}
	if _, ok := ts.exists(t, "/a.md"); !ok {
		t.Error("changed without a session")
	}
}

func TestFileManagementNeedsTheAppsOrigin(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"a.md": {Data: []byte("a")}})
	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/entry?path=a.md", nil)
	req.Header.Set("Origin", "https://evil.example")
	res, body := ts.do(t, req)
	assertError(t, res.StatusCode, body, http.StatusForbidden, "forbidden-origin")
	if _, ok := ts.exists(t, "/a.md"); !ok {
		t.Error("deleted from another origin")
	}
}
