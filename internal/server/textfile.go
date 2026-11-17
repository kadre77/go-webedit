package server

import (
	"bytes"
	"strings"
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

// encodeText turns the editor's content (LF line endings) back into file
// bytes the way original (the file as it is in Dropbox) writes them: the
// same BOM and trailing-newline state, and the same line endings. Lines in
// the unchanged runs at the start and end of the file keep their own line
// endings, so saving unchanged content gives back the original bytes, mixed
// endings included; the lines in between get the file's dominant ending.
func encodeText(content string, original []byte) []byte {
	orig := decodeText(original)
	switch {
	case orig.TrailingNewline && content != "" && !strings.HasSuffix(content, "\n"):
		content += "\n"
	case !orig.TrailingNewline:
		content = strings.TrimRight(content, "\n")
	}
	if orig.BOM {
		original = original[len(utf8BOM):]
	}
	dominant := "\n"
	if orig.LineEnding == "crlf" {
		dominant = "\r\n"
	}

	// Both split into lines without their endings; the last part is what
	// follows the final newline and has no ending of its own.
	old := strings.Split(string(original), "\n")
	oldEndings := make([]string, len(old)) // each old line's own ending
	for i := range old[:len(old)-1] {
		oldEndings[i] = "\n"
		if s, ok := strings.CutSuffix(old[i], "\r"); ok {
			old[i], oldEndings[i] = s, "\r\n"
		}
	}
	lines := strings.Split(content, "\n")

	newEndings := make([]string, len(lines)) // the ending each new line gets
	for i := range lines[:len(lines)-1] {
		newEndings[i] = dominant
	}
	prefix := 0
	for prefix < min(len(lines), len(old)) && lines[prefix] == old[prefix] {
		if oldEndings[prefix] != "" && prefix < len(lines)-1 {
			newEndings[prefix] = oldEndings[prefix]
		}
		prefix++
	}
	for k := 0; k < min(len(lines), len(old))-prefix; k++ {
		i, j := len(lines)-1-k, len(old)-1-k
		if lines[i] != old[j] {
			break
		}
		if oldEndings[j] != "" {
			newEndings[i] = oldEndings[j]
		}
	}

	var b bytes.Buffer
	if orig.BOM {
		b.Write(utf8BOM)
	}
	for i, l := range lines {
		b.WriteString(l)
		b.WriteString(newEndings[i])
	}
	return b.Bytes()
}
