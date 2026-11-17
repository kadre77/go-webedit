package dropbox_test

// The real adapter runs against stubDropbox, an httptest server that answers
// like the Dropbox HTTP API for the endpoints the adapter uses.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"

	"github.com/kadre77/webedit/internal/dropbox"
)

const (
	appKey    = "the-app-key"
	appSecret = "the-app-secret"
)

type stubFile struct {
	path, rev string
	content   []byte
}

type stubDropbox struct {
	*httptest.Server
	t *testing.T

	mu        sync.Mutex
	codes     map[string]string // code -> account ID; each works once
	refresh   map[string]bool   // refresh tokens Dropbox accepts
	access    map[string]bool   // live access tokens
	issued    int
	refreshes int
	files     []stubFile
	folders   []string
	pageSize  int
	revs      int
	failWith  int    // when set, file endpoints answer with this status
	lastArg   string // the last Dropbox-API-Arg header
}

func newStubDropbox(t *testing.T) *stubDropbox {
	s := &stubDropbox{t: t, codes: map[string]string{}, refresh: map[string]bool{}, access: map[string]bool{}, pageSize: 2}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /oauth2/token", s.token)
	mux.HandleFunc("POST /2/files/list_folder", s.authed(s.listFolder))
	mux.HandleFunc("POST /2/files/list_folder/continue", s.authed(s.listContinue))
	mux.HandleFunc("POST /2/files/download", s.authed(s.download))
	mux.HandleFunc("POST /2/files/upload", s.authed(s.upload))
	mux.HandleFunc("POST /2/files/get_metadata", s.authed(s.getMetadata))
	s.Server = httptest.NewServer(mux)
	t.Cleanup(s.Close)
	return s
}

// grant makes Dropbox hand out a code for accountID, as after the Owner
// approves on the authorize page.
func (s *stubDropbox) grant(code, accountID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.codes[code] = accountID
}

func (s *stubDropbox) acceptRefreshToken(tok string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refresh[tok] = true
}

func (s *stubDropbox) revokeAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refresh, s.access = map[string]bool{}, map[string]bool{}
}

func (s *stubDropbox) expireAccessTokens() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.access = map[string]bool{}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func (s *stubDropbox) newAccessToken() string {
	s.issued++
	tok := fmt.Sprintf("access-%d", s.issued)
	s.access[tok] = true
	return tok
}

func (s *stubDropbox) token(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r.ParseForm()
	if r.Form.Get("client_id") != appKey || r.Form.Get("client_secret") != appSecret {
		writeJSON(w, 400, map[string]string{"error": "invalid_client"})
		return
	}
	switch r.Form.Get("grant_type") {
	case "authorization_code":
		account, ok := s.codes[r.Form.Get("code")]
		delete(s.codes, r.Form.Get("code"))
		if !ok || r.Form.Get("code_verifier") == "" || r.Form.Get("redirect_uri") != "https://edit.example.com/auth/callback" {
			writeJSON(w, 400, map[string]string{"error": "invalid_grant", "error_description": "code doesn't exist or has expired"})
			return
		}
		refresh := "refresh-for-" + account
		s.refresh[refresh] = true
		writeJSON(w, 200, map[string]any{
			"access_token": s.newAccessToken(), "token_type": "bearer", "expires_in": 14400,
			"refresh_token": refresh, "account_id": account, "uid": "12345",
		})
	case "refresh_token":
		if !s.refresh[r.Form.Get("refresh_token")] {
			writeJSON(w, 400, map[string]string{"error": "invalid_grant", "error_description": "refresh token is invalid or revoked"})
			return
		}
		s.refreshes++
		writeJSON(w, 200, map[string]any{"access_token": s.newAccessToken(), "token_type": "bearer", "expires_in": 14400})
	default:
		writeJSON(w, 400, map[string]string{"error": "unsupported_grant_type"})
	}
}

func (s *stubDropbox) authed(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		ok := s.access[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")]
		fail := s.failWith
		s.mu.Unlock()
		if !ok {
			writeJSON(w, 401, map[string]any{"error_summary": "expired_access_token/", "error": map[string]string{".tag": "expired_access_token"}})
			return
		}
		if fail != 0 {
			w.Header().Set("Retry-After", "1")
			writeJSON(w, fail, map[string]any{"error_summary": "too_many_requests/"})
			return
		}
		h(w, r)
	}
}

type stubEntry struct {
	Tag         string `json:".tag"`
	Name        string `json:"name"`
	PathDisplay string `json:"path_display"`
	PathLower   string `json:"path_lower"`
	Size        int64  `json:"size,omitempty"`
	Rev         string `json:"rev,omitempty"`
}

func (f stubFile) entry() stubEntry {
	return stubEntry{Tag: "file", Name: f.path[strings.LastIndex(f.path, "/")+1:], PathDisplay: f.path,
		PathLower: strings.ToLower(f.path), Size: int64(len(f.content)), Rev: f.rev}
}

func (s *stubDropbox) allEntries() []stubEntry {
	var out []stubEntry
	for _, p := range s.folders {
		out = append(out, stubEntry{Tag: "folder", Name: p[strings.LastIndex(p, "/")+1:], PathDisplay: p, PathLower: strings.ToLower(p)})
	}
	for _, f := range s.files {
		out = append(out, f.entry())
	}
	out = append(out, stubEntry{Tag: "deleted", Name: "gone.md", PathDisplay: "/gone.md", PathLower: "/gone.md"})
	return out
}

func (s *stubDropbox) page(w http.ResponseWriter, from int) {
	all := s.allEntries()
	end := min(from+s.pageSize, len(all))
	writeJSON(w, 200, map[string]any{"entries": all[from:end], "cursor": fmt.Sprint(end), "has_more": end < len(all)})
}

func (s *stubDropbox) listFolder(w http.ResponseWriter, r *http.Request) {
	var arg struct {
		Path      string `json:"path"`
		Recursive bool   `json:"recursive"`
	}
	json.NewDecoder(r.Body).Decode(&arg)
	if arg.Path != "" || !arg.Recursive {
		s.t.Errorf("list_folder arg = %+v, want the Root Folder, recursive", arg)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.page(w, 0)
}

func (s *stubDropbox) listContinue(w http.ResponseWriter, r *http.Request) {
	var arg struct{ Cursor string }
	json.NewDecoder(r.Body).Decode(&arg)
	var from int
	fmt.Sscan(arg.Cursor, &from)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.page(w, from)
}

func pathError(w http.ResponseWriter, tag string) {
	writeJSON(w, 409, map[string]any{
		"error_summary": "path/" + tag + "/..",
		"error":         map[string]any{".tag": "path", "path": map[string]string{".tag": tag}},
	})
}

func (s *stubDropbox) download(w http.ResponseWriter, r *http.Request) {
	raw := r.Header.Get("Dropbox-API-Arg")
	s.mu.Lock()
	s.lastArg = raw
	s.mu.Unlock()
	for i := 0; i < len(raw); i++ {
		if raw[i] >= utf8.RuneSelf {
			http.Error(w, "Dropbox-API-Arg must be ASCII", 400)
			return
		}
	}
	var arg struct{ Path string }
	if err := json.Unmarshal([]byte(raw), &arg); err != nil {
		http.Error(w, "bad Dropbox-API-Arg", 400)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range s.folders {
		if strings.EqualFold(p, arg.Path) {
			pathError(w, "not_file")
			return
		}
	}
	for _, f := range s.files {
		if strings.EqualFold(f.path, arg.Path) {
			meta, _ := json.Marshal(f.entry())
			w.Header().Set("Dropbox-API-Result", string(meta))
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Write(f.content)
			return
		}
	}
	pathError(w, "not_found")
}

func (s *stubDropbox) getMetadata(w http.ResponseWriter, r *http.Request) {
	var arg struct{ Path string }
	json.NewDecoder(r.Body).Decode(&arg)
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.allEntries() {
		if e.Tag != "deleted" && strings.EqualFold(e.PathDisplay, arg.Path) {
			writeJSON(w, 200, e)
			return
		}
	}
	pathError(w, "not_found")
}

func writeConflict(w http.ResponseWriter) {
	writeJSON(w, 409, map[string]any{
		"error_summary": "path/conflict/file/..",
		"error": map[string]any{".tag": "path", "reason": map[string]any{
			".tag": "conflict", "conflict": map[string]string{".tag": "file"}}},
	})
}

// upload answers like Dropbox's upload endpoint. In update mode it writes
// only if the file's revision is the one given; in add mode only if nothing
// is at the path. A write gives a new revision.
func (s *stubDropbox) upload(w http.ResponseWriter, r *http.Request) {
	raw := r.Header.Get("Dropbox-API-Arg")
	var arg struct {
		Path string
		Mode struct {
			Tag    string `json:".tag"`
			Update string `json:"update"`
		}
		Autorename     bool `json:"autorename"`
		StrictConflict bool `json:"strict_conflict"`
	}
	if err := json.Unmarshal([]byte(raw), &arg); err != nil || r.Header.Get("Content-Type") != "application/octet-stream" {
		http.Error(w, "bad Dropbox-API-Arg or Content-Type", 400)
		return
	}
	if (arg.Mode.Tag != "update" && arg.Mode.Tag != "add") || arg.Autorename || !arg.StrictConflict {
		s.t.Errorf("upload arg = %s, want update or add mode, no autorename, strict conflicts", raw)
	}
	content, _ := io.ReadAll(r.Body)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastArg = raw
	if arg.Mode.Tag == "add" {
		for _, e := range s.allEntries() {
			if e.Tag != "deleted" && strings.EqualFold(e.PathDisplay, arg.Path) {
				writeConflict(w)
				return
			}
		}
		s.revs++
		f := stubFile{path: arg.Path, rev: fmt.Sprintf("0new%d", s.revs), content: content}
		s.files = append(s.files, f)
		writeJSON(w, 200, f.entry())
		return
	}
	for i, f := range s.files {
		if !strings.EqualFold(f.path, arg.Path) {
			continue
		}
		if f.rev != arg.Mode.Update {
			writeConflict(w)
			return
		}
		s.revs++
		s.files[i] = stubFile{path: f.path, rev: fmt.Sprintf("0new%d", s.revs), content: content}
		writeJSON(w, 200, s.files[i].entry())
		return
	}
	writeJSON(w, 409, map[string]any{"error_summary": "path/conflict/file/.."})
}

// memTokens is a refresh-token source in memory.
type memTokens struct {
	mu  sync.Mutex
	tok string
}

func (m *memTokens) RefreshToken() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.tok == "" {
		return "", errors.New("no token saved")
	}
	return m.tok, nil
}

func (m *memTokens) set(tok string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tok = tok
}

func newClient(stub *stubDropbox, tokens *memTokens) *dropbox.Client {
	c := dropbox.NewClient(appKey, appSecret, tokens)
	c.Endpoints = dropbox.Endpoints{
		Authorize: "https://www.dropbox.com/oauth2/authorize",
		API:       stub.URL,
		Content:   stub.URL,
	}
	return c
}

func TestClientAuthorizeURLAsksForACodeWithPKCEAndARefreshToken(t *testing.T) {
	c := newClient(newStubDropbox(t), &memTokens{})
	u, err := url.Parse(c.AuthorizeURL("the-state", "the-challenge", "https://edit.example.com/auth/callback"))
	if err != nil {
		t.Fatal(err)
	}
	if got := u.Scheme + "://" + u.Host + u.Path; got != "https://www.dropbox.com/oauth2/authorize" {
		t.Errorf("authorize endpoint = %s", got)
	}
	want := url.Values{
		"client_id":             {appKey},
		"response_type":         {"code"},
		"state":                 {"the-state"},
		"code_challenge":        {"the-challenge"},
		"code_challenge_method": {"S256"},
		"redirect_uri":          {"https://edit.example.com/auth/callback"},
		"token_access_type":     {"offline"},
		// Only the scopes the spec allows, whatever the app console offers.
		"scope": {"account_info.read files.metadata.read files.content.read files.content.write"},
	}
	for k, v := range want {
		if got := u.Query().Get(k); got != v[0] {
			t.Errorf("%s = %q, want %q", k, got, v[0])
		}
	}
}

const callback = "https://edit.example.com/auth/callback"

func TestClientExchangesACodeForTheRefreshTokenAndAccount(t *testing.T) {
	stub := newStubDropbox(t)
	stub.grant("good-code", "dbid:owner")
	c := newClient(stub, &memTokens{})
	tok, err := c.ExchangeCode(ctx, "good-code", "verifier", callback)
	if err != nil {
		t.Fatal(err)
	}
	if tok.RefreshToken != "refresh-for-dbid:owner" || tok.AccountID != "dbid:owner" {
		t.Errorf("token = %+v", tok)
	}
	if _, err := c.ExchangeCode(ctx, "good-code", "verifier", callback); !errors.Is(err, dropbox.ErrBadCode) {
		t.Errorf("reused code: err = %v", err)
	}
}

func signedInClient(t *testing.T, stub *stubDropbox) (*dropbox.Client, *memTokens) {
	t.Helper()
	tokens := &memTokens{tok: "stored-refresh-token"}
	stub.acceptRefreshToken("stored-refresh-token")
	return newClient(stub, tokens), tokens
}

func TestClientListsTheWholeRootFolderAcrossPages(t *testing.T) {
	stub := newStubDropbox(t)
	stub.folders = []string{"/Notes", "/Notes/Old"}
	stub.files = []stubFile{
		{path: "/Notes/Today.md", rev: "015a1", content: []byte("# Today\n")},
		{path: "/Notes/Old/2020.txt", rev: "015a2", content: []byte("old")},
		{path: "/readme.md", rev: "015a3", content: []byte("hi")},
	}
	c, _ := signedInClient(t, stub)
	entries, err := c.ListAll(ctx)
	if err != nil {
		t.Fatal(err)
	}
	want := []dropbox.Entry{
		{Path: "/Notes", Folder: true},
		{Path: "/Notes/Old", Folder: true},
		{Path: "/Notes/Today.md", Size: 8, Rev: "015a1"},
		{Path: "/Notes/Old/2020.txt", Size: 3, Rev: "015a2"},
		{Path: "/readme.md", Size: 2, Rev: "015a3"},
	}
	if fmt.Sprint(entries) != fmt.Sprint(want) {
		t.Errorf("entries:\n got %v\nwant %v", entries, want)
	}
}

func TestClientReusesItsAccessTokenAndRefreshesWhenItExpires(t *testing.T) {
	stub := newStubDropbox(t)
	c, _ := signedInClient(t, stub)
	for range 3 {
		if _, err := c.ListAll(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if stub.refreshes != 1 {
		t.Errorf("refreshed %d times for 3 calls, want 1", stub.refreshes)
	}
	stub.expireAccessTokens()
	if _, err := c.ListAll(ctx); err != nil {
		t.Fatalf("after expiry: %v", err)
	}
	if stub.refreshes != 2 {
		t.Errorf("refreshes = %d, want 2", stub.refreshes)
	}
}

func TestClientNeedsReauthorizingWhenDropboxRejectsTheRefreshToken(t *testing.T) {
	stub := newStubDropbox(t)
	c, tokens := signedInClient(t, stub)
	if _, err := c.ListAll(ctx); err != nil {
		t.Fatal(err)
	}
	stub.revokeAll()
	if _, err := c.ListAll(ctx); !errors.Is(err, dropbox.ErrReauthorize) {
		t.Errorf("revoked: err = %v", err)
	}
	if _, err := c.Download(ctx, "/readme.md", noLimit); !errors.Is(err, dropbox.ErrReauthorize) {
		t.Errorf("revoked download: err = %v", err)
	}

	// Signing in again stores a new refresh token, which the client picks up.
	tokens.set("new-refresh-token")
	stub.acceptRefreshToken("new-refresh-token")
	if _, err := c.ListAll(ctx); err != nil {
		t.Errorf("after signing in again: %v", err)
	}
}

func TestClientNeedsReauthorizingWithNoStoredToken(t *testing.T) {
	c := newClient(newStubDropbox(t), &memTokens{})
	if _, err := c.ListAll(ctx); !errors.Is(err, dropbox.ErrReauthorize) {
		t.Errorf("err = %v", err)
	}
}

func TestClientDownloadsAFileWithItsRevision(t *testing.T) {
	stub := newStubDropbox(t)
	stub.files = []stubFile{{path: "/Notes/Día 1 ✓ 😀.md", rev: "0bee", content: []byte("hola\n")}}
	stub.folders = []string{"/Notes"}
	c, _ := signedInClient(t, stub)

	f, err := c.Download(ctx, "/notes/día 1 ✓ 😀.md", noLimit)
	if err != nil {
		t.Fatalf("%v (Dropbox-API-Arg %s)", err, stub.lastArg)
	}
	if f.Path != "/Notes/Día 1 ✓ 😀.md" || f.Rev != "0bee" || f.Size != 5 || string(f.Content) != "hola\n" {
		t.Errorf("file = %+v, content %q", f.Entry, f.Content)
	}

	if _, err := c.Download(ctx, "/Notes/missing.md", noLimit); !errors.Is(err, dropbox.ErrNotFound) {
		t.Errorf("missing: err = %v", err)
	}
	if _, err := c.Download(ctx, "/Notes", noLimit); !errors.Is(err, dropbox.ErrNotFile) {
		t.Errorf("folder: err = %v", err)
	}
}

func TestClientUploadsOnlyOverTheRevisionItWasGiven(t *testing.T) {
	stub := newStubDropbox(t)
	stub.folders = []string{"/Notes"}
	stub.files = []stubFile{{path: "/Notes/Día.md", rev: "0a1", content: []byte("old\n")}}
	c, _ := signedInClient(t, stub)

	e, err := c.UploadUpdate(ctx, "/notes/día.md", []byte("new\r\n"), "0a1")
	if err != nil {
		t.Fatalf("%v (Dropbox-API-Arg %s)", err, stub.lastArg)
	}
	if e.Path != "/Notes/Día.md" || e.Rev == "0a1" || e.Rev == "" || e.Size != 5 {
		t.Errorf("entry = %+v", e)
	}
	f, err := c.Download(ctx, "/Notes/Día.md", noLimit)
	if err != nil || string(f.Content) != "new\r\n" || f.Rev != e.Rev {
		t.Errorf("after upload: %+v %q, %v", f.Entry, f.Content, err)
	}

	if _, err := c.UploadUpdate(ctx, "/Notes/Día.md", []byte("stale"), "0a1"); !errors.Is(err, dropbox.ErrConflict) {
		t.Errorf("stale revision: err = %v", err)
	}
	if f, _ := c.Download(ctx, "/Notes/Día.md", noLimit); string(f.Content) != "new\r\n" {
		t.Errorf("a refused upload changed the file: %q", f.Content)
	}
}

func TestClientReportsMetadataWithoutDownloading(t *testing.T) {
	stub := newStubDropbox(t)
	stub.folders = []string{"/Notes"}
	stub.files = []stubFile{{path: "/Notes/Día.md", rev: "0a1", content: []byte("old\n")}}
	c, _ := signedInClient(t, stub)

	e, err := c.Metadata(ctx, "/notes/día.md")
	if err != nil || e.Path != "/Notes/Día.md" || e.Rev != "0a1" || e.Size != 4 || e.Folder {
		t.Errorf("file: %+v, %v", e, err)
	}
	if e, err := c.Metadata(ctx, "/notes"); err != nil || !e.Folder || e.Path != "/Notes" {
		t.Errorf("folder: %+v, %v", e, err)
	}
	if _, err := c.Metadata(ctx, "/gone.md"); !errors.Is(err, dropbox.ErrNotFound) {
		t.Errorf("missing: err = %v", err)
	}
}

func TestClientUploadsNewFilesOnlyWhereNothingIs(t *testing.T) {
	stub := newStubDropbox(t)
	stub.folders = []string{"/Notes"}
	stub.files = []stubFile{{path: "/Notes/Día.md", rev: "0a1", content: []byte("old\n")}}
	c, _ := signedInClient(t, stub)

	e, err := c.UploadNew(ctx, "/Notes/Día (copy).md", []byte("mine\n"))
	if err != nil {
		t.Fatalf("%v (Dropbox-API-Arg %s)", err, stub.lastArg)
	}
	if e.Path != "/Notes/Día (copy).md" || e.Rev == "" || e.Size != 5 {
		t.Errorf("entry = %+v", e)
	}
	if f, err := c.Download(ctx, "/Notes/Día (copy).md", noLimit); err != nil || string(f.Content) != "mine\n" {
		t.Errorf("after upload: %q, %v", f.Content, err)
	}

	for _, p := range []string{"/notes/día.md", "/Notes"} {
		if _, err := c.UploadNew(ctx, p, []byte("x")); !errors.Is(err, dropbox.ErrAlreadyExists) {
			t.Errorf("%s: err = %v, want already exists", p, err)
		}
	}
	if f, _ := c.Download(ctx, "/Notes/Día.md", noLimit); string(f.Content) != "old\n" {
		t.Errorf("a refused upload changed the file: %q", f.Content)
	}
}

func TestClientRefusesDownloadsOverTheLimit(t *testing.T) {
	stub := newStubDropbox(t)
	stub.files = []stubFile{{path: "/a.txt", rev: "1", content: []byte("12345678")}}
	c, _ := signedInClient(t, stub)
	if _, err := c.Download(ctx, "/a.txt", 7); !errors.Is(err, dropbox.ErrTooLarge) {
		t.Errorf("limit 7: err = %v", err)
	}
	if f, err := c.Download(ctx, "/a.txt", 8); err != nil || string(f.Content) != "12345678" {
		t.Errorf("limit 8: %+v, %v", f, err)
	}
}

func TestClientReportsRateLimitsAndOutagesAsPlainFailures(t *testing.T) {
	for _, status := range []int{http.StatusTooManyRequests, http.StatusInternalServerError, http.StatusServiceUnavailable} {
		stub := newStubDropbox(t)
		c, _ := signedInClient(t, stub)
		stub.failWith = status
		_, err := c.ListAll(ctx)
		if err == nil {
			t.Fatalf("%d: no error", status)
		}
		for _, sentinel := range []error{dropbox.ErrNotFound, dropbox.ErrReauthorize, dropbox.ErrConflict, dropbox.ErrBadCode} {
			if errors.Is(err, sentinel) {
				t.Errorf("%d: err = %v, which is %v", status, err, sentinel)
			}
		}
		if strings.Contains(err.Error(), "access-") || strings.Contains(err.Error(), "stored-refresh-token") {
			t.Errorf("%d: error leaks a token: %v", status, err)
		}
	}
}

var _ dropbox.Port = (*dropbox.Client)(nil)
