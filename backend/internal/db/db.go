package db

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const connectRetryMax = 2 * time.Minute

// Connect opens a pgx pool. Returns an error if url is empty.
func Connect(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is empty")
	}
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	cfg.MaxConns = 10
	cfg.MinConns = 1
	cfg.MaxConnLifetime = time.Hour
	// Drop dead connections and dial again after postgres restarts.
	cfg.HealthCheckPeriod = 15 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return pool, nil
}

// ConnectRetry dials until the database accepts a connection or maxWait elapses.
// A bad URL fails immediately. Connection refused and other dial errors back off
// from 500ms up to 5s. The caller should exit if this returns an error so the
// process does not stay up with a nil pool.
func ConnectRetry(ctx context.Context, databaseURL string, maxWait time.Duration) (*pgxpool.Pool, error) {
	if maxWait <= 0 {
		maxWait = connectRetryMax
	}
	deadline := time.Now().Add(maxWait)
	delay := 500 * time.Millisecond
	var last error
	attempt := 0
	for {
		attempt++
		pool, err := Connect(ctx, databaseURL)
		if err == nil {
			if attempt > 1 {
				slog.Info("database connected", "attempts", attempt)
			}
			return pool, nil
		}
		last = err
		if !retryableConnectErr(err) || !time.Now().Before(deadline) {
			return nil, fmt.Errorf("database not ready: %w", last)
		}
		wait := delay
		if remain := time.Until(deadline); wait > remain {
			wait = remain
		}
		if wait <= 0 {
			return nil, fmt.Errorf("database not ready: %w", last)
		}
		slog.Warn("database not ready, retrying", "err", err, "wait", wait.String())
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
		if delay < 5*time.Second {
			delay *= 2
			if delay > 5*time.Second {
				delay = 5 * time.Second
			}
		}
	}
}

func retryableConnectErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	if strings.Contains(msg, "parse DATABASE_URL") || strings.Contains(msg, "DATABASE_URL is empty") {
		return false
	}
	return true
}

// Watch pings the pool and lets pgx dial a fresh connection after a drop.
// It never clears the pool: a later outage must not stick the process in no-DB mode.
func Watch(ctx context.Context, pool *pgxpool.Pool) {
	if pool == nil {
		return
	}
	var down bool
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := pool.Ping(pingCtx)
			cancel()
			if err != nil {
				if !down {
					slog.Warn("database unreachable; reconnecting", "err", err)
				}
				down = true
				continue
			}
			if down {
				slog.Info("database reconnected")
				down = false
			}
		}
	}
}

// Migrate runs *.sql files in dir in lexicographic order (idempotent IF NOT EXISTS style).
func Migrate(ctx context.Context, pool *pgxpool.Pool, dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}
	var files []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		// skip seed docs
		if strings.Contains(e.Name(), "seed") {
			continue
		}
		files = append(files, filepath.Join(dir, e.Name()))
	}
	sort.Strings(files)

	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`)
	if err != nil {
		return fmt.Errorf("schema_migrations: %w", err)
	}

	for _, f := range files {
		name := filepath.Base(f)
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE filename=$1)`, name).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		body, err := os.ReadFile(f)
		if err != nil {
			return err
		}
		tx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, string(body)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("migrate %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations(filename) VALUES($1)`, name); err != nil {
			_ = tx.Rollback(ctx)
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}
