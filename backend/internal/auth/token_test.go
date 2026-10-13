package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAccessTokenFromRequest(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/v1/me/chat-prefs", nil)
	if got := accessTokenFromRequest(r); got != "" {
		t.Fatalf("empty request: %q", got)
	}

	r.Header.Set("Authorization", "bearer abc")
	if got := accessTokenFromRequest(r); got != "abc" {
		t.Fatalf("lowercase bearer: %q", got)
	}

	r.Header.Set("Authorization", "BEARER  xyz")
	if got := accessTokenFromRequest(r); got != "xyz" {
		t.Fatalf("uppercase bearer: %q", got)
	}

	r = httptest.NewRequest(http.MethodGet, "/v1/me/heartbeat", nil)
	r.Header.Set("X-Access-Token", "from-header")
	if got := accessTokenFromRequest(r); got != "from-header" {
		t.Fatalf("x-access-token: %q", got)
	}

	r = httptest.NewRequest(http.MethodGet, "/v1/me/calls/incoming", nil)
	r.AddCookie(&http.Cookie{Name: "hub_access_token", Value: "from-cookie"})
	if got := accessTokenFromRequest(r); got != "from-cookie" {
		t.Fatalf("cookie: %q", got)
	}

	r = httptest.NewRequest(http.MethodGet, "/v1/me/chat-prefs?access_token=from-query", nil)
	if got := accessTokenFromRequest(r); got != "from-query" {
		t.Fatalf("query: %q", got)
	}

	r = httptest.NewRequest(http.MethodGet, "/v1/me/chat-prefs?access_token=from-query", nil)
	r.Header.Set("Authorization", "Bearer header-wins")
	r.Header.Set("X-Access-Token", "nope")
	if got := accessTokenFromRequest(r); got != "header-wins" {
		t.Fatalf("header precedence: %q", got)
	}
}
