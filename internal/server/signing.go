package server

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"strings"
)

// signer signs cookie values with the session secret. Each kind of cookie
// signs under its own purpose, so one can't be passed off as another.
// Rotating the secret invalidates everything it signed.
type signer struct {
	secret []byte
}

func (s signer) mac(purpose, payload string) []byte {
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte(purpose))
	m.Write([]byte{0})
	m.Write([]byte(payload))
	return m.Sum(nil)
}

// sign returns payload with its signature, safe to use as a cookie value.
func (s signer) sign(purpose, payload string) string {
	enc := base64.RawURLEncoding
	return enc.EncodeToString([]byte(payload)) + "." + enc.EncodeToString(s.mac(purpose, payload))
}

// verify returns the payload of a value made by sign with the same purpose.
func (s signer) verify(purpose, value string) (string, bool) {
	enc := base64.RawURLEncoding
	p, sig, ok := strings.Cut(value, ".")
	if !ok {
		return "", false
	}
	payload, err1 := enc.DecodeString(p)
	got, err2 := enc.DecodeString(sig)
	if err1 != nil || err2 != nil || !hmac.Equal(got, s.mac(purpose, string(payload))) {
		return "", false
	}
	return string(payload), true
}

// randomToken returns 32 random bytes, base64url-encoded (43 characters):
// suitable as an OAuth state or a PKCE code verifier.
func randomToken() string {
	b := make([]byte, 32)
	rand.Read(b) // never fails; see crypto/rand
	return base64.RawURLEncoding.EncodeToString(b)
}
