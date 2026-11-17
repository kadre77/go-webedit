package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/kadre77/webedit/internal/dropbox"
)

// maxTextFileSize is the largest file the app opens (5 MB).
const maxTextFileSize = 5 * 1024 * 1024

// maxSaveBody caps a save request's body: 5 MB of content, with room for
// JSON escaping.
const maxSaveBody = 4 * maxTextFileSize

var errTooLarge = &Error{Status: http.StatusRequestEntityTooLarge, Code: "too-large", Message: "The file is over 5 MB."}

type fileHandlers struct {
	port dropbox.Port
}

// apiPath turns a Dropbox port path into the API's form, relative to the
// Root Folder (the inverse of cleanPath).
func apiPath(p string) string { return strings.TrimPrefix(p, "/") }

// treeEntry is one entry of the tree API. Paths are relative to the Root
// Folder, in display case.
type treeEntry struct {
	Path     string `json:"path"`
	Kind     string `json:"kind"` // "file" or "folder"
	Size     int64  `json:"size,omitempty"`
	Openable bool   `json:"openable,omitempty"`
	Reason   string `json:"reason,omitempty"` // why a file isn't openable
}

func (h *fileHandlers) tree(c echo.Context) error {
	entries, err := h.port.ListAll(c.Request().Context())
	if err != nil {
		return dropboxError(err)
	}
	out := make([]treeEntry, 0, len(entries))
	for _, e := range entries {
		te := treeEntry{Path: apiPath(e.Path), Kind: "folder"}
		if !e.Folder {
			te.Kind, te.Size = "file", e.Size
			if e.Size > maxTextFileSize {
				te.Reason = "too-large"
			} else {
				te.Openable = true
			}
		}
		out = append(out, te)
	}
	return c.JSON(http.StatusOK, map[string]any{"entries": out})
}

// dropboxError turns a Dropbox port error into an API error.
func dropboxError(err error) error {
	switch {
	case errors.Is(err, dropbox.ErrReauthorize):
		return &Error{Status: http.StatusUnauthorized, Code: "reauthorize", Message: "Dropbox no longer accepts this app's authorization. Sign in again.", Err: err}
	case errors.Is(err, dropbox.ErrNotFound):
		return &Error{Status: http.StatusNotFound, Code: "not-found", Message: "No such file or folder."}
	case errors.Is(err, dropbox.ErrTooLarge):
		return errTooLarge
	case errors.Is(err, dropbox.ErrNotFile):
		return &Error{Status: http.StatusBadRequest, Code: "not-a-file", Message: "That is a folder, not a file."}
	case errors.Is(err, dropbox.ErrAlreadyExists):
		return &Error{Status: http.StatusConflict, Code: "already-exists", Message: "Something already exists at that path."}
	case errors.Is(err, dropbox.ErrConflict):
		return &Error{Status: http.StatusConflict, Code: "conflict", Message: "The file changed in Dropbox."}
	}
	return &Error{
		Status:  http.StatusServiceUnavailable,
		Code:    "dropbox-unavailable",
		Message: "Dropbox could not be reached. Try again.",
		Err:     err,
	}
}

// saveConflict is the Save Conflict error, with the file's current revision.
func saveConflict(rev string) error {
	return &Error{Status: http.StatusConflict, Code: "conflict", Message: "The file changed in Dropbox since it was opened.", Rev: rev}
}

// openedFile is the open-file API's response.
type openedFile struct {
	Path string `json:"path"`
	Rev  string `json:"rev"`
	textFile
}

func (h *fileHandlers) open(c echo.Context) error {
	p, err := cleanPath(c.QueryParam("path"))
	if err != nil {
		return err
	}
	f, err := h.port.Download(c.Request().Context(), p, maxTextFileSize)
	if err != nil {
		return dropboxError(err)
	}
	if isBinary(f.Content) {
		return &Error{Status: http.StatusUnsupportedMediaType, Code: "binary-file", Message: "The file is not a text file."}
	}
	return c.JSON(http.StatusOK, openedFile{
		Path:     apiPath(f.Path),
		Rev:      f.Rev,
		textFile: decodeText(f.Content),
	})
}

// saveRequest is the save-file API's body: the editor's content (LF line
// endings) and the revision the file was opened at.
type saveRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Rev     string `json:"rev"`
}

// savedFile is the save-file API's response.
type savedFile struct {
	Path string `json:"path"`
	Rev  string `json:"rev"`
}

func (h *fileHandlers) save(c echo.Context) error {
	var req saveRequest
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, maxSaveBody)
	if err := json.NewDecoder(c.Request().Body).Decode(&req); err != nil {
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			return errTooLarge
		}
		return &Error{Status: http.StatusBadRequest, Code: "bad-request", Message: "The request body is not a save request."}
	}
	p, err := cleanPath(req.Path)
	if err != nil {
		return err
	}
	if req.Rev == "" {
		return &Error{Status: http.StatusBadRequest, Code: "bad-request", Message: "A save needs the revision the file was opened at."}
	}
	ctx := c.Request().Context()
	current, err := h.port.Download(ctx, p, maxTextFileSize)
	if err != nil {
		return dropboxError(err)
	}
	if current.Rev != req.Rev {
		return saveConflict(current.Rev)
	}
	raw := encodeText(req.Content, current.Content)
	if len(raw) > maxTextFileSize {
		return errTooLarge
	}
	e, err := h.port.UploadUpdate(ctx, p, raw, req.Rev)
	if errors.Is(err, dropbox.ErrConflict) {
		// Changed in Dropbox since the download just now: look again for
		// the revision it has now.
		now, err := h.port.Download(ctx, p, maxTextFileSize)
		if err != nil {
			return dropboxError(err)
		}
		return saveConflict(now.Rev)
	}
	if err != nil {
		return dropboxError(err)
	}
	return c.JSON(http.StatusOK, savedFile{Path: apiPath(e.Path), Rev: e.Rev})
}
