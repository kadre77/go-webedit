package main_test

// Startup tests drive the real binary: what the Owner observes at deploy time
// is the exit status, the message on stderr, and whether the health check
// answers.

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kadre77/webedit/internal/tokenstore"
)

var binary string

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "webedit-startup-test")
	if err != nil {
		panic(err)
	}
	binary = filepath.Join(dir, "webedit")
	if out, err := exec.Command("go", "build", "-o", binary, ".").CombinedOutput(); err != nil {
		panic(fmt.Sprintf("building binary: %v\n%s", err, out))
	}
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

// productionEnv is a complete production configuration.
func productionEnv() map[string]string {
	return map[string]string{
		"WEBEDIT_DROPBOX_APP_KEY":    "appkey",
		"WEBEDIT_DROPBOX_APP_SECRET": "appsecret",
		"WEBEDIT_OWNER_ACCOUNT_ID":   "dbid:AAAowner",
		"WEBEDIT_BASE_URL":           "https://edit.example.com",
		"WEBEDIT_SESSION_SECRET":     strings.Repeat("s", 32),
		"WEBEDIT_TOKEN_KEY":          "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", // 32 zero bytes
		"WEBEDIT_DATA_DIR":           "/data",
	}
}

// testModeEnv is a test-mode configuration on a local base URL.
func testModeEnv() map[string]string {
	env := productionEnv()
	delete(env, "WEBEDIT_DROPBOX_APP_KEY")
	delete(env, "WEBEDIT_DROPBOX_APP_SECRET")
	env["WEBEDIT_TEST_MODE"] = "1"
	env["WEBEDIT_BASE_URL"] = "http://localhost:8080"
	return env
}

func command(ctx context.Context, env map[string]string) (*exec.Cmd, *bytes.Buffer) {
	cmd := exec.CommandContext(ctx, binary)
	cmd.Env = []string{}
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	return cmd, &stderr
}

// refusesToStart runs the binary and returns its stderr, failing unless it
// exits with an error.
func refusesToStart(t *testing.T, env map[string]string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd, stderr := command(ctx, env)
	err := cmd.Run()
	if ctx.Err() != nil {
		t.Fatalf("server started instead of refusing; stderr:\n%s", stderr)
	}
	if err == nil {
		t.Fatalf("exited 0; stderr:\n%s", stderr)
	}
	return stderr.String()
}

// startsAndServes runs the binary on a free port and fails unless the health
// check answers.
func startsAndServes(t *testing.T, env map[string]string) {
	t.Helper()
	serve(t, env)
}

// serve runs the binary on a free port until the test ends, and returns its
// base URL once the health check answers.
func serve(t *testing.T, env map[string]string) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := fmt.Sprint(l.Addr().(*net.TCPAddr).Port)
	l.Close()
	env["PORT"] = port

	ctx, cancel := context.WithCancel(context.Background())
	cmd, stderr := command(ctx, env)
	if err := cmd.Start(); err != nil {
		cancel()
		t.Fatal(err)
	}
	exited := make(chan struct{})
	go func() { cmd.Wait(); close(exited) }()
	t.Cleanup(func() { cancel(); <-exited })

	base := "http://127.0.0.1:" + port
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case <-exited:
			t.Fatalf("server exited; stderr:\n%s", stderr)
		default:
		}
		res, err := http.Get(base + "/api/health")
		if err == nil {
			res.Body.Close()
			if res.StatusCode == http.StatusOK {
				return base
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("health check never answered; stderr:\n%s", stderr)
	return ""
}

func TestStartsWithValidProductionConfig(t *testing.T) {
	startsAndServes(t, productionEnv())
}

func TestStartsInTestModeOnLocalBaseURL(t *testing.T) {
	for _, u := range []string{
		"http://localhost:8080",
		"https://localhost:8443",
		"https://127.0.0.1:8443",
		"https://[::1]:8443",
		"http://webedit.test:8080", // plain http is never a production deploy
	} {
		t.Run(u, func(t *testing.T) {
			env := testModeEnv()
			env["WEBEDIT_BASE_URL"] = u
			startsAndServes(t, env)
		})
	}
}

func TestEveryMissingVariableIsNamed(t *testing.T) {
	stderr := refusesToStart(t, map[string]string{})
	for name := range productionEnv() {
		if !strings.Contains(stderr, name) {
			t.Errorf("stderr does not name %s:\n%s", name, stderr)
		}
	}
}

func TestMalformedVariableIsNamed(t *testing.T) {
	cases := []struct{ name, value string }{
		{"WEBEDIT_BASE_URL", "edit.example.com"},
		{"WEBEDIT_BASE_URL", "ftp://edit.example.com"},
		{"WEBEDIT_BASE_URL", "https://edit.example.com/sub"},
		{"WEBEDIT_SESSION_SECRET", "too-short"},
		{"WEBEDIT_TOKEN_KEY", "not base64!"},
		{"WEBEDIT_TOKEN_KEY", "AAAA"}, // valid base64, wrong length
		{"WEBEDIT_DATA_DIR", "relative/dir"},
		{"WEBEDIT_TEST_MODE", "maybe"},
		{"PORT", "http"},
	}
	for _, c := range cases {
		t.Run(c.name+"="+c.value, func(t *testing.T) {
			env := productionEnv()
			env[c.name] = c.value
			if stderr := refusesToStart(t, env); !strings.Contains(stderr, c.name) {
				t.Errorf("stderr does not name %s:\n%s", c.name, stderr)
			}
		})
	}
}

func TestTestModeIsOffUnlessExplicit(t *testing.T) {
	// Without test mode, the Dropbox app credentials are required.
	for _, v := range []string{"", "0", "false"} {
		t.Run("WEBEDIT_TEST_MODE="+v, func(t *testing.T) {
			env := testModeEnv()
			env["WEBEDIT_TEST_MODE"] = v
			if stderr := refusesToStart(t, env); !strings.Contains(stderr, "WEBEDIT_DROPBOX_APP_KEY") {
				t.Errorf("stderr:\n%s", stderr)
			}
		})
	}
}

func TestTestModeRefusesProductionBaseURL(t *testing.T) {
	env := testModeEnv()
	env["WEBEDIT_BASE_URL"] = "https://edit.example.com"
	if stderr := refusesToStart(t, env); !strings.Contains(stderr, "WEBEDIT_TEST_MODE") {
		t.Errorf("stderr does not name WEBEDIT_TEST_MODE:\n%s", stderr)
	}
}

// signIn runs the test-mode sign-in (which approves at once) against base
// and returns the session cookie.
func signIn(t *testing.T, base string) *http.Cookie {
	t.Helper()
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	res, err := client.Get(base + "/auth/signin")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	loc, err := url.Parse(res.Header.Get("Location"))
	if err != nil || loc.Path != "/auth/callback" {
		t.Fatalf("sign-in start redirects to %q, want the callback", res.Header.Get("Location"))
	}
	req, _ := http.NewRequest(http.MethodGet, base+loc.RequestURI(), nil)
	for _, c := range res.Cookies() {
		req.AddCookie(c)
	}
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	for _, c := range res.Cookies() {
		if c.Name == "webedit_session" && c.MaxAge > 0 {
			return c
		}
	}
	t.Fatalf("no session after sign-in; callback status %d, Location %q", res.StatusCode, res.Header.Get("Location"))
	return nil
}

func TestTestModeSignsInAtOnceAndServesTheFixtureDirectory(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "Notes"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "Notes", "Fixture.md"), []byte("# hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	env := testModeEnv()
	env["WEBEDIT_TEST_FIXTURES"] = dir
	env["WEBEDIT_DATA_DIR"] = t.TempDir()
	base := serve(t, env)

	req, _ := http.NewRequest(http.MethodGet, base+"/api/file?path=Notes/Fixture.md", nil)
	req.AddCookie(signIn(t, base))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK || !strings.Contains(string(body), `"content":"# hi\n"`) {
		t.Errorf("status = %d, body %s", res.StatusCode, body)
	}
}

func TestSigningInStoresTheRefreshTokenEncrypted(t *testing.T) {
	env := testModeEnv()
	dataDir := t.TempDir()
	env["WEBEDIT_DATA_DIR"] = dataDir
	signIn(t, serve(t, env))

	key, _ := base64.StdEncoding.DecodeString(env["WEBEDIT_TOKEN_KEY"])
	s, err := tokenstore.Open(filepath.Join(dataDir, "refresh-token"), key)
	if err != nil {
		t.Fatal(err)
	}
	if tok, err := s.RefreshToken(); err != nil || tok == "" {
		t.Errorf("stored token = %q, %v", tok, err)
	}
}

func TestAWrongTokenKeyStopsStartup(t *testing.T) {
	dataDir := t.TempDir()
	s, err := tokenstore.Open(filepath.Join(dataDir, "refresh-token"), bytes.Repeat([]byte{9}, 32))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Save("a-refresh-token"); err != nil {
		t.Fatal(err)
	}
	env := productionEnv() // its key is 32 zero bytes
	env["WEBEDIT_DATA_DIR"] = dataDir
	if stderr := refusesToStart(t, env); !strings.Contains(stderr, "WEBEDIT_TOKEN_KEY") {
		t.Errorf("stderr does not name WEBEDIT_TOKEN_KEY:\n%s", stderr)
	}
}

func TestTestModeRefusesAMissingFixtureDirectory(t *testing.T) {
	env := testModeEnv()
	env["WEBEDIT_TEST_FIXTURES"] = filepath.Join(t.TempDir(), "nope")
	if stderr := refusesToStart(t, env); !strings.Contains(stderr, "WEBEDIT_TEST_FIXTURES") {
		t.Errorf("stderr does not name WEBEDIT_TEST_FIXTURES:\n%s", stderr)
	}
}

func TestFixturesAreRefusedOutsideTestMode(t *testing.T) {
	env := productionEnv()
	env["WEBEDIT_TEST_FIXTURES"] = t.TempDir()
	if stderr := refusesToStart(t, env); !strings.Contains(stderr, "WEBEDIT_TEST_FIXTURES") {
		t.Errorf("stderr does not name WEBEDIT_TEST_FIXTURES:\n%s", stderr)
	}
}
