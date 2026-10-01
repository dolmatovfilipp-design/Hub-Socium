// Package webrtcice shares STUN/TURN config for DM calls and voice rooms.
package webrtcice

import (
	"os"
	"strings"
)

// DefaultICE returns STUN (+ optional TURN).
// Prefer env:
//
//	HUB_TURN_URLS=turn:host:80,turns:host:443   (comma-separated)
//	HUB_TURN_USERNAME / HUB_TURN_CREDENTIAL     (optional shared auth)
//
// If HUB_TURN_URLS unset, adds free public openrelay.metered.ca demo TURN
// (rate-limited; OK for MVP demos — replace in prod). Multiple Google STUN always included.
func DefaultICE() []map[string]any {
	out := []map[string]any{
		{"urls": "stun:stun.l.google.com:19302"},
		{"urls": "stun:stun1.l.google.com:19302"},
		{"urls": "stun:stun2.l.google.com:19302"},
	}
	urlsEnv := strings.TrimSpace(os.Getenv("HUB_TURN_URLS"))
	user := strings.TrimSpace(os.Getenv("HUB_TURN_USERNAME"))
	cred := strings.TrimSpace(os.Getenv("HUB_TURN_CREDENTIAL"))
	if urlsEnv != "" {
		for _, u := range strings.Split(urlsEnv, ",") {
			u = strings.TrimSpace(u)
			if u == "" {
				continue
			}
			entry := map[string]any{"urls": u}
			if user != "" {
				entry["username"] = user
				entry["credential"] = cred
			}
			out = append(out, entry)
		}
		return out
	}
	// Public demo TURN — reduces symmetric-NAT failures; not for production load.
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
