package dropbox

import (
	"context"
	"errors"
)

// ErrNotConnected is returned by NotConnected for every call.
var ErrNotConnected = errors.New("dropbox: no Dropbox adapter is configured")

// NotConnected is the Port used outside test mode until the real Dropbox
// adapter exists (ticket 03). Every call fails.
type NotConnected struct{}

func (NotConnected) ExchangeCode(context.Context, string, string, string) (Token, error) {
	return Token{}, ErrNotConnected
}
func (NotConnected) CurrentAccountID(context.Context) (string, error) { return "", ErrNotConnected }
func (NotConnected) ListAll(context.Context) ([]Entry, error)         { return nil, ErrNotConnected }
func (NotConnected) Download(context.Context, string, int64) (File, error) {
	return File{}, ErrNotConnected
}
func (NotConnected) UploadUpdate(context.Context, string, []byte, string) (Entry, error) {
	return Entry{}, ErrNotConnected
}
func (NotConnected) UploadNew(context.Context, string, []byte) (Entry, error) {
	return Entry{}, ErrNotConnected
}
func (NotConnected) CreateFolder(context.Context, string) (Entry, error) {
	return Entry{}, ErrNotConnected
}
func (NotConnected) Move(context.Context, string, string) (Entry, error) {
	return Entry{}, ErrNotConnected
}
func (NotConnected) Delete(context.Context, string) error { return ErrNotConnected }
