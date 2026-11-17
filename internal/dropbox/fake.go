package dropbox

import (
	"context"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"sync"
)

// Fake is an in-memory Dropbox for tests and test mode. It behaves like
// Dropbox where the app depends on it: every write gets a new revision,
// conditional uploads conflict on a stale revision, paths are
// case-insensitive but keep their display case, and creating or moving onto
// an existing path fails.
type Fake struct {
	mu        sync.Mutex
	accountID string
	nodes     map[string]*node // keyed by lower-case path
	revs      int
}

type node struct {
	path    string // display case
	folder  bool
	content []byte
	rev     string
}

// NewFake returns a fake for the given account, seeded with the files and
// folders in seed (which may be nil).
func NewFake(accountID string, seed fs.FS) (*Fake, error) {
	f := &Fake{accountID: accountID, nodes: map[string]*node{}}
	if seed == nil {
		return f, nil
	}
	err := fs.WalkDir(seed, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil || name == "." {
			return err
		}
		p := "/" + name
		if d.IsDir() {
			return f.put(p, &node{folder: true})
		}
		content, err := fs.ReadFile(seed, name)
		if err != nil {
			return err
		}
		return f.put(p, &node{content: content, rev: f.nextRev()})
	})
	if err != nil {
		return nil, fmt.Errorf("seeding fake Dropbox: %w", err)
	}
	return f, nil
}

func key(p string) string { return strings.ToLower(p) }

func parentOf(p string) string { return p[:strings.LastIndex(p, "/")] }

func (f *Fake) nextRev() string {
	f.revs++
	return fmt.Sprintf("%09x", f.revs)
}

// put stores n at p, creating missing parent folders. The display path keeps
// the parents' existing case and the case of p's last segment. It fails with
// ErrAlreadyExists if a parent is a file.
func (f *Fake) put(p string, n *node) error {
	parent := ""
	if pp := parentOf(p); pp != "" {
		existing, ok := f.nodes[key(pp)]
		switch {
		case !ok:
			if err := f.put(pp, &node{folder: true}); err != nil {
				return err
			}
			existing = f.nodes[key(pp)]
		case !existing.folder:
			return fmt.Errorf("%w: parent of %s is a file", ErrAlreadyExists, p)
		}
		parent = existing.path
	}
	n.path = parent + p[strings.LastIndex(p, "/"):]
	f.nodes[key(p)] = n
	return nil
}

func (n *node) entry() Entry {
	return Entry{Path: n.path, Folder: n.folder, Size: int64(len(n.content)), Rev: n.rev}
}

// ListAll implements Port.
func (f *Fake) ListAll(context.Context) ([]Entry, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	entries := make([]Entry, 0, len(f.nodes))
	for _, n := range f.nodes {
		entries = append(entries, n.entry())
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })
	return entries, nil
}

// Download implements Port.
func (f *Fake) Download(_ context.Context, p string, maxSize int64) (File, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	n, ok := f.nodes[key(p)]
	switch {
	case !ok:
		return File{}, fmt.Errorf("%w: %s", ErrNotFound, p)
	case n.folder:
		return File{}, fmt.Errorf("%w: %s", ErrNotFile, p)
	case int64(len(n.content)) > maxSize:
		return File{}, fmt.Errorf("%w: %s", ErrTooLarge, p)
	}
	return File{Entry: n.entry(), Content: append([]byte(nil), n.content...)}, nil
}

// UploadUpdate implements Port.
func (f *Fake) UploadUpdate(_ context.Context, p string, content []byte, rev string) (Entry, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	n, ok := f.nodes[key(p)]
	if !ok || n.folder || n.rev != rev {
		return Entry{}, fmt.Errorf("%w: %s", ErrConflict, p)
	}
	n.content = append([]byte(nil), content...)
	n.rev = f.nextRev()
	return n.entry(), nil
}

// UploadNew implements Port.
func (f *Fake) UploadNew(_ context.Context, p string, content []byte) (Entry, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.create(p, &node{content: append([]byte(nil), content...), rev: f.nextRev()})
}

// create stores n at p unless something is already there.
func (f *Fake) create(p string, n *node) (Entry, error) {
	if _, ok := f.nodes[key(p)]; ok {
		return Entry{}, fmt.Errorf("%w: %s", ErrAlreadyExists, p)
	}
	if err := f.put(p, n); err != nil {
		return Entry{}, err
	}
	return n.entry(), nil
}

// CreateFolder implements Port.
func (f *Fake) CreateFolder(_ context.Context, p string) (Entry, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.create(p, &node{folder: true})
}

// subtree returns the lower-case keys of the entry at k and everything under it.
func (f *Fake) subtree(k string) []string {
	var keys []string
	for nk := range f.nodes {
		if nk == k || strings.HasPrefix(nk, k+"/") {
			keys = append(keys, nk)
		}
	}
	return keys
}

// Move implements Port.
func (f *Fake) Move(_ context.Context, from, to string) (Entry, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fk, tk := key(from), key(to)
	root, ok := f.nodes[fk]
	switch {
	case !ok:
		return Entry{}, fmt.Errorf("%w: %s", ErrNotFound, from)
	case strings.HasPrefix(tk, fk+"/"):
		return Entry{}, fmt.Errorf("%w: %s into itself", ErrInvalidMove, from)
	case tk != fk && f.nodes[tk] != nil:
		return Entry{}, fmt.Errorf("%w: %s", ErrAlreadyExists, to)
	}
	moved := map[string]*node{}
	for _, k := range f.subtree(fk) {
		moved[k] = f.nodes[k]
		delete(f.nodes, k)
	}
	oldPath := root.path
	if err := f.put(to, root); err != nil {
		root.path = oldPath
		for k, n := range moved {
			f.nodes[k] = n
		}
		return Entry{}, err
	}
	for k, n := range moved {
		if k != fk {
			n.path = root.path + n.path[len(oldPath):]
			f.nodes[key(n.path)] = n
		}
	}
	return root.entry(), nil
}

// Delete implements Port.
func (f *Fake) Delete(_ context.Context, p string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	keys := f.subtree(key(p))
	if len(keys) == 0 {
		return fmt.Errorf("%w: %s", ErrNotFound, p)
	}
	for _, k := range keys {
		delete(f.nodes, k)
	}
	return nil
}

// ExchangeCode implements Port: any non-empty code signs in as the fake's
// account.
func (f *Fake) ExchangeCode(_ context.Context, code, _, _ string) (Token, error) {
	if code == "" {
		return Token{}, ErrBadCode
	}
	return Token{RefreshToken: "fake-refresh-token", AccountID: f.accountID}, nil
}

// CurrentAccountID implements Port.
func (f *Fake) CurrentAccountID(context.Context) (string, error) {
	return f.accountID, nil
}
