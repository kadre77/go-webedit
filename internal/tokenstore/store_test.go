package tokenstore_test

import (
	"bytes"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/kadre77/webedit/internal/tokenstore"
)

var (
	key      = bytes.Repeat([]byte{1}, 32)
	otherKey = bytes.Repeat([]byte{2}, 32)
)

const token = "sl.refresh-token-ABCDEFGHIJKLMNOP"

func TestSavedTokenSurvivesReopening(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data", "refresh-token")
	s, err := tokenstore.Open(path, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Save(token); err != nil {
		t.Fatal(err)
	}
	if got, err := s.RefreshToken(); err != nil || got != token {
		t.Errorf("same store: %q, %v", got, err)
	}
	reopened, err := tokenstore.Open(path, key)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := reopened.RefreshToken(); err != nil || got != token {
		t.Errorf("reopened: %q, %v", got, err)
	}
}

func TestNoTokenUntilSaved(t *testing.T) {
	s, err := tokenstore.Open(filepath.Join(t.TempDir(), "refresh-token"), key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.RefreshToken(); !errors.Is(err, tokenstore.ErrNoToken) {
		t.Errorf("err = %v", err)
	}
}

func TestSavingReplacesTheEarlierToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "refresh-token")
	s, _ := tokenstore.Open(path, key)
	s.Save("first")
	if err := s.Save("second"); err != nil {
		t.Fatal(err)
	}
	reopened, err := tokenstore.Open(path, key)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := reopened.RefreshToken(); got != "second" {
		t.Errorf("token = %q", got)
	}
}

func TestTheFileHoldsNoPlaintextToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "refresh-token")
	s, _ := tokenstore.Open(path, key)
	if err := s.Save(token); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, form := range []string{token, base64.StdEncoding.EncodeToString([]byte(token)), "refresh-token-ABC"} {
		if bytes.Contains(raw, []byte(form)) {
			t.Errorf("file contains %q", form)
		}
	}
	if fi, _ := os.Stat(path); fi.Mode().Perm()&0o077 != 0 {
		t.Errorf("file mode = %v, want owner-only", fi.Mode().Perm())
	}
}

func TestTheWrongKeyFailsClearly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "refresh-token")
	s, _ := tokenstore.Open(path, key)
	s.Save(token)
	if _, err := tokenstore.Open(path, otherKey); !errors.Is(err, tokenstore.ErrWrongKey) {
		t.Errorf("err = %v, want ErrWrongKey", err)
	}
}

func TestATamperedFileIsRefused(t *testing.T) {
	path := filepath.Join(t.TempDir(), "refresh-token")
	s, _ := tokenstore.Open(path, key)
	s.Save(token)
	raw, _ := os.ReadFile(path)
	raw[len(raw)-1] ^= 1
	os.WriteFile(path, raw, 0o600)
	if _, err := tokenstore.Open(path, key); err == nil {
		t.Error("tampered file opened")
	}
}
