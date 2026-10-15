package chat

import "testing"

func TestClientMediaDurationMs(t *testing.T) {
	for _, ms := range []int{1, 400, 3000, 10000, 60000} {
		got, ok := ClientMediaDurationMs(ms, 60000)
		if !ok || got != ms {
			t.Fatalf("video note %d: ok=%v got=%d", ms, ok, got)
		}
	}
	got, ok := ClientMediaDurationMs(10000, 120000)
	if !ok || got != 10000 {
		t.Fatalf("voice 10s: ok=%v got=%d", ok, got)
	}
	for _, ms := range []int{0, -5, 60001, 120001} {
		if _, ok := ClientMediaDurationMs(ms, 60000); ok {
			t.Fatalf("accepted %d as a 60s note", ms)
		}
	}
	if _, ok := ClientMediaDurationMs(120000, 120000); !ok {
		t.Fatal("voice max")
	}
	if _, ok := ClientMediaDurationMs(120001, 120000); ok {
		t.Fatal("voice over max")
	}
}
