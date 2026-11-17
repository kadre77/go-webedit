package dropbox

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
)

// errWriteConflict is Dropbox refusing a write because of what is at the
// path. Each operation turns it into the Port error that fits: a stale
// revision for an update, something already there for a create or move.
var errWriteConflict = errors.New("dropbox: write conflict")

// RefreshTokenSource supplies the stored refresh token. It is read on every
// refresh, so a new sign-in takes effect without a restart.
type RefreshTokenSource interface {
	RefreshToken() (string, error)
}

// Endpoints are the Dropbox base URLs the client talks to.
type Endpoints struct {
	Authorize string // the OAuth authorization page
	API       string // RPC endpoints and the token endpoint
	Content   string // content download and upload endpoints
}

// DropboxEndpoints are the real Dropbox endpoints.
var DropboxEndpoints = Endpoints{
	Authorize: "https://www.dropbox.com/oauth2/authorize",
	API:       "https://api.dropboxapi.com",
	Content:   "https://content.dropboxapi.com",
}

// Client is the real Dropbox adapter, over the Dropbox HTTP API. With App
// Folder access (ADR 0003) the API's paths are already relative to the Root
// Folder. Access tokens live only in memory and are refreshed from the
// stored refresh token when they expire.
type Client struct {
	Endpoints Endpoints
	HTTP      *http.Client

	appKey, appSecret string
	tokens            RefreshTokenSource

	mu          sync.Mutex
	access      string
	accessUntil time.Time
}

// NewClient returns a client for the Dropbox app with the given key and
// secret, using tokens for the refresh token.
func NewClient(appKey, appSecret string, tokens RefreshTokenSource) *Client {
	return &Client{
		Endpoints: DropboxEndpoints,
		HTTP:      &http.Client{Timeout: 60 * time.Second},
		appKey:    appKey,
		appSecret: appSecret,
		tokens:    tokens,
	}
}

// scopes are the only Dropbox permissions the app asks for (spec: Dropbox
// access), even if the app console allows more.
const scopes = "account_info.read files.metadata.read files.content.read files.content.write"

// AuthorizeURL implements Port.
func (c *Client) AuthorizeURL(state, codeChallenge, redirectURI string) string {
	q := url.Values{
		"client_id":             {c.appKey},
		"response_type":         {"code"},
		"redirect_uri":          {redirectURI},
		"state":                 {state},
		"code_challenge":        {codeChallenge},
		"code_challenge_method": {"S256"},
		"token_access_type":     {"offline"},
		"scope":                 {scopes},
	}
	return c.Endpoints.Authorize + "?" + q.Encode()
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	ExpiresIn    int64  `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	AccountID    string `json:"account_id"`
	Error        string `json:"error"`
}

// errInvalidGrant is the token endpoint refusing a code or refresh token.
var errInvalidGrant = errors.New("dropbox: invalid_grant")

// postToken calls the OAuth token endpoint. Error messages never include
// the form, which carries secrets.
func (c *Client) postToken(ctx context.Context, form url.Values) (tokenResponse, error) {
	form.Set("client_id", c.appKey)
	form.Set("client_secret", c.appSecret)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoints.API+"/oauth2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return tokenResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := c.HTTP.Do(req)
	if err != nil {
		return tokenResponse{}, fmt.Errorf("dropbox: token endpoint: %w", err)
	}
	defer res.Body.Close()
	var tr tokenResponse
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&tr); err != nil {
		return tokenResponse{}, fmt.Errorf("dropbox: token endpoint: status %d", res.StatusCode)
	}
	switch {
	case res.StatusCode == http.StatusBadRequest && tr.Error == "invalid_grant":
		return tokenResponse{}, errInvalidGrant
	case res.StatusCode != http.StatusOK || tr.AccessToken == "":
		return tokenResponse{}, fmt.Errorf("dropbox: token endpoint: status %d, error %q", res.StatusCode, tr.Error)
	}
	return tr, nil
}

// ExchangeCode implements Port.
func (c *Client) ExchangeCode(ctx context.Context, code, codeVerifier, redirectURI string) (Token, error) {
	tr, err := c.postToken(ctx, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"code_verifier": {codeVerifier},
		"redirect_uri":  {redirectURI},
	})
	if errors.Is(err, errInvalidGrant) {
		return Token{}, ErrBadCode
	}
	if err != nil {
		return Token{}, err
	}
	if tr.RefreshToken == "" || tr.AccountID == "" {
		return Token{}, fmt.Errorf("%w: no refresh token or account in the response", ErrBadCode)
	}
	return Token{RefreshToken: tr.RefreshToken, AccountID: tr.AccountID}, nil
}

// accessToken returns a live access token, refreshing it when it is about
// to expire or when force is set.
func (c *Client) accessToken(ctx context.Context, force bool) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !force && c.access != "" && time.Now().Before(c.accessUntil) {
		return c.access, nil
	}
	refresh, err := c.tokens.RefreshToken()
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrReauthorize, err)
	}
	tr, err := c.postToken(ctx, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}})
	if errors.Is(err, errInvalidGrant) {
		c.access = ""
		return "", ErrReauthorize
	}
	if err != nil {
		return "", err
	}
	c.access = tr.AccessToken
	// Refresh a minute early so a token doesn't expire mid-request.
	c.accessUntil = time.Now().Add(time.Duration(tr.ExpiresIn)*time.Second - time.Minute)
	return c.access, nil
}

// call makes an authenticated Dropbox API request built by build, retrying
// once with a fresh access token if Dropbox says the token expired. The
// caller closes the response body on success; any status other than 200 is
// turned into an error.
func (c *Client) call(ctx context.Context, build func() (*http.Request, error)) (*http.Response, error) {
	for attempt := 0; ; attempt++ {
		tok, err := c.accessToken(ctx, attempt > 0)
		if err != nil {
			return nil, err
		}
		req, err := build()
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+tok)
		res, err := c.HTTP.Do(req)
		if err != nil {
			return nil, fmt.Errorf("dropbox: %s: %w", req.URL.Path, err)
		}
		if res.StatusCode == http.StatusOK {
			return res, nil
		}
		err = apiError(req.URL.Path, res)
		res.Body.Close()
		if res.StatusCode == http.StatusUnauthorized && attempt == 0 {
			continue
		}
		if res.StatusCode == http.StatusUnauthorized {
			return nil, fmt.Errorf("%w: %v", ErrReauthorize, err)
		}
		return nil, err
	}
}

// apiError turns a failed Dropbox response into an error, mapping the
// endpoint errors the app tells apart to the Port's errors.
func apiError(endpoint string, res *http.Response) error {
	var body struct {
		ErrorSummary string `json:"error_summary"`
	}
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	json.Unmarshal(raw, &body)
	summary := body.ErrorSummary
	err := fmt.Errorf("dropbox: %s: status %d %s", endpoint, res.StatusCode, summary)
	if res.StatusCode == http.StatusConflict {
		switch {
		case strings.Contains(summary, "/not_found"):
			return fmt.Errorf("%w (%v)", ErrNotFound, err)
		case strings.Contains(summary, "/not_file"):
			return fmt.Errorf("%w (%v)", ErrNotFile, err)
		case strings.Contains(summary, "/conflict/"):
			return fmt.Errorf("%w (%v)", errWriteConflict, err)
		case strings.HasPrefix(summary, "cant_move_folder_into_itself/"),
			strings.HasPrefix(summary, "duplicated_or_nested_paths/"):
			return fmt.Errorf("%w (%v)", ErrInvalidMove, err)
		}
	}
	return err
}

// rpc calls an RPC endpoint with a JSON argument and decodes the JSON result.
func (c *Client) rpc(ctx context.Context, endpoint string, arg, result any) error {
	body, err := json.Marshal(arg)
	if err != nil {
		return err
	}
	res, err := c.call(ctx, func() (*http.Request, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoints.API+endpoint, bytes.NewReader(body))
		if err == nil {
			req.Header.Set("Content-Type", "application/json")
		}
		return req, err
	})
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if err := json.NewDecoder(res.Body).Decode(result); err != nil {
		return fmt.Errorf("dropbox: %s: decoding the result: %w", endpoint, err)
	}
	return nil
}

// metadata is a Dropbox file or folder entry.
type metadata struct {
	Tag         string `json:".tag"`
	PathDisplay string `json:"path_display"`
	Size        int64  `json:"size"`
	Rev         string `json:"rev"`
}

func (m metadata) entry() Entry {
	if m.Tag == "folder" {
		return Entry{Path: m.PathDisplay, Folder: true}
	}
	return Entry{Path: m.PathDisplay, Size: m.Size, Rev: m.Rev}
}

// ListAll implements Port.
func (c *Client) ListAll(ctx context.Context) ([]Entry, error) {
	var page struct {
		Entries []metadata `json:"entries"`
		Cursor  string     `json:"cursor"`
		HasMore bool       `json:"has_more"`
	}
	err := c.rpc(ctx, "/2/files/list_folder", map[string]any{"path": "", "recursive": true}, &page)
	var out []Entry
	for err == nil {
		for _, m := range page.Entries {
			if m.Tag == "file" || m.Tag == "folder" {
				out = append(out, m.entry())
			}
		}
		if !page.HasMore {
			return out, nil
		}
		cursor := page.Cursor
		page.Entries = nil
		err = c.rpc(ctx, "/2/files/list_folder/continue", map[string]string{"cursor": cursor}, &page)
	}
	return nil, err
}

// apiArg encodes v for the Dropbox-API-Arg header, which must be ASCII:
// every non-ASCII character becomes a \uXXXX escape.
func apiArg(v any) (string, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	for _, r := range string(raw) {
		if r < 0x80 {
			b.WriteRune(r)
			continue
		}
		for _, u := range utf16.Encode([]rune{r}) {
			fmt.Fprintf(&b, `\u%04x`, u)
		}
	}
	return b.String(), nil
}

// Download implements Port. The size check uses the metadata Dropbox sends
// in the response header, before the content is read.
func (c *Client) Download(ctx context.Context, path string, maxSize int64) (File, error) {
	arg, err := apiArg(map[string]string{"path": path})
	if err != nil {
		return File{}, err
	}
	res, err := c.call(ctx, func() (*http.Request, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoints.Content+"/2/files/download", nil)
		if err == nil {
			req.Header.Set("Dropbox-API-Arg", arg)
		}
		return req, err
	})
	if err != nil {
		return File{}, err
	}
	defer res.Body.Close()
	var m metadata
	if err := json.Unmarshal([]byte(res.Header.Get("Dropbox-API-Result")), &m); err != nil {
		return File{}, fmt.Errorf("dropbox: download: bad Dropbox-API-Result header: %w", err)
	}
	m.Tag = "file"
	if m.Size > maxSize {
		return File{}, fmt.Errorf("%w: %s", ErrTooLarge, path)
	}
	content, err := io.ReadAll(io.LimitReader(res.Body, maxSize+1))
	if err != nil {
		return File{}, fmt.Errorf("dropbox: download: %w", err)
	}
	if int64(len(content)) > maxSize {
		return File{}, fmt.Errorf("%w: %s", ErrTooLarge, path)
	}
	return File{Entry: m.entry(), Content: content}, nil
}

// Metadata implements Port.
func (c *Client) Metadata(ctx context.Context, path string) (Entry, error) {
	var m metadata
	if err := c.rpc(ctx, "/2/files/get_metadata", map[string]string{"path": path}, &m); err != nil {
		return Entry{}, err
	}
	return m.entry(), nil
}

// upload writes content to path in the given Dropbox write mode. With
// autorename off and strict conflicts on, Dropbox refuses a write that
// doesn't fit the mode instead of making a renamed copy; upload then fails
// with refused.
func (c *Client) upload(ctx context.Context, path string, content []byte, mode map[string]string, refused error) (Entry, error) {
	arg, err := apiArg(map[string]any{
		"path":            path,
		"mode":            mode,
		"autorename":      false,
		"mute":            true,
		"strict_conflict": true,
	})
	if err != nil {
		return Entry{}, err
	}
	res, err := c.call(ctx, func() (*http.Request, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoints.Content+"/2/files/upload", bytes.NewReader(content))
		if err == nil {
			req.Header.Set("Dropbox-API-Arg", arg)
			req.Header.Set("Content-Type", "application/octet-stream")
		}
		return req, err
	})
	if errors.Is(err, errWriteConflict) {
		return Entry{}, fmt.Errorf("%w (%v)", refused, err)
	}
	if err != nil {
		return Entry{}, err
	}
	defer res.Body.Close()
	var m metadata
	if err := json.NewDecoder(res.Body).Decode(&m); err != nil {
		return Entry{}, fmt.Errorf("dropbox: upload: decoding the result: %w", err)
	}
	m.Tag = "file"
	return m.entry(), nil
}

// UploadUpdate implements Port with Dropbox's update mode, which writes only
// over the given revision.
func (c *Client) UploadUpdate(ctx context.Context, path string, content []byte, rev string) (Entry, error) {
	return c.upload(ctx, path, content, map[string]string{".tag": "update", "update": rev}, ErrConflict)
}

// UploadNew implements Port with Dropbox's add mode, which writes only where
// nothing is. Dropbox creates missing parent folders.
func (c *Client) UploadNew(ctx context.Context, path string, content []byte) (Entry, error) {
	return c.upload(ctx, path, content, map[string]string{".tag": "add"}, ErrAlreadyExists)
}

// CreateFolder implements Port with create_folder_v2, which refuses a path
// that is taken (autorename off) and creates missing parents.
func (c *Client) CreateFolder(ctx context.Context, path string) (Entry, error) {
	var res struct{ Metadata metadata }
	err := c.rpc(ctx, "/2/files/create_folder_v2", map[string]any{"path": path, "autorename": false}, &res)
	if errors.Is(err, errWriteConflict) {
		return Entry{}, fmt.Errorf("%w (%v)", ErrAlreadyExists, err)
	}
	if err != nil {
		return Entry{}, err
	}
	res.Metadata.Tag = "folder"
	return res.Metadata.entry(), nil
}

// Move implements Port with move_v2, which refuses a taken destination
// (autorename off) but allows a change of case only.
func (c *Client) Move(ctx context.Context, from, to string) (Entry, error) {
	var res struct{ Metadata metadata }
	err := c.rpc(ctx, "/2/files/move_v2", map[string]any{
		"from_path":                from,
		"to_path":                  to,
		"autorename":               false,
		"allow_ownership_transfer": false,
	}, &res)
	if errors.Is(err, errWriteConflict) {
		return Entry{}, fmt.Errorf("%w (%v)", ErrAlreadyExists, err)
	}
	if err != nil {
		return Entry{}, err
	}
	return res.Metadata.entry(), nil
}

// Delete implements Port with delete_v2. Dropbox keeps what it deletes in
// its trash.
func (c *Client) Delete(ctx context.Context, path string) error {
	var res struct{}
	return c.rpc(ctx, "/2/files/delete_v2", map[string]string{"path": path}, &res)
}
