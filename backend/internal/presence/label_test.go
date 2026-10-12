package presence

import (
	"testing"
	"time"
)

func TestLabelOnlineAndGender(t *testing.T) {
	now := time.Date(2026, 10, 12, 15, 0, 0, 0, time.UTC)
	if got := Label(now.Add(-30*time.Second), "female", now); got != "в сети" {
		t.Fatalf("online: %q", got)
	}
	if got := Label(now.Add(-5*time.Minute), "male", now); got != "был в сети 5 мин. назад" {
		t.Fatalf("male: %q", got)
	}
	if got := Label(now.Add(-5*time.Minute), "female", now); got != "была в сети 5 мин. назад" {
		t.Fatalf("female: %q", got)
	}
	if got := Label(now.Add(-2*time.Hour), "", now); got != "был(а) в сети 2 ч. назад" {
		t.Fatalf("neutral: %q", got)
	}
	if got := Label(time.Time{}, "male", now); got != "" {
		t.Fatalf("zero: %q", got)
	}
}
