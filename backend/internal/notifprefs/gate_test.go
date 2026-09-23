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
	if !p.TypeEnabled("repost") {
		t.Fatal("unmapped allowed")
	}
}
