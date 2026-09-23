package config

import (
	"fmt"
	"os"
	"strings"
)

// Config holds runtime configuration from environment.
type Config struct {
	HTTPAddr       string
	DatabaseURL    string
	JWTSecret      string
	CORSOrigins    []string
	AccessTTLMin   int
	RefreshTTLDays int
	DevMode        bool
	RequireInvite  bool
	ModToken       string
	VAPIDPublicKey  string
	VAPIDPrivateKey string
	VAPIDSubject    string
}

// Load reads configuration from environment variables.
// DATABASE_URL may be empty — the API then starts embedded Postgres (see embedpg).
//
// JWT: outside embedded/dev, JWT_SECRET must be set and ≥ 32 characters (fail-fast).
// Short/default secrets are allowed only when HUB_EMBEDDED_PG=1, DATABASE_URL is empty
// (embedded), HUB_ENV=dev, or APP_ENV=development.
func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:       getenv("HTTP_ADDR", ":8080"),
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		AccessTTLMin:   15,
		RefreshTTLDays: 30,
		RequireInvite:  envTruthy("HUB_REQUIRE_INVITE"),
		ModToken:        strings.TrimSpace(os.Getenv("HUB_MOD_TOKEN")),
		VAPIDPublicKey:  strings.TrimSpace(os.Getenv("VAPID_PUBLIC_KEY")),
		VAPIDPrivateKey: strings.TrimSpace(os.Getenv("VAPID_PRIVATE_KEY")),
		VAPIDSubject:    strings.TrimSpace(getenv("VAPID_SUBJECT", "mailto:ops@hub.local")),
	}
	cfg.DevMode = isDevMode(cfg.DatabaseURL)

	origins := getenv("CORS_ORIGINS", strings.Join([]string{
		"http://localhost:5173",
		"http://127.0.0.1:5173",
		"http://localhost:5174",
		"http://127.0.0.1:5174",
	}, ","))
	for _, o := range strings.Split(origins, ",") {
		o = strings.TrimSpace(o)
		if o != "" {
			cfg.CORSOrigins = append(cfg.CORSOrigins, o)
		}
	}

	rawSecret := os.Getenv("JWT_SECRET")
	if rawSecret == "" {
		if cfg.DevMode {
			cfg.JWTSecret = "hub-dev-jwt-secret-change-me-32chars"
		} else {
			return Config{}, fmt.Errorf("JWT_SECRET is required outside embedded/dev (set HUB_ENV=dev or APP_ENV=development for local)")
		}
	} else {
		cfg.JWTSecret = rawSecret
	}

	if !cfg.DevMode && len(cfg.JWTSecret) < 32 {
		return Config{}, fmt.Errorf("JWT_SECRET must be at least 32 characters outside embedded/dev (got %d)", len(cfg.JWTSecret))
	}
	if cfg.DevMode && len(cfg.JWTSecret) < 1 {
		return Config{}, fmt.Errorf("JWT_SECRET must not be empty")
	}

	if cfg.HTTPAddr == "" {
		return Config{}, fmt.Errorf("HTTP_ADDR must not be empty")
	}
	return cfg, nil
}

func isDevMode(databaseURL string) bool {
	for _, key := range []string{"HUB_ENV", "APP_ENV"} {
		v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
		if v == "dev" || v == "development" {
			return true
		}
	}
	if os.Getenv("HUB_EMBEDDED_PG") == "1" {
		return true
	}
	// Empty DATABASE_URL → cmd/api starts embedded Postgres.
	return databaseURL == ""
}

func envTruthy(key string) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
