package webrtcice

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestTURNCredentialHMAC(t *testing.T) {
	exp := time.Unix(1_700_000_000, 0)
	user, cred := turnCredential("test-secret", exp)
	if user != "1700000000:hub" {
		t.Fatalf("username %q", user)
	}
	mac := hmac.New(sha1.New, []byte("test-secret"))
	_, _ = mac.Write([]byte(user))
	want := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if cred != want {
		t.Fatalf("credential %q want %q", cred, want)
	}
	unix, _, ok := strings.Cut(user, ":")
	if !ok {
		t.Fatal("missing expiry")
	}
	n, err := strconv.ParseInt(unix, 10, 64)
	if err != nil || n != exp.Unix() {
		t.Fatalf("expiry %s err %v", unix, err)
	}
}

func TestDefaultICEHMACCoturn(t *testing.T) {
	t.Setenv("HUB_TURN", "s3cret")
	os.Unsetenv("HUB_TURN_SECRET")
	os.Unsetenv("HUB_TURN_URLS")
	out := DefaultICE()
	var sawTurn, sawTurns bool
	var user string
	for _, e := range out {
		u, _ := e["urls"].(string)
		switch u {
		case "turn:31.31.192.151:3478":
			sawTurn = true
			user, _ = e["username"].(string)
			if e["credential"] == "" {
				t.Fatal("missing turn credential")
			}
		case "turns:31.31.192.151:5349":
			sawTurns = true
			if e["username"] == "" || e["credential"] == "" {
				t.Fatal("missing turns credential")
			}
		}
	}
	if !sawTurn || !sawTurns {
		t.Fatalf("coturn urls missing: %#v", out)
	}
	exp, _, _ := strings.Cut(user, ":")
	n, err := strconv.ParseInt(exp, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	if time.Unix(n, 0).Before(time.Now().Add(time.Hour)) {
		t.Fatalf("credential expires too soon: %s", user)
	}
}

func TestDefaultICEStaticURLsWithoutSecret(t *testing.T) {
	os.Unsetenv("HUB_TURN")
	os.Unsetenv("HUB_TURN_SECRET")
	t.Setenv("HUB_TURN_URLS", "turn:example.test:3478")
	t.Setenv("HUB_TURN_USERNAME", "static-user")
	t.Setenv("HUB_TURN_CREDENTIAL", "static-pass")
	out := DefaultICE()
	var found bool
	for _, e := range out {
		if e["urls"] == "turn:example.test:3478" {
			found = true
			if e["username"] != "static-user" || e["credential"] != "static-pass" {
				t.Fatalf("static creds %#v", e)
			}
		}
	}
	if !found {
		t.Fatalf("missing static url %#v", out)
	}
}
