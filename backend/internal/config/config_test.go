package config

import (
	"os"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	os.Unsetenv("JWT_SECRET")
	os.Unsetenv("HTTP_ADDR")
	os.Unsetenv("CORS_ORIGINS")
	os.Unsetenv("DATABASE_URL")
	os.Unsetenv("HUB_EMBEDDED_PG")
	os.Unsetenv("HUB_ENV")
	os.Unsetenv("APP_ENV")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.HTTPAddr != ":8080" {
		t.Fatalf("HTTPAddr = %q, want :8080", cfg.HTTPAddr)
	}
	if !cfg.DevMode {
		t.Fatal("expected DevMode when DATABASE_URL empty")
	}
	if len(cfg.JWTSecret) < 16 {
		t.Fatalf("JWTSecret too short")
	}
	if len(cfg.CORSOrigins) == 0 {
		t.Fatalf("CORSOrigins empty")
	}
	if cfg.AccessTTLMin != 15 {
		t.Fatalf("AccessTTLMin = %d", cfg.AccessTTLMin)
	}
}

func TestLoadRejectsShortSecretOutsideDev(t *testing.T) {
	t.Setenv("JWT_SECRET", "short")
	t.Setenv("DATABASE_URL", "postgres://hub:hub@localhost:5432/hub")
	t.Setenv("HUB_EMBEDDED_PG", "0")
	os.Unsetenv("HUB_ENV")
	os.Unsetenv("APP_ENV")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error for short JWT_SECRET outside dev")
	}
}

func TestLoadAllowsShortSecretInDev(t *testing.T) {
	t.Setenv("JWT_SECRET", "short-dev")
	t.Setenv("HUB_ENV", "dev")
	t.Setenv("DATABASE_URL", "postgres://hub:hub@localhost:5432/hub")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.DevMode {
		t.Fatal("expected DevMode")
	}
	if cfg.JWTSecret != "short-dev" {
		t.Fatalf("JWTSecret = %q", cfg.JWTSecret)
	}
}

func TestLoadRequiresSecretInProd(t *testing.T) {
	os.Unsetenv("JWT_SECRET")
	t.Setenv("DATABASE_URL", "postgres://hub:hub@localhost:5432/hub")
	t.Setenv("HUB_EMBEDDED_PG", "0")
	os.Unsetenv("HUB_ENV")
	os.Unsetenv("APP_ENV")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error when JWT_SECRET missing outside dev")
	}
}

func TestLoadCustom(t *testing.T) {
	t.Setenv("HTTP_ADDR", ":9090")
	t.Setenv("JWT_SECRET", "this-is-a-long-enough-secret-32ch")
	t.Setenv("CORS_ORIGINS", "http://a.test, http://b.test")
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("HUB_EMBEDDED_PG", "0")
	os.Unsetenv("HUB_ENV")
	os.Unsetenv("APP_ENV")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.HTTPAddr != ":9090" {
		t.Fatalf("HTTPAddr = %q", cfg.HTTPAddr)
	}
	if cfg.DatabaseURL != "postgres://x" {
		t.Fatalf("DatabaseURL = %q", cfg.DatabaseURL)
	}
	if len(cfg.CORSOrigins) != 2 {
		t.Fatalf("CORSOrigins = %#v", cfg.CORSOrigins)
	}
	if cfg.DevMode {
		t.Fatal("expected non-dev with DATABASE_URL set")
	}
}
