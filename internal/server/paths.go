package server

import (
	"net/http"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"
)

var errInvalidPath = &Error{
	Status:  http.StatusBadRequest,
	Code:    "invalid-path",
	Message: "The path is not a valid path inside the Root Folder.",
}

// cleanPath checks a client-supplied path, relative to the Root Folder (for
// example "Notes/today.md"), and returns it as a Dropbox port path
// ("/Notes/today.md"). It rejects anything that could name a place outside
// the Root Folder or confuse Dropbox: absolute paths, empty, "." and ".."
// segments (also when still percent-encoded), backslashes, control
// characters and invalid UTF-8.
func cleanPath(p string) (string, error) {
	if p == "" || !utf8.ValidString(p) || strings.ContainsRune(p, '\\') {
		return "", errInvalidPath
	}
	if strings.ContainsFunc(p, unicode.IsControl) {
		return "", errInvalidPath
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == "" || isTraversalSegment(seg) {
			return "", errInvalidPath
		}
	}
	return "/" + p, nil
}

// maxDecodeRounds bounds how many layers of percent-encoding
// isTraversalSegment peels off.
const maxDecodeRounds = 4

// isTraversalSegment reports whether seg is "." or "..", or becomes one, or
// gains a path separator, after further rounds of percent-decoding (a double-
// encoded traversal). A Dropbox file literally named like an encoded dot
// segment or separator ("%2e%2e", "a%2fb") is therefore unopenable: a
// deliberate trade of a rare name for a downstream that might decode again.
// Segments still encoded past maxDecodeRounds are rejected too.
func isTraversalSegment(seg string) bool {
	for range maxDecodeRounds {
		if seg == "." || seg == ".." || strings.ContainsAny(seg, `/\`) {
			return true
		}
		dec, err := url.PathUnescape(seg)
		if err != nil || dec == seg {
			return false
		}
		seg = dec
	}
	return true
}
