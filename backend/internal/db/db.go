package db

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func debugMigrationLog(hypothesisID, location, message string, data map[string]any) {
	payload, _ := json.Marshal(map[string]any{"hypothesisId": hypothesisID, "location": location, "message": message, "data": data, "timestamp": time.Now().UnixMilli()})
	f, err := os.OpenFile("/opt/cursor/logs/debug.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err == nil {
		_, _ = f.Write(append(payload, '\n'))
		_ = f.Close()
	}
}

// Connect opens a pgx pool. Returns nil pool error if url is empty.
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

	cwd, _ := os.Getwd()
	targets := make([]string, 0, 2)
	for _, f := range files {
		name := filepath.Base(f)
		if name == "033_profile_widgets.sql" || name == "039_wave_b2.sql" {
			targets = append(targets, name)
		}
	}
	// #region agent log
	debugMigrationLog("A,B", "internal/db/db.go:Migrate", "migration file discovery", map[string]any{"dir": dir, "cwd": cwd, "fileCount": len(files), "targetFiles": targets})
	// #endregion

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
		if name == "033_profile_widgets.sql" || name == "039_wave_b2.sql" {
			// #region agent log
			debugMigrationLog("B,C", "internal/db/db.go:Migrate:target-state", "target migration state", map[string]any{"filename": name, "alreadyApplied": exists})
			// #endregion
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
		if name == "033_profile_widgets.sql" || name == "039_wave_b2.sql" {
			var columnExists bool
			_ = pool.QueryRow(ctx, `SELECT EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_schema=current_schema() AND table_name='users' AND column_name='is_verified'
			)`).Scan(&columnExists)
			// #region agent log
			debugMigrationLog("D", "internal/db/db.go:Migrate:target-commit", "target migration committed", map[string]any{"filename": name, "columnExists": columnExists})
			// #endregion
		}
	}
	var columnExists, migration033, migration039 bool
	_ = pool.QueryRow(ctx, `SELECT
		EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='users' AND column_name='is_verified'),
		EXISTS (SELECT 1 FROM schema_migrations WHERE filename='033_profile_widgets.sql'),
		EXISTS (SELECT 1 FROM schema_migrations WHERE filename='039_wave_b2.sql')`).Scan(&columnExists, &migration033, &migration039)
	// #region agent log
	debugMigrationLog("C,D", "internal/db/db.go:Migrate:exit", "migration exit schema state", map[string]any{"columnExists": columnExists, "migration033": migration033, "migration039": migration039})
	// #endregion
	return nil
}
