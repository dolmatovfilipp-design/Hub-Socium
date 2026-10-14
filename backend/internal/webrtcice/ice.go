// Package webrtcice shares STUN/TURN config for DM calls and voice rooms.
package webrtcice

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"os"
	"strings"
	"time"
)

// Coturn on the hub host. TURN REST: username is "<expiry>:<user>",
// credential is base64(HMAC-SHA1(secret, username)). Secret is HUB_TURN
// (HUB_TURN_SECRET is accepted as an alias).
const (
	defaultTURNHost = "31.31.192.151"
	turnUser        = "hub"
	turnTTL         = 24 * time.Hour
)

// DefaultICE returns STUN and TURN.
//
//	HUB_TURN or HUB_TURN_SECRET  shared coturn secret (time-limited HMAC)
//	HUB_TURN_URLS                optional comma-separated override
//	HUB_TURN_USERNAME / HUB_TURN_CREDENTIAL  static auth when no secret is set
//
// With a secret and no URL override, servers are
// stun/turn on 31.31.192.151:3478 and turns on :5349.
// Without either, a public demo TURN is added so local calls still have a relay.
func DefaultICE() []map[string]any {
	out := []map[string]any{
		{"urls": "stun:stun.l.google.com:19302"},
		{"urls": "stun:stun1.l.google.com:19302"},
		{"urls": "stun:stun2.l.google.com:19302"},
	}
	secret := turnSecret()
	urls := turnURLs()
	if secret != "" {
		user, cred := turnCredential(secret, time.Now().Add(turnTTL))
		for _, u := range urls {
			entry := map[string]any{"urls": u}
			if !strings.HasPrefix(u, "stun:") {
				entry["username"] = user
				entry["credential"] = cred
			}
			out = append(out, entry)
		}
		return out
	}
	if len(urls) > 0 && strings.TrimSpace(os.Getenv("HUB_TURN_URLS")) != "" {
		user := strings.TrimSpace(os.Getenv("HUB_TURN_USERNAME"))
		cred := strings.TrimSpace(os.Getenv("HUB_TURN_CREDENTIAL"))
		for _, u := range urls {
			entry := map[string]any{"urls": u}
			if user != "" {
				entry["username"] = user
				entry["credential"] = cred
			}
			out = append(out, entry)
		}
		return out
	}
	out = append(out,
		map[string]any{
			"urls":       "turn:openrelay.metered.ca:80",
			"username":   "openrelayproject",
			"credential": "openrelayproject",
		},
		map[string]any{
			"urls":       "turn:openrelay.metered.ca:443",
			"username":   "openrelayproject",
			"credential": "openrelayproject",
		},
		map[string]any{
			"urls":       "turn:openrelay.metered.ca:443?transport=tcp",
			"username":   "openrelayproject",
			"credential": "openrelayproject",
		},
	)
	return out
}

func turnSecret() string {
	if s := strings.TrimSpace(os.Getenv("HUB_TURN")); s != "" {
		return s
	}
	return strings.TrimSpace(os.Getenv("HUB_TURN_SECRET"))
}

func defaultTURNURLs() []string {
	host := defaultTURNHost
	return []string{
		"stun:" + host + ":3478",
		"turn:" + host + ":3478",
		"turn:" + host + ":3478?transport=tcp",
		"turns:" + host + ":5349",
	}
}

func turnURLs() []string {
	raw := strings.TrimSpace(os.Getenv("HUB_TURN_URLS"))
	if raw == "" {
		if turnSecret() == "" {
			return nil
		}
		return defaultTURNURLs()
	}
	var urls []string
	for _, u := range strings.Split(raw, ",") {
		u = strings.TrimSpace(u)
		if u != "" {
			urls = append(urls, u)
		}
	}
	return urls
}

// turnCredential is coturn use-auth-secret / REST API format.
// username = "<unix expiry>:<user>", credential = base64(HMAC-SHA1(secret, username)).
func turnCredential(secret string, expires time.Time) (username, credential string) {
	username = fmt.Sprintf("%d:%s", expires.Unix(), turnUser)
	mac := hmac.New(sha1.New, []byte(secret))
	_, _ = mac.Write([]byte(username))
	credential = base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return username, credential
}
