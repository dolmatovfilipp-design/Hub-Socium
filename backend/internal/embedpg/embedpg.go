package embedpg

import (
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
)

// Instance holds a running embedded Postgres process.
type Instance struct {
	db   *embeddedpostgres.EmbeddedPostgres
	URL  string
	Port uint32
	Dir  string
}

// ShouldStart reports whether embedded Postgres should be used.
// True when HUB_EMBEDDED_PG=1 or when DATABASE_URL is empty.
func ShouldStart(databaseURL string) bool {
	if os.Getenv("HUB_EMBEDDED_PG") == "1" {
		return true
	}
	return databaseURL == ""
}

// Start launches Postgres under rootDir (.data/pg by default relative to cwd).
// Sets DATABASE_URL in the process env and returns a connection URL.
func Start(rootDir string) (*Instance, error) {
	if rootDir == "" {
		rootDir = filepath.Join(".data", "pg")
	}
	abs, err := filepath.Abs(rootDir)
	if err != nil {
		return nil, err
	}
	binaries := filepath.Join(abs, "binaries")
	runtime := filepath.Join(abs, "runtime")
	data := filepath.Join(abs, "data")
	cache := filepath.Join(abs, "cache")

	for _, d := range []string{binaries, data, cache} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return nil, fmt.Errorf("mkdir %s: %w", d, err)
		}
	}

	port := uint32(54329)
	if v := os.Getenv("HUB_EMBEDDED_PG_PORT"); v != "" {
		n, err := strconv.ParseUint(v, 10, 32)
		if err != nil {
			return nil, fmt.Errorf("HUB_EMBEDDED_PG_PORT: %w", err)
		}
		port = uint32(n)
	}

	if err := ensurePortFree(port); err != nil {
		return nil, err
	}

	cfg := embeddedpostgres.DefaultConfig().
		Username("hub").
		Password("hub").
		Database("hub").
		Version(embeddedpostgres.V16).
		Port(port).
		BinariesPath(binaries).
		RuntimePath(runtime).
		DataPath(data).
		CachePath(cache).
		StartTimeout(90 * time.Second).
		StartParameters(map[string]string{
			"fsync":              "off",
			"synchronous_commit": "off",
			"full_page_writes":   "off",
		})

	db := embeddedpostgres.NewDatabase(cfg)
	slog.Info("starting embedded postgres", "dir", abs, "port", port)
	if err := db.Start(); err != nil {
		return nil, fmt.Errorf("embedded postgres start: %w", err)
	}

	url := fmt.Sprintf("postgres://hub:hub@127.0.0.1:%d/hub?sslmode=disable", port)
	_ = os.Setenv("DATABASE_URL", url)
	slog.Info("embedded postgres ready", "database_url", url)

	return &Instance{db: db, URL: url, Port: port, Dir: abs}, nil
}

// Stop shuts down the embedded process.
func (i *Instance) Stop() error {
	if i == nil || i.db == nil {
		return nil
	}
	return i.db.Stop()
}

func ensurePortFree(port uint32) error {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return fmt.Errorf("embedded postgres port %d in use: %w", port, err)
	}
	_ = ln.Close()
	return nil
}
