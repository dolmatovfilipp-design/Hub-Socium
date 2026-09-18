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
}

// Load reads configuration from environment variables.
// DATABASE_URL may be empty — the API then starts embedded Postgres (see embedpg).
func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:       getenv("HTTP_ADDR", ":8080"),
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		JWTSecret:      getenv("JWT_SECRET", "hub-dev-jwt-secret-change-me-32chars"),
		AccessTTLMin:   15,
		RefreshTTLDays: 30,
	}

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

	if len(cfg.JWTSecret) < 16 {
		return Config{}, fmt.Errorf("JWT_SECRET must be at least 16 characters")
	}
	if cfg.HTTPAddr == "" {
		return Config{}, fmt.Errorf("HTTP_ADDR must not be empty")
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
