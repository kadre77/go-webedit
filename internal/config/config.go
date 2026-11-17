// Package config loads and validates the server's configuration from
// environment variables. Load reports every missing or malformed variable by
// name so deploy mistakes surface at startup.
package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Config is the validated server configuration.
type Config struct {
	DropboxAppKey    string // empty in test mode
	DropboxAppSecret string // empty in test mode
	OwnerAccountID   string
	BaseURL          *url.URL // scheme and host only
	SessionSecret    []byte
	TokenKey         []byte // 32 bytes
	DataDir          string
	Port             string
	TestMode         bool
	TestFixtures     string // test mode only: directory seeding the fake Dropbox
}

const (
	minSessionSecretLen = 32
	tokenKeyLen         = 32 // AES-256
)

// Load reads the configuration through getenv (os.Getenv in production).
func Load(getenv func(string) string) (Config, error) {
	var cfg Config
	var errs []error
	bad := func(name, format string, args ...any) {
		errs = append(errs, fmt.Errorf("%s: %s", name, fmt.Sprintf(format, args...)))
	}
	required := func(name string) string {
		v := getenv(name)
		if v == "" {
			bad(name, "is required")
		}
		return v
	}

	switch v := getenv("WEBEDIT_TEST_MODE"); v {
	case "", "0", "false":
	case "1", "true":
		cfg.TestMode = true
	default:
		bad("WEBEDIT_TEST_MODE", "must be 1, true, 0 or false, got %q", v)
	}

	if !cfg.TestMode {
		cfg.DropboxAppKey = required("WEBEDIT_DROPBOX_APP_KEY")
		cfg.DropboxAppSecret = required("WEBEDIT_DROPBOX_APP_SECRET")
	}
	cfg.OwnerAccountID = required("WEBEDIT_OWNER_ACCOUNT_ID")

	if v := required("WEBEDIT_BASE_URL"); v != "" {
		u, err := url.Parse(v)
		switch {
		case err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https"):
			bad("WEBEDIT_BASE_URL", "must be an absolute http or https URL, got %q", v)
		case (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || u.User != nil:
			bad("WEBEDIT_BASE_URL", "must be scheme and host only (no path, query or credentials), got %q", v)
		default:
			cfg.BaseURL = &url.URL{Scheme: u.Scheme, Host: u.Host}
		}
	}

	if v := required("WEBEDIT_SESSION_SECRET"); v != "" {
		if len(v) < minSessionSecretLen {
			bad("WEBEDIT_SESSION_SECRET", "must be at least %d characters", minSessionSecretLen)
		} else {
			cfg.SessionSecret = []byte(v)
		}
	}

	if v := required("WEBEDIT_TOKEN_KEY"); v != "" {
		key, err := base64.StdEncoding.DecodeString(v)
		if err != nil || len(key) != tokenKeyLen {
			bad("WEBEDIT_TOKEN_KEY", "must be %d bytes encoded as standard base64", tokenKeyLen)
		} else {
			cfg.TokenKey = key
		}
	}

	if v := required("WEBEDIT_DATA_DIR"); v != "" {
		if !filepath.IsAbs(v) {
			bad("WEBEDIT_DATA_DIR", "must be an absolute path, got %q", v)
		} else {
			cfg.DataDir = filepath.Clean(v)
		}
	}

	cfg.Port = getenv("PORT")
	if cfg.Port == "" {
		cfg.Port = "8080"
	} else if n, err := strconv.Atoi(cfg.Port); err != nil || n < 1 || n > 65535 {
		bad("PORT", "must be a TCP port number, got %q", cfg.Port)
	}

	if v := getenv("WEBEDIT_TEST_FIXTURES"); v != "" {
		if !cfg.TestMode {
			bad("WEBEDIT_TEST_FIXTURES", "is only allowed in test mode")
		} else if fi, err := os.Stat(v); err != nil || !fi.IsDir() {
			bad("WEBEDIT_TEST_FIXTURES", "must be an existing directory, got %q", v)
		} else {
			cfg.TestFixtures = v
		}
	}

	if cfg.TestMode && cfg.BaseURL != nil && looksLikeProduction(cfg.BaseURL) {
		bad("WEBEDIT_TEST_MODE", "refusing to start in test mode with a public https base URL (%s)", cfg.BaseURL)
	}

	if len(errs) > 0 {
		return Config{}, fmt.Errorf("invalid configuration:\n%w", errors.Join(errs...))
	}
	return cfg, nil
}

// looksLikeProduction reports whether u is an https URL on a non-loopback
// host, which is what a real deployment uses.
func looksLikeProduction(u *url.URL) bool {
	if u.Scheme != "https" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return false
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return false
	}
	return true
}
