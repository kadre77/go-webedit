// Package tokenstore keeps the Owner's Dropbox refresh token in a file in the
// data directory, encrypted with AES-256-GCM under the token-encryption key.
// The decrypted token lives only in memory.
package tokenstore

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
)

var (
	// ErrNoToken means no refresh token has been saved yet.
	ErrNoToken = errors.New("tokenstore: no refresh token saved")
	// ErrWrongKey means the file can't be decrypted with the key: the key
	// changed, or the file was damaged or tampered with.
	ErrWrongKey = errors.New("tokenstore: the refresh-token file can't be decrypted with this key")
)

// fileVersion is the first byte of the file, so the format can change later;
// additionalData names the same version inside the authenticated data.
const fileVersion = 1

var additionalData = []byte("webedit refresh token v1")

// Store is the encrypted refresh-token file. It is safe for concurrent use.
type Store struct {
	path string
	aead cipher.AEAD

	mu    sync.RWMutex
	token string
}

// Open reads the token file at path, if there is one, with key (32 bytes).
// A file that doesn't decrypt fails with ErrWrongKey.
func Open(path string, key []byte) (*Store, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("tokenstore: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("tokenstore: %w", err)
	}
	s := &Store{path: path, aead: aead}
	raw, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, fmt.Errorf("tokenstore: %w", err)
	}
	n := aead.NonceSize()
	if len(raw) < 1+n || raw[0] != fileVersion {
		return nil, fmt.Errorf("%w (%s)", ErrWrongKey, path)
	}
	plain, err := aead.Open(nil, raw[1:1+n], raw[1+n:], additionalData)
	if err != nil {
		return nil, fmt.Errorf("%w (%s)", ErrWrongKey, path)
	}
	s.token = string(plain)
	return s, nil
}

// RefreshToken returns the saved token, or ErrNoToken.
func (s *Store) RefreshToken() (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.token == "" {
		return "", ErrNoToken
	}
	return s.token, nil
}

// Save encrypts token and replaces the file atomically, creating the data
// directory if needed. The file is readable by its owner only.
func (s *Store) Save(token string) error {
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return fmt.Errorf("tokenstore: %w", err)
	}
	out := append([]byte{fileVersion}, nonce...)
	out = s.aead.Seal(out, nonce, []byte(token), additionalData)

	s.mu.Lock()
	defer s.mu.Unlock()
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("tokenstore: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".refresh-token-*")
	if err != nil {
		return fmt.Errorf("tokenstore: %w", err)
	}
	defer os.Remove(tmp.Name()) // a no-op once renamed
	_, werr := tmp.Write(out)
	serr := tmp.Sync()
	cerr := tmp.Close()
	if err := errors.Join(werr, serr, cerr); err != nil {
		return fmt.Errorf("tokenstore: %w", err)
	}
	if err := os.Rename(tmp.Name(), s.path); err != nil {
		return fmt.Errorf("tokenstore: %w", err)
	}
	s.token = token
	return nil
}
