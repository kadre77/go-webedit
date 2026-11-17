// Command webedit runs the webedit server.
package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/kadre77/webedit/internal/config"
	"github.com/kadre77/webedit/internal/dropbox"
	"github.com/kadre77/webedit/internal/server"
	"github.com/kadre77/webedit/internal/tokenstore"
	"github.com/kadre77/webedit/web"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "webedit:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	tokens, err := tokenstore.Open(filepath.Join(cfg.DataDir, "refresh-token"), cfg.TokenKey)
	if errors.Is(err, tokenstore.ErrWrongKey) {
		return fmt.Errorf("WEBEDIT_TOKEN_KEY: %w; restore the old key, or delete the file and sign in again", err)
	}
	if err != nil {
		return err
	}

	var port dropbox.Port = dropbox.NewClient(cfg.DropboxAppKey, cfg.DropboxAppSecret, tokens)
	var fake *dropbox.Fake
	if cfg.TestMode {
		slog.Warn("TEST MODE is on; never use this in production")
		var seed fs.FS
		if cfg.TestFixtures != "" {
			seed = os.DirFS(cfg.TestFixtures)
		}
		if fake, err = dropbox.NewFake(cfg.OwnerAccountID, seed); err != nil {
			return err
		}
		port = fake
	}

	srv := &http.Server{
		Addr: ":" + cfg.Port,
		Handler: server.New(server.Options{
			Frontend:       web.Dist(),
			Dropbox:        port,
			Tokens:         tokens,
			OwnerAccountID: cfg.OwnerAccountID,
			BaseURL:        cfg.BaseURL,
			SessionSecret:  cfg.SessionSecret,
			TestFake:       fake,
		}),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	errc := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", srv.Addr, "base_url", cfg.BaseURL.String())
		errc <- srv.ListenAndServe()
	}()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
