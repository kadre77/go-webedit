// Package dropbox is the Dropbox port: the one interface through which the
// server reaches Dropbox, plus an in-memory fake used by tests and test mode.
//
// Paths at this interface are Dropbox paths inside the Root Folder (the App
// Folder): "/notes/today.md", with "" meaning the Root Folder itself. They
// reach the port already cleaned by the server. Like Dropbox, the port treats
// paths case-insensitively and reports each entry's display case.
package dropbox

import (
	"context"
	"errors"
)

// Errors every Port implementation returns (possibly wrapped) so the server
// can tell outcomes apart.
var (
	ErrNotFound      = errors.New("dropbox: not found")
	ErrAlreadyExists = errors.New("dropbox: something already exists at the path")
	ErrConflict      = errors.New("dropbox: revision does not match")
	ErrNotFile       = errors.New("dropbox: not a file")
	ErrTooLarge      = errors.New("dropbox: file is over the size limit")
	ErrInvalidMove   = errors.New("dropbox: invalid move")
	ErrBadCode       = errors.New("dropbox: authorization code rejected")
)

// Entry is one file or folder.
type Entry struct {
	Path   string // display case, e.g. "/Notes/Today.md"
	Folder bool
	Size   int64  // files only
	Rev    string // files only
}

// File is a downloaded file.
type File struct {
	Entry
	Content []byte
}

// Token is the result of an OAuth code exchange.
type Token struct {
	RefreshToken string
	AccountID    string
}

// Port is everything the app needs from Dropbox.
type Port interface {
	// ExchangeCode trades an OAuth authorization code (with its PKCE
	// verifier) for a refresh token. Access-token refresh happens inside the
	// implementation.
	ExchangeCode(ctx context.Context, code, codeVerifier, redirectURI string) (Token, error)
	// CurrentAccountID returns the signed-in Dropbox account's ID.
	CurrentAccountID(ctx context.Context) (string, error)

	// ListAll lists every entry under the Root Folder, recursively.
	ListAll(ctx context.Context) ([]Entry, error)
	// Download returns a file's content and current revision. A file larger
	// than maxSize bytes fails with ErrTooLarge without its content being read.
	Download(ctx context.Context, path string, maxSize int64) (File, error)
	// UploadUpdate overwrites an existing file only if its revision is still
	// rev; otherwise it fails with ErrConflict.
	UploadUpdate(ctx context.Context, path string, content []byte, rev string) (Entry, error)
	// UploadNew writes a new file and fails with ErrAlreadyExists if
	// anything is at the path. Missing parent folders are created.
	UploadNew(ctx context.Context, path string, content []byte) (Entry, error)
	// CreateFolder creates a folder (and missing parents), failing with
	// ErrAlreadyExists if anything is at the path.
	CreateFolder(ctx context.Context, path string) (Entry, error)
	// Move renames or moves a file or folder, failing with ErrAlreadyExists
	// if the destination exists. A change of case only is allowed.
	Move(ctx context.Context, from, to string) (Entry, error)
	// Delete deletes a file or a folder with everything in it.
	Delete(ctx context.Context, path string) error
}
