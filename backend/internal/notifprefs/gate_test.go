package notifprefs

import (
	"testing"
	"time"
)

func TestInQuietHoursWrap(t *testing.T) {
	start, end := 22, 8
	p := Prefs{QuietStart: &start, QuietEnd: &end}
	loc := time.FixedZone("MSK", 3*3600)
	cases := []struct {
		hour int
		want bool
	}{
		{21, false}, {22, true}, {23, true}, {0, true}, {7, true}, {8, false}, {12, false},
	}
	for _, c := range cases {
		now := time.Date(2026, 9, 23, c.hour, 30, 0, 0, loc)
		if got := p.InQuietHours(now); got != c.want {
			t.Fatalf("hour %d: got %v want %v", c.hour, got, c.want)
		}
	}
}

func TestInQuietHoursSameDay(t *testing.T) {
	start, end := 13, 15
	p := Prefs{QuietStart: &start, QuietEnd: &end}
	loc := time.FixedZone("MSK", 3*3600)
	if !p.InQuietHours(time.Date(2026, 9, 23, 14, 0, 0, 0, loc)) {
		t.Fatal("14 should be quiet")
	}
	if p.InQuietHours(time.Date(2026, 9, 23, 15, 0, 0, 0, loc)) {
		t.Fatal("15 should not be quiet")
	}
}

func TestPauseBlocksActivityAndPush(t *testing.T) {
	start, end := 22, 8
	p := Prefs{
		Likes: true, Comments: true, Follows: true, Messages: true, Mentions: true,
		QuietStart: &start, QuietEnd: &end, QuietAllowFavorites: true, Paused: true,
	}
	loc := time.FixedZone("MSK", 3*3600)
	now := time.Date(2026, 9, 23, 12, 0, 0, 0, loc)
	if p.ActivityAllowed("like") || p.PushAllowed(now, "message", true) || p.PushAllowed(now, "call", true) {
		t.Fatal("pause blocks activity, messages, and calls")
	}
	p.Paused = false
	quiet := time.Date(2026, 9, 23, 23, 0, 0, 0, loc)
	if p.PushAllowed(quiet, "message", false) {
		t.Fatal("quiet hours block ordinary messages")
	}
	if !p.PushAllowed(quiet, "message", true) {
		t.Fatal("important chats still push during quiet hours")
	}
	if p.PushAllowed(quiet, "call", false) {
		t.Fatal("quiet hours block ordinary calls")
	}
	if !p.PushAllowed(quiet, "call", true) {
		t.Fatal("important chats still ring during quiet hours")
	}
	if !p.PushAllowed(now, "call", false) {
		t.Fatal("calls ring outside quiet hours")
	}
	if !p.ActivityAllowed("like") {
		t.Fatal("quiet hours do not block activity")
	}
}

func TestTypeEnabled(t *testing.T) {
	p := Prefs{Likes: false, Comments: true, Follows: true, Messages: false, Mentions: true}
	if p.TypeEnabled("like") {
		t.Fatal("like muted")
	}
	if !p.TypeEnabled("reply") {
		t.Fatal("reply allowed")
	}
	if p.TypeEnabled("message") {
		t.Fatal("message muted")
	}
	if !p.TypeEnabled("call") {
		t.Fatal("calls stay on when message alerts are off")
	}
	if !p.TypeEnabled("repost") {
		t.Fatal("unmapped allowed")
	}
}
