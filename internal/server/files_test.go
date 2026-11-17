package server_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"testing/fstest"
)

const fiveMB = 5 * 1024 * 1024

type treeEntry struct {
	Path     string `json:"path"`
	Kind     string `json:"kind"`
	Size     int64  `json:"size"`
	Openable bool   `json:"openable"`
	Reason   string `json:"reason"`
}

func decode[T any](t *testing.T, body string) T {
	t.Helper()
	var v T
	if err := json.Unmarshal([]byte(body), &v); err != nil {
		t.Fatalf("body is not the expected JSON: %v\n%s", err, body)
	}
	return v
}

func TestTreeListsTheWholeRootFolder(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{
		"Notes/Today.md":     {Data: []byte("# Today\n")},
		"Notes/Deep/a/b.txt": {Data: []byte("b")},
		"big.log":            {Data: make([]byte, fiveMB+1)},
		"exactly-5mb.txt":    {Data: make([]byte, fiveMB)},
		"photo.png":          {Data: []byte{0x89, 'P', 'N', 'G', 0}},
	})
	res, body := get(t, ts, "/api/tree")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, body %s", res.StatusCode, body)
	}
	got := decode[struct{ Entries []treeEntry }](t, body)
	byPath := map[string]treeEntry{}
	for _, e := range got.Entries {
		byPath[e.Path] = e
	}
	want := []treeEntry{
		{Path: "Notes", Kind: "folder"},
		{Path: "Notes/Today.md", Kind: "file", Size: 8, Openable: true},
		{Path: "Notes/Deep", Kind: "folder"},
		{Path: "Notes/Deep/a", Kind: "folder"},
		{Path: "Notes/Deep/a/b.txt", Kind: "file", Size: 1, Openable: true},
		{Path: "big.log", Kind: "file", Size: fiveMB + 1, Openable: false, Reason: "too-large"},
		{Path: "exactly-5mb.txt", Kind: "file", Size: fiveMB, Openable: true},
		// Binary or not is only known on open.
		{Path: "photo.png", Kind: "file", Size: 5, Openable: true},
	}
	if len(got.Entries) != len(want) {
		t.Errorf("got %d entries: %s", len(got.Entries), body)
	}
	for _, w := range want {
		if g, ok := byPath[w.Path]; !ok || g != w {
			t.Errorf("%s: got %+v, want %+v", w.Path, g, w)
		}
	}
	if strings.Contains(body, `"/`) {
		t.Errorf("paths must be relative to the Root Folder: %s", body)
	}
}

type openedFile struct {
	Path            string `json:"path"`
	Content         string `json:"content"`
	Rev             string `json:"rev"`
	LineEnding      string `json:"lineEnding"`
	TrailingNewline bool   `json:"trailingNewline"`
	BOM             bool   `json:"bom"`
}

func openFile(t *testing.T, seed fstest.MapFS, path string) (int, string) {
	t.Helper()
	ts := newTestServerWith(t, seed)
	res, body := get(t, ts, "/api/file?path="+path)
	return res.StatusCode, body
}

func TestOpenFileReturnsLFContentAndItsLineEndingFacts(t *testing.T) {
	cases := []struct {
		name, raw string
		want      openedFile
	}{
		{"lf", "a\nb\n", openedFile{Content: "a\nb\n", LineEnding: "lf", TrailingNewline: true}},
		{"crlf", "a\r\nb\r\n", openedFile{Content: "a\nb\n", LineEnding: "crlf", TrailingNewline: true}},
		{"no final newline", "a\r\nb", openedFile{Content: "a\nb", LineEnding: "crlf"}},
		{"mostly crlf", "a\r\nb\r\nc\n", openedFile{Content: "a\nb\nc\n", LineEnding: "crlf", TrailingNewline: true}},
		{"mostly lf", "a\r\nb\nc\n", openedFile{Content: "a\nb\nc\n", LineEnding: "lf", TrailingNewline: true}},
		{"half and half", "a\r\nb\n", openedFile{Content: "a\nb\n", LineEnding: "lf", TrailingNewline: true}},
		{"single line", "only", openedFile{Content: "only", LineEnding: "lf"}},
		{"empty", "", openedFile{Content: "", LineEnding: "lf"}},
		{"bom", "\xEF\xBB\xBFa\r\n", openedFile{Content: "a\n", LineEnding: "crlf", TrailingNewline: true, BOM: true}},
		{"utf-8", "héllo ✓\n", openedFile{Content: "héllo ✓\n", LineEnding: "lf", TrailingNewline: true}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, body := openFile(t, fstest.MapFS{"Notes/F.md": {Data: []byte(tc.raw)}}, "Notes/F.md")
			if status != http.StatusOK {
				t.Fatalf("status = %d, body %s", status, body)
			}
			got := decode[openedFile](t, body)
			if got.Rev == "" {
				t.Errorf("no revision: %s", body)
			}
			tc.want.Path, tc.want.Rev = "Notes/F.md", got.Rev
			if got != tc.want {
				t.Errorf("got  %+v\nwant %+v", got, tc.want)
			}
		})
	}
}

func TestOpenFileUsesDisplayCaseWhateverCaseIsAsked(t *testing.T) {
	status, body := openFile(t, fstest.MapFS{"Notes/Today.md": {Data: []byte("x")}}, "notes/TODAY.MD")
	if status != http.StatusOK {
		t.Fatalf("status = %d, body %s", status, body)
	}
	if got := decode[openedFile](t, body); got.Path != "Notes/Today.md" {
		t.Errorf("path = %q", got.Path)
	}
}

func assertError(t *testing.T, status int, body string, wantStatus int, wantCode string) {
	t.Helper()
	if status != wantStatus {
		t.Errorf("status = %d, want %d (body %s)", status, wantStatus, body)
	}
	got := decode[struct{ Code, Message string }](t, body)
	if got.Code != wantCode || got.Message == "" {
		t.Errorf("error = %+v, want code %q and a message", got, wantCode)
	}
}

func TestOpenFileRefusesFilesOver5MB(t *testing.T) {
	seed := fstest.MapFS{
		"big.txt": {Data: []byte(strings.Repeat("a", fiveMB+1))},
		"ok.txt":  {Data: []byte(strings.Repeat("a", fiveMB))},
	}
	status, body := openFile(t, seed, "big.txt")
	assertError(t, status, body, http.StatusRequestEntityTooLarge, "too-large")
	if status, body := openFile(t, seed, "ok.txt"); status != http.StatusOK {
		t.Errorf("exactly 5 MB: status = %d, body %.200s", status, body)
	}
}

func TestOpenFileRefusesBinaryFiles(t *testing.T) {
	seed := fstest.MapFS{
		"null.txt":   {Data: []byte("text\x00more")},
		"latin1.txt": {Data: []byte("caf\xe9")},
		"photo.png":  {Data: []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0}},
	}
	for name := range seed {
		status, body := openFile(t, seed, name)
		assertError(t, status, body, http.StatusUnsupportedMediaType, "binary-file")
	}
}

func TestOpenFileNotFound(t *testing.T) {
	seed := fstest.MapFS{"Notes/a.md": {Data: []byte("a")}}
	status, body := openFile(t, seed, "Notes/missing.md")
	assertError(t, status, body, http.StatusNotFound, "not-found")
	status, body = openFile(t, seed, "Notes")
	assertError(t, status, body, http.StatusBadRequest, "not-a-file")
}

func TestClientPathsThatCouldEscapeTheRootFolderAreRejected(t *testing.T) {
	ts := newTestServerWith(t, fstest.MapFS{"Notes/a.md": {Data: []byte("a")}})
	// Raw query strings, sent exactly as written.
	cases := map[string]string{
		"dot-dot":                "..",
		"dot-dot segment":        "Notes/../Notes/a.md",
		"leading dot-dot":        "../a.md",
		"encoded dot-dot":        "%2e%2e/Notes/a.md",
		"encoded slash":          "Notes%2f..%2f..%2fa.md",
		"double-encoded dot-dot": "%252e%252e/Notes/a.md",
		"dot segment":            "./Notes/a.md",
		"absolute":               "/Notes/a.md",
		"encoded absolute":       "%2fNotes%2fa.md",
		"empty":                  "",
		"empty segment":          "Notes//a.md",
		"trailing slash":         "Notes/",
		"backslash":              "Notes%5c..%5ca.md",
		"null byte":              "Notes/a.md%00.txt",
		"newline":                "Notes/a%0a.md",
		"delete char":            "Notes/a%7f.md",
		"invalid utf-8":          "Notes/%ff.md",
	}
	for name, raw := range cases {
		res, body := get(t, ts, "/api/file?path="+raw)
		t.Run(name, func(t *testing.T) {
			assertError(t, res.StatusCode, body, http.StatusBadRequest, "invalid-path")
		})
	}
	res, body := get(t, ts, "/api/file")
	assertError(t, res.StatusCode, body, http.StatusBadRequest, "invalid-path")
}

func TestOrdinaryPathsAreAccepted(t *testing.T) {
	seed := fstest.MapFS{
		"My Notes/día 1 (draft).md": {Data: []byte("x")},
		"a..b/c.d.md":               {Data: []byte("x")},
		".hidden/.env":              {Data: []byte("x")},
	}
	ts := newTestServerWith(t, seed)
	for _, raw := range []string{"My%20Notes/d%C3%ADa%201%20(draft).md", "a..b/c.d.md", ".hidden/.env"} {
		if res, body := get(t, ts, "/api/file?path="+raw); res.StatusCode != http.StatusOK {
			t.Errorf("%s: status = %d, body %s", raw, res.StatusCode, body)
		}
	}
}
