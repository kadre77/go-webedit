package dropbox_test

// These tests pin down the Dropbox behaviours the app relies on, so the fake
// can't drift into being more forgiving than Dropbox.

import (
	"context"
	"errors"
	"io/fs"
	"testing"
	"testing/fstest"

	"github.com/kadre77/webedit/internal/dropbox"
)

var ctx = context.Background()

const noLimit = 1 << 20

func seeded(t *testing.T) *dropbox.Fake {
	t.Helper()
	f, err := dropbox.NewFake("dbid:owner", fstest.MapFS{
		"Notes/Today.md":     {Data: []byte("# Today\n")},
		"Notes/Old/2020.txt": {Data: []byte("old")},
		"readme.md":          {Data: []byte("hi")},
		"Empty":              {Mode: fs.ModeDir | 0o755},
	})
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func TestFakeListsSeededEntriesWithDisplayCase(t *testing.T) {
	entries, err := seeded(t).ListAll(ctx)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]dropbox.Entry{}
	for _, e := range entries {
		got[e.Path] = e
	}
	want := map[string]bool{ // path -> folder
		"/Notes": true, "/Notes/Today.md": false, "/Notes/Old": true,
		"/Notes/Old/2020.txt": false, "/readme.md": false, "/Empty": true,
	}
	if len(got) != len(want) {
		t.Errorf("entries = %v", entries)
	}
	for p, folder := range want {
		e, ok := got[p]
		if !ok {
			t.Errorf("missing %s in %v", p, entries)
			continue
		}
		if e.Folder != folder {
			t.Errorf("%s: folder = %v", p, e.Folder)
		}
	}
	if e := got["/Notes/Today.md"]; e.Size != 8 || e.Rev == "" {
		t.Errorf("Today.md = %+v", e)
	}
}

func TestFakeDownloadReturnsContentAndRevision(t *testing.T) {
	f, err := seeded(t).Download(ctx, "/Notes/Today.md", noLimit)
	if err != nil {
		t.Fatal(err)
	}
	if string(f.Content) != "# Today\n" || f.Rev == "" || f.Path != "/Notes/Today.md" {
		t.Errorf("file = %+v", f)
	}
}

func TestFakeDownloadMissingOrFolder(t *testing.T) {
	fake := seeded(t)
	if _, err := fake.Download(ctx, "/nope.md", noLimit); !errors.Is(err, dropbox.ErrNotFound) {
		t.Errorf("missing: err = %v", err)
	}
	if _, err := fake.Download(ctx, "/Notes", noLimit); !errors.Is(err, dropbox.ErrNotFile) {
		t.Errorf("folder: err = %v", err)
	}
}

func TestFakeRevisionChangesOnEveryWrite(t *testing.T) {
	fake := seeded(t)
	f, _ := fake.Download(ctx, "/readme.md", noLimit)
	first, err := fake.UploadUpdate(ctx, "/readme.md", []byte("hi"), f.Rev)
	if err != nil {
		t.Fatal(err)
	}
	if first.Rev == f.Rev {
		t.Errorf("rewriting the same content kept revision %s", f.Rev)
	}
	second, err := fake.UploadUpdate(ctx, "/readme.md", []byte("two"), first.Rev)
	if err != nil {
		t.Fatal(err)
	}
	if second.Rev == first.Rev {
		t.Errorf("second write kept revision %s", first.Rev)
	}
	got, _ := fake.Download(ctx, "/readme.md", noLimit)
	if string(got.Content) != "two" || got.Rev != second.Rev || got.Size != 3 {
		t.Errorf("after writes: %+v", got)
	}
}

func TestFakeConditionalUploadConflictsOnStaleRevision(t *testing.T) {
	fake := seeded(t)
	opened, _ := fake.Download(ctx, "/readme.md", noLimit)
	if _, err := fake.UploadUpdate(ctx, "/readme.md", []byte("elsewhere"), opened.Rev); err != nil {
		t.Fatal(err)
	}
	_, err := fake.UploadUpdate(ctx, "/readme.md", []byte("mine"), opened.Rev)
	if !errors.Is(err, dropbox.ErrConflict) {
		t.Fatalf("err = %v, want conflict", err)
	}
	got, _ := fake.Download(ctx, "/readme.md", noLimit)
	if string(got.Content) != "elsewhere" {
		t.Errorf("content = %q; the conflicting upload must not land", got.Content)
	}
	if _, err := fake.UploadUpdate(ctx, "/gone.md", []byte("x"), opened.Rev); !errors.Is(err, dropbox.ErrConflict) {
		t.Errorf("update of a missing file: err = %v, want conflict", err)
	}
}

func TestFakeUploadNewCreatesFileAndParents(t *testing.T) {
	fake := seeded(t)
	e, err := fake.UploadNew(ctx, "/Notes/New/idea.md", []byte("idea"))
	if err != nil {
		t.Fatal(err)
	}
	if e.Path != "/Notes/New/idea.md" || e.Rev == "" {
		t.Errorf("entry = %+v", e)
	}
	got, err := fake.Download(ctx, "/Notes/New/idea.md", noLimit)
	if err != nil || string(got.Content) != "idea" {
		t.Errorf("download: %+v, %v", got, err)
	}
}

func TestFakePathsAreCaseInsensitiveButKeepDisplayCase(t *testing.T) {
	fake := seeded(t)
	f, err := fake.Download(ctx, "/NOTES/today.MD", noLimit)
	if err != nil {
		t.Fatal(err)
	}
	if f.Path != "/Notes/Today.md" {
		t.Errorf("path = %q, want the display case", f.Path)
	}
	if _, err := fake.UploadUpdate(ctx, "/notes/TODAY.md", []byte("x"), f.Rev); err != nil {
		t.Errorf("update through another case: %v", err)
	}
	// A new file under an existing folder keeps the folder's case and its own.
	e, err := fake.UploadNew(ctx, "/notes/Tomorrow.MD", []byte("x"))
	if err != nil {
		t.Fatal(err)
	}
	if e.Path != "/Notes/Tomorrow.MD" {
		t.Errorf("new file path = %q", e.Path)
	}
}

func TestFakeCreateOntoExistingPathFails(t *testing.T) {
	fake := seeded(t)
	for _, p := range []string{"/readme.md", "/README.MD", "/Notes"} {
		if _, err := fake.UploadNew(ctx, p, []byte("x")); !errors.Is(err, dropbox.ErrAlreadyExists) {
			t.Errorf("UploadNew %s: err = %v", p, err)
		}
		if _, err := fake.CreateFolder(ctx, p); !errors.Is(err, dropbox.ErrAlreadyExists) {
			t.Errorf("CreateFolder %s: err = %v", p, err)
		}
	}
	if _, err := fake.UploadNew(ctx, "/readme.md/child.md", []byte("x")); !errors.Is(err, dropbox.ErrAlreadyExists) {
		t.Errorf("file under a file: err = %v", err)
	}
	got, _ := fake.Download(ctx, "/readme.md", noLimit)
	if string(got.Content) != "hi" {
		t.Errorf("readme.md was overwritten: %q", got.Content)
	}
}

func TestFakeCreateFolder(t *testing.T) {
	fake := seeded(t)
	e, err := fake.CreateFolder(ctx, "/notes/Drafts")
	if err != nil {
		t.Fatal(err)
	}
	if e.Path != "/Notes/Drafts" || !e.Folder {
		t.Errorf("entry = %+v", e)
	}
	if _, err := fake.UploadNew(ctx, "/Notes/Drafts/a.md", []byte("a")); err != nil {
		t.Errorf("file in new folder: %v", err)
	}
}

func TestFakeMoveRenamesFilesAndFolders(t *testing.T) {
	fake := seeded(t)
	e, err := fake.Move(ctx, "/Notes", "/Archive/Notes2")
	if err != nil {
		t.Fatal(err)
	}
	if e.Path != "/Archive/Notes2" || !e.Folder {
		t.Errorf("entry = %+v", e)
	}
	f, err := fake.Download(ctx, "/archive/notes2/old/2020.txt", noLimit)
	if err != nil || f.Path != "/Archive/Notes2/Old/2020.txt" || string(f.Content) != "old" {
		t.Errorf("moved child: %+v, %v", f, err)
	}
	if _, err := fake.Download(ctx, "/Notes/Today.md", noLimit); !errors.Is(err, dropbox.ErrNotFound) {
		t.Errorf("old path still there: %v", err)
	}
	// A change of case only is a rename of the same entry.
	if e, err := fake.Move(ctx, "/readme.md", "/README.md"); err != nil || e.Path != "/README.md" {
		t.Errorf("case-only rename: %+v, %v", e, err)
	}
}

func TestFakeMoveOntoExistingPathFails(t *testing.T) {
	fake := seeded(t)
	for _, to := range []string{"/Notes/Today.md", "/notes/today.md", "/Notes"} {
		if _, err := fake.Move(ctx, "/readme.md", to); !errors.Is(err, dropbox.ErrAlreadyExists) {
			t.Errorf("move onto %s: err = %v", to, err)
		}
	}
	if _, err := fake.Move(ctx, "/nope", "/elsewhere"); !errors.Is(err, dropbox.ErrNotFound) {
		t.Errorf("move missing: err = %v", err)
	}
	if _, err := fake.Move(ctx, "/Notes", "/Notes/Old/Notes"); !errors.Is(err, dropbox.ErrInvalidMove) {
		t.Errorf("move into itself: err = %v", err)
	}
	got, _ := fake.Download(ctx, "/Notes/Today.md", noLimit)
	if string(got.Content) != "# Today\n" {
		t.Errorf("destination was overwritten: %q", got.Content)
	}
}

func TestFakeDeleteRemovesFoldersRecursively(t *testing.T) {
	fake := seeded(t)
	if err := fake.Delete(ctx, "/notes"); err != nil {
		t.Fatal(err)
	}
	entries, _ := fake.ListAll(ctx)
	for _, e := range entries {
		if e.Path == "/Notes" || len(e.Path) > 6 && e.Path[:7] == "/Notes/" {
			t.Errorf("still listed: %s", e.Path)
		}
	}
	if err := fake.Delete(ctx, "/notes"); !errors.Is(err, dropbox.ErrNotFound) {
		t.Errorf("second delete: err = %v", err)
	}
}

func TestFakeSignsInAsItsAccount(t *testing.T) {
	fake := seeded(t)
	tok, err := fake.ExchangeCode(ctx, "code", "verifier", "http://localhost/cb")
	if err != nil || tok.AccountID != "dbid:owner" || tok.RefreshToken == "" {
		t.Errorf("token = %+v, %v", tok, err)
	}
	if _, err := fake.ExchangeCode(ctx, "", "verifier", "http://localhost/cb"); !errors.Is(err, dropbox.ErrBadCode) {
		t.Errorf("empty code: err = %v", err)
	}
	if id, err := fake.CurrentAccountID(ctx); err != nil || id != "dbid:owner" {
		t.Errorf("account = %q, %v", id, err)
	}
}

var _ dropbox.Port = (*dropbox.Fake)(nil)

func TestFakeDownloadRefusesFilesOverTheLimit(t *testing.T) {
	fake := seeded(t)
	if _, err := fake.Download(ctx, "/Notes/Today.md", 7); !errors.Is(err, dropbox.ErrTooLarge) {
		t.Errorf("8-byte file, limit 7: err = %v", err)
	}
	if f, err := fake.Download(ctx, "/Notes/Today.md", 8); err != nil || f.Size != 8 {
		t.Errorf("8-byte file, limit 8: %+v, %v", f, err)
	}
}
