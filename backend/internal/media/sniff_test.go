package media

import "testing"

func TestNormalizeContentTypeSniffsMP4(t *testing.T) {
	raw := make([]byte, 16)
	copy(raw[4:8], "ftyp")
	copy(raw[8:12], "mp42")
	if got := normalizeContentType("video/webm", raw); got != "video/mp4" {
		t.Fatalf("video labeled webm: %s", got)
	}
	copy(raw[8:12], "M4A ")
	if got := normalizeContentType("audio/webm", raw); got != "audio/mp4" {
		t.Fatalf("m4a brand: %s", got)
	}
	copy(raw[8:12], "isom")
	if got := normalizeContentType("audio/mp4", raw); got != "audio/mp4" {
		t.Fatalf("audio header: %s", got)
	}
	if got := normalizeContentType("video/mp4", raw); got != "video/mp4" {
		t.Fatalf("video header: %s", got)
	}
}
