package db

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestConnectRetryBadURLDoesNotWait(t *testing.T) {
	start := time.Now()
	_, err := ConnectRetry(context.Background(), "postgres://hub@127.0.0.1:notaport/hub", 2*time.Minute)
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "parse DATABASE_URL") && !strings.Contains(err.Error(), "database not ready") {
		t.Fatalf("error %q", err)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatalf("bad url waited %s: %v", time.Since(start), err)
	}
}

func TestConnectRetryRefusedExitsWithinBudget(t *testing.T) {
	start := time.Now()
	_, err := ConnectRetry(context.Background(), "postgres://hub:hub@127.0.0.1:1/hub?connect_timeout=1", 1200*time.Millisecond)
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "database not ready") {
		t.Fatalf("error %q", err)
	}
	elapsed := time.Since(start)
	if elapsed > 8*time.Second {
		t.Fatalf("retry ran too long: %s", elapsed)
	}
	if elapsed < 400*time.Millisecond {
		t.Fatalf("retry returned without backing off: %s", elapsed)
	}
}

func TestRetryableConnectErr(t *testing.T) {
	if retryableConnectErr(errString("parse DATABASE_URL: nope")) {
		t.Fatal("parse errors must fail fast")
	}
	if retryableConnectErr(errString("DATABASE_URL is empty")) {
		t.Fatal("empty url must fail fast")
	}
	if !retryableConnectErr(errString("ping: dial tcp connection refused")) {
		t.Fatal("connection refused should retry")
	}
}

type errString string

func (e errString) Error() string { return string(e) }
