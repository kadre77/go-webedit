package server

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/kadre77/webedit/internal/dropbox"
)

// maxSmallBody caps a request body that carries only paths.
const maxSmallBody = 64 << 10

// decodeSmallBody decodes a JSON request body that carries only paths.
func decodeSmallBody(c echo.Context, v any) error {
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, maxSmallBody)
	if err := json.NewDecoder(c.Request().Body).Decode(v); err != nil {
		return &Error{Status: http.StatusBadRequest, Code: "bad-request", Message: "The request body is not the JSON this call expects."}
	}
	return nil
}

// entryResult is the response of the create and move APIs: where the entry
// is now, in display case, what it is, and a file's revision.
type entryResult struct {
	Path string `json:"path"`
	Kind string `json:"kind"` // "file" or "folder"
	Rev  string `json:"rev,omitempty"`
}

func newEntryResult(e dropbox.Entry) entryResult {
	if e.Folder {
		return entryResult{Path: apiPath(e.Path), Kind: "folder"}
	}
	return entryResult{Path: apiPath(e.Path), Kind: "file", Rev: e.Rev}
}

// pathBody decodes a {path} request body and cleans the path.
func pathBody(c echo.Context) (string, error) {
	var req struct {
		Path string `json:"path"`
	}
	if err := decodeSmallBody(c, &req); err != nil {
		return "", err
	}
	return cleanPath(req.Path)
}

// createFile is the create-file API: a new empty file, refused with
// already-exists if anything is at the path (in any case).
func (h *fileHandlers) createFile(c echo.Context) error {
	p, err := pathBody(c)
	if err != nil {
		return err
	}
	e, err := h.port.UploadNew(c.Request().Context(), p, nil)
	if err != nil {
		return dropboxError(err)
	}
	return c.JSON(http.StatusCreated, newEntryResult(e))
}

// createFolder is the create-folder API, refused with already-exists if
// anything is at the path.
func (h *fileHandlers) createFolder(c echo.Context) error {
	p, err := pathBody(c)
	if err != nil {
		return err
	}
	e, err := h.port.CreateFolder(c.Request().Context(), p)
	if err != nil {
		return dropboxError(err)
	}
	return c.JSON(http.StatusCreated, newEntryResult(e))
}

// move is the move API: it renames or moves a file or folder, refused with
// already-exists if the destination is taken. A change of case only is
// allowed.
func (h *fileHandlers) move(c echo.Context) error {
	var req struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := decodeSmallBody(c, &req); err != nil {
		return err
	}
	from, err := cleanPath(req.From)
	if err != nil {
		return err
	}
	to, err := cleanPath(req.To)
	if err != nil {
		return err
	}
	e, err := h.port.Move(c.Request().Context(), from, to)
	if errors.Is(err, dropbox.ErrInvalidMove) {
		return &Error{Status: http.StatusBadRequest, Code: "bad-request", Message: "A folder can't move into itself."}
	}
	if err != nil {
		return dropboxError(err)
	}
	return c.JSON(http.StatusOK, newEntryResult(e))
}

// delete is the delete API: it deletes a file or a folder with everything
// in it. Dropbox keeps deleted items in its trash.
func (h *fileHandlers) delete(c echo.Context) error {
	p, err := cleanPath(c.QueryParam("path"))
	if err != nil {
		return err
	}
	if err := h.port.Delete(c.Request().Context(), p); err != nil {
		return dropboxError(err)
	}
	return c.NoContent(http.StatusNoContent)
}
