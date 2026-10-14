package telemetry

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"
	"unicode/utf8"
)

var (
	uuidRe  = regexp.MustCompile(`(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)
	emailRe = regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`)
	phoneRe = regexp.MustCompile(`\+?\d[\d\-\s()]{8,}\d`)
)

// Fingerprint groups the same failure across users. It ignores the user id.
func Fingerprint(source, message, stack, route string) string {
	sum := sha256.Sum256([]byte(source + "\n" + clip(message, 180) + "\n" + firstFrame(stack) + "\n" + NormalizeRoute(route)))
	return hex.EncodeToString(sum[:16])
}

// NormalizeRoute drops query strings and uuids so one bug stays one group.
func NormalizeRoute(route string) string {
	route = strings.TrimSpace(route)
	if i := strings.IndexAny(route, "?#"); i >= 0 {
		route = route[:i]
	}
	route = uuidRe.ReplaceAllString(route, ":id")
	return clip(route, 180)
}

func scrub(s string) string {
	s = emailRe.ReplaceAllString(s, "[email]")
	s = phoneRe.ReplaceAllString(s, "[phone]")
	return s
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if s == "" || n <= 0 {
		return ""
	}
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

func firstFrame(stack string) string {
	var fallback string
	for _, line := range strings.Split(stack, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if fallback == "" {
			fallback = line
		}
		if strings.Contains(line, ".go:") || strings.Contains(line, ".ts") || strings.Contains(line, ".tsx") || strings.HasPrefix(line, "at ") {
			return clip(line, 180)
		}
	}
	return clip(fallback, 180)
}
