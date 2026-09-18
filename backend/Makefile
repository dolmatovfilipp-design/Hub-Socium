.PHONY: tidy build test run run-embedded compose-up compose-down migrate seed vet all

HTTP_ADDR ?= :8080
DATABASE_URL ?= postgres://hub:hub@localhost:5432/hub?sslmode=disable
JWT_SECRET ?= hub-dev-jwt-secret-change-me-32chars
CORS_ORIGINS ?= http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174

export JWT_SECRET HTTP_ADDR CORS_ORIGINS

tidy:
	go mod tidy

build:
	go build -o bin/api ./cmd/api

test:
	go test ./...

vet:
	go vet ./...

compose-up:
	docker compose up -d

compose-down:
	docker compose down

migrate: build
	./bin/api -migrate-only

run: build
	DATABASE_URL='$(DATABASE_URL)' ./bin/api

# Local Postgres without Docker (downloads binaries on first run into .data/pg).
run-embedded: build
	env -u DATABASE_URL HUB_EMBEDDED_PG=1 SEED_DEMO=1 ./bin/api

seed: build
	./bin/api -seed-only

all: tidy vet test build
