package chat

import "testing"

func TestFormatCallDuration(t *testing.T) {
	cases := []struct {
		sec  int
		want string
	}{
		{0, "0:00"},
		{11, "0:11"},
		{17*60 + 17, "17:17"},
		{3600 + 60 + 1, "1:01:01"},
		{-4, "0:00"},
	}
	for _, tc := range cases {
		if got := formatCallDuration(tc.sec); got != tc.want {
			t.Fatalf("formatCallDuration(%d)=%q want %q", tc.sec, got, tc.want)
		}
	}
}

func TestCallPreviewBody(t *testing.T) {
	if got := callPreviewBody(true, "completed", 11); got != "Видеозвонок, 0:11" {
		t.Fatalf("video completed: %q", got)
	}
	if got := callPreviewBody(false, "completed", 17*60+17); got != "Звонок, 17:17" {
		t.Fatalf("audio completed: %q", got)
	}
	if got := callPreviewBody(false, "missed", 0); got != "Пропущенный звонок" {
		t.Fatalf("audio missed: %q", got)
	}
	if got := callPreviewBody(true, "cancelled", 0); got != "Пропущенный видеозвонок" {
		t.Fatalf("video cancelled: %q", got)
	}
	if got := callPreviewBody(false, "declined", 0); got != "Пропущенный звонок" {
		t.Fatalf("declined: %q", got)
	}
}

func TestCallDirection(t *testing.T) {
	const caller = "caller"
	const peer = "peer"
	if got := callDirection(caller, caller, "completed"); got != "outgoing" {
		t.Fatalf("caller completed: %s", got)
	}
	if got := callDirection(peer, caller, "completed"); got != "incoming" {
		t.Fatalf("peer completed: %s", got)
	}
	if got := callDirection(peer, caller, "missed"); got != "missed" {
		t.Fatalf("peer missed: %s", got)
	}
	if got := callDirection(peer, caller, "cancelled"); got != "missed" {
		t.Fatalf("peer cancelled: %s", got)
	}
	if got := callDirection(caller, caller, "cancelled"); got != "outgoing" {
		t.Fatalf("caller cancelled: %s", got)
	}
	if got := callDirection(peer, caller, "declined"); got != "incoming" {
		t.Fatalf("peer declined: %s", got)
	}
}
