package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"testing/fstest"
)

// saveFile saves content (LF line endings, as the editor has it) to path,
// as opened at rev, from the app's own origin.
func saveFile(t *testing.T, ts *testServer, path, content, rev string) (int, string) {
	t.Helper()
	body, err := json.Marshal(map[string]string{"path": path, "content": content, "rev": rev})
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPut, ts.URL+"/api/file", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", ts.URL)
	res, resBody := ts.do(t, req)
	return res.StatusCode, resBody
}

// opened opens path through the API and returns what the editor gets.
func opened(t *testing.T, ts *testServer, path string) openedFile {
	t.Helper()
	res, body := get(t, ts, "/api/file?path="+path)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("opening %s: status = %d, body %s", path, res.StatusCode, body)
	}
	return decode[openedFile](t, body)
}

// stored returns the bytes the fake Dropbox holds at path, and their revision.
func (ts *testServer) stored(t *testing.T, path string) (string, string) {
	t.Helper()
	f, err := ts.fake.Download(context.Background(), path, 1<<30)
	if err != nil {
		t.Fatalf("reading %s from the fake Dropbox: %v", path, err)
	}
	return string(f.Content), f.Rev
}

type savedFile struct {
	Path string `json:"path"`
	Rev  string `json:"rev"`
}

func TestSaveWritesTheFileAndReturnsItsNewRevision(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"Notes/Today.md": {Data: []byte("# Today\n")}})
	f := opened(t, ts, "notes/today.md")

	status, body := saveFile(t, ts, "notes/today.md", "# Today\n\nBuy milk.\n", f.Rev)
	if status != http.StatusOK {
		t.Fatalf("status = %d, body %s", status, body)
	}
	got := decode[savedFile](t, body)
	content, rev := ts.stored(t, "/Notes/Today.md")
	if content != "# Today\n\nBuy milk.\n" {
		t.Errorf("stored %q", content)
	}
	if got.Path != "Notes/Today.md" || got.Rev != rev || rev == f.Rev {
		t.Errorf("response %+v; stored rev %s, opened rev %s", got, rev, f.Rev)
	}
}

func TestSavingUnchangedContentWritesTheFileBackByteForByte(t *testing.T) {
	cases := map[string]string{
		"lf":                    "a\nb\n",
		"crlf":                  "a\r\nb\r\n",
		"mixed, mostly crlf":    "a\r\nb\nc\r\n",
		"mixed, mostly lf":      "a\nb\r\nc\n",
		"no final newline":      "a\r\nb",
		"lf, no final newline":  "a\nb",
		"bom":                   "\xEF\xBB\xBFa\r\nb\r\n",
		"bom, no final newline": "\xEF\xBB\xBFa",
		"empty":                 "",
		"only newlines":         "\r\n\r\n",
		"blank lines at end":    "a\n\n\n",
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			ts := newTestServerWith(t, fstest.MapFS{"f.txt": {Data: []byte(raw)}})
			f := opened(t, ts, "f.txt")
			if status, body := saveFile(t, ts, "f.txt", f.Content, f.Rev); status != http.StatusOK {
				t.Fatalf("status = %d, body %s", status, body)
			}
			if got, _ := ts.stored(t, "/f.txt"); got != raw {
				t.Errorf("stored %q, want %q", got, raw)
			}
		})
	}
}

func TestSavingAnEditChangesOnlyTheEditedLines(t *testing.T) {
	cases := []struct{ name, raw, edited, want string }{
		{"lf", "a\nb\nc\n", "a\nB\nc\n", "a\nB\nc\n"},
		{"crlf", "a\r\nb\r\nc\r\n", "a\nB\nc\n", "a\r\nB\r\nc\r\n"},
		{"crlf, lines added", "a\r\nb\r\n", "a\nnew 1\nnew 2\nb\n", "a\r\nnew 1\r\nnew 2\r\nb\r\n"},
		{"crlf, line deleted", "a\r\nb\r\nc\r\n", "a\nc\n", "a\r\nc\r\n"},
		{"crlf, appended at the end", "a\r\nb\r\n", "a\nb\nc\n", "a\r\nb\r\nc\r\n"},
		{"crlf, all replaced", "a\r\nb\r\n", "x\ny\n", "x\r\ny\r\n"},
		// Untouched lines keep their own endings; edited lines get the
		// file's dominant one.
		{"mixed, mostly crlf", "a\r\nb\nc\r\nd\r\n", "a\nb\nC\nd\n", "a\r\nb\nC\r\nd\r\n"},
		{"mixed, mostly lf", "a\nb\r\nc\nd\n", "A\nb\nc\nd\n", "A\nb\r\nc\nd\n"},
		{"no final newline kept", "a\r\nb", "a\nB", "a\r\nB"},
		{"no final newline restored", "a\r\nb", "a\nb\n", "a\r\nb"},
		{"no final newline restored, blank lines added", "a\nb", "a\nb\n\n", "a\nb"},
		{"final newline restored", "a\nb\n", "a\nb", "a\nb\n"},
		{"final newline restored, crlf", "a\r\nb\r\n", "a\nB", "a\r\nB\r\n"},
		{"bom kept", "\xEF\xBB\xBFa\nb\n", "a\nB\n", "\xEF\xBB\xBFa\nB\n"},
		{"emptied", "a\r\nb\r\n", "", ""},
		{"filled from empty", "", "a\nb", "a\nb"},
		{"utf-8", "héllo\r\n✓\r\n", "héllo\n✓ done\n", "héllo\r\n✓ done\r\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ts := newTestServerWith(t, fstest.MapFS{"f.txt": {Data: []byte(tc.raw)}})
			f := opened(t, ts, "f.txt")
			if status, body := saveFile(t, ts, "f.txt", tc.edited, f.Rev); status != http.StatusOK {
				t.Fatalf("status = %d, body %s", status, body)
			}
			if got, _ := ts.stored(t, "/f.txt"); got != tc.want {
				t.Errorf("stored %q, want %q", got, tc.want)
			}
			if again := opened(t, ts, "f.txt"); again.Rev == f.Rev {
				t.Errorf("revision unchanged after saving: %s", again.Rev)
			}
		})
	}
}

func TestSavingAgainstAStaleRevisionIsASaveConflict(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"Notes/Today.md": {Data: []byte("mine\n")}})
	f := opened(t, ts, "Notes/Today.md")
	// Another device saves first.
	if status, body := saveFile(t, ts, "Notes/Today.md", "theirs\n", f.Rev); status != http.StatusOK {
		t.Fatalf("status = %d, body %s", status, body)
	}
	_, theirRev := ts.stored(t, "/Notes/Today.md")

	status, body := saveFile(t, ts, "Notes/Today.md", "mine, edited\n", f.Rev)
	assertError(t, status, body, http.StatusConflict, "conflict")
	if got := decode[struct{ Rev string }](t, body); got.Rev != theirRev {
		t.Errorf("conflict rev = %q, want the current revision %q", got.Rev, theirRev)
	}
	if content, _ := ts.stored(t, "/Notes/Today.md"); content != "theirs\n" {
		t.Errorf("stored %q: the conflicting save overwrote it", content)
	}
}

func TestSaveRefusesContentThatWouldBeOver5MB(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"f.txt": {Data: []byte("a\r\n")}})
	f := opened(t, ts, "f.txt")
	// Under 5 MB as the editor has it, over once each LF becomes CRLF.
	big := strings.Repeat("abc\n", fiveMB/4-1)
	status, body := saveFile(t, ts, "f.txt", big, f.Rev)
	assertError(t, status, body, http.StatusRequestEntityTooLarge, "too-large")
	if content, _ := ts.stored(t, "/f.txt"); content != "a\r\n" {
		t.Errorf("stored %.20q", content)
	}
	if status, body := saveFile(t, ts, "f.txt", strings.Repeat("a", fiveMB-3)+"\n", f.Rev); status != http.StatusOK {
		t.Errorf("just under 5 MB: status = %d, body %.200s", status, body)
	}
}

func TestSaveRefusesMissingFilesFoldersAndBadRequests(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"Notes/a.md": {Data: []byte("a")}})
	rev := opened(t, ts, "Notes/a.md").Rev

	status, body := saveFile(t, ts, "Notes/gone.md", "x", rev)
	assertError(t, status, body, http.StatusNotFound, "not-found")
	status, body = saveFile(t, ts, "Notes", "x", rev)
	assertError(t, status, body, http.StatusBadRequest, "not-a-file")
	status, body = saveFile(t, ts, "../a.md", "x", rev)
	assertError(t, status, body, http.StatusBadRequest, "invalid-path")
	status, body = saveFile(t, ts, "Notes/a.md", "x", "")
	assertError(t, status, body, http.StatusBadRequest, "bad-request")

	req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/file", strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", ts.URL)
	res, body := ts.do(t, req)
	assertError(t, res.StatusCode, body, http.StatusBadRequest, "bad-request")

	if content, _ := ts.stored(t, "/Notes/a.md"); content != "a" {
		t.Errorf("stored %q", content)
	}
}
