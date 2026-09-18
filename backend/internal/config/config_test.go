package config

import (
	"os"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv("JWT_SECRET", "")
	t.Setenv("HTTP_ADDR", "")
	t.Setenv("CORS_ORIGINS", "")
	t.Setenv("DATABASE_URL", "")

	// clear then rely on defaults via unset — Setenv "" still sets empty
	os.Unsetenv("JWT_SECRET")
	os.Unsetenv("HTTP_ADDR")
	os.Unsetenv("CORS_ORIGINS")
	os.Unsetenv("DATABASE_URL")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.HTTPAddr != ":8080" {
		t.Errorf("HTTPAddr = %q, want :8080", cfg.HTTPAddr)
	}
	if len(cfg.JWTSecret) < 16 {
		t.Errorf("JWTSecret too short")
	}
	if len(cfg.CORSOrigins) == 0 {
		t.Errorf("CORSOrigins empty")
	}
	if cfg.AccessTTLMin != 15 {
		t.Errorf("AccessTTLMin = %d", cfg.AccessTTLMin)
	}
}

func TestLoadRejectsShortSecret(t *testing.T) {
	t.Setenv("JWT_SECRET", "short")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error for short JWT_SECRET")
	}
}

func TestLoadCustom(t *testing.T) {
	t.Setenv("HTTP_ADDR", ":9090")
	t.Setenv("JWT_SECRET", "this-is-a-long-enough-secret")
	t.Setenv("CORS_ORIGINS", "http://a.test, http://b.test")
	t.Setenv("DATABASE_URL", "postgres://x")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.HTTPAddr != ":9090" {
		t.Errorf("HTTPAddr = %q", cfg.HTTPAddr)
	}
	if cfg.DatabaseURL != "postgres://x" {
		t.Errorf("DatabaseURL = %q", cfg.DatabaseURL)
	}
	if len(cfg.CORSOrigins) != 2 {
		t.Fatalf("CORSOrigins = %#v", cfg.CORSOrigins)
	}
}
