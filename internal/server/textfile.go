package server

import (
	"bytes"
	"unicode/utf8"
)

var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

// textFile is a Text File as the editor sees it: LF line endings, no BOM,
// plus the facts needed to write it back the way it was.
type textFile struct {
	Content         string `json:"content"`
	LineEnding      string `json:"lineEnding"` // "lf" or "crlf"
	TrailingNewline bool   `json:"trailingNewline"`
	BOM             bool   `json:"bom"`
}

// isBinary reports whether raw is a Binary File: not valid UTF-8, or
// containing a null byte.
func isBinary(raw []byte) bool {
	return !utf8.Valid(raw) || bytes.IndexByte(raw, 0) >= 0
}

// decodeText converts raw file bytes (already known to be text) to the
// editor's form. The line ending is CRLF when most line breaks are CRLF.
func decodeText(raw []byte) textFile {
	var tf textFile
	if bytes.HasPrefix(raw, utf8BOM) {
		tf.BOM, raw = true, raw[len(utf8BOM):]
	}
	crlf := bytes.Count(raw, []byte("\r\n"))
	lf := bytes.Count(raw, []byte("\n")) - crlf
	tf.LineEnding = "lf"
	if crlf > lf {
		tf.LineEnding = "crlf"
	}
	tf.TrailingNewline = bytes.HasSuffix(raw, []byte("\n"))
	tf.Content = string(bytes.ReplaceAll(raw, []byte("\r\n"), []byte("\n")))
	return tf
}
