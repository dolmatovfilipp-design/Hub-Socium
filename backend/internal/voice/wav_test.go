package voice

import (
	"encoding/binary"
	"testing"
)

func TestPCMFromWAV(t *testing.T) {
	pcm := []byte{0x00, 0x00, 0xff, 0x7f}
	wav := makeWAV(16000, pcm)
	got, rate, err := PCMFromWAV(wav)
	if err != nil {
		t.Fatal(err)
	}
	if rate != 16000 {
		t.Fatalf("rate %d", rate)
	}
	if string(got) != string(pcm) {
		t.Fatalf("pcm mismatch")
	}
	if _, _, err := PCMFromWAV([]byte("nope")); err == nil {
		t.Fatal("expected error")
	}
}

func TestResolveProvider(t *testing.T) {
	if g := ResolveProvider("", "ya", "oa"); g != ProviderYandex {
		t.Fatalf("default %s", g)
	}
	if g := ResolveProvider("", "", "oa"); g != ProviderNone {
		t.Fatalf("openai must be explicit, got %s", g)
	}
	if g := ResolveProvider("openai", "ya", "oa"); g != ProviderOpenAI {
		t.Fatalf("explicit openai %s", g)
	}
	if g := ResolveProvider("off", "ya", "oa"); g != ProviderNone {
		t.Fatalf("off %s", g)
	}
	hint := SetupHint(ProviderNone, false)
	if hint == "" {
		t.Fatal("empty hint")
	}
}

func makeWAV(rate int, pcm []byte) []byte {
	// 44-byte canonical header.
	dataSize := len(pcm)
	riffSize := 36 + dataSize
	b := make([]byte, 44+dataSize)
	copy(b[0:4], "RIFF")
	binary.LittleEndian.PutUint32(b[4:8], uint32(riffSize))
	copy(b[8:12], "WAVE")
	copy(b[12:16], "fmt ")
	binary.LittleEndian.PutUint32(b[16:20], 16)
	binary.LittleEndian.PutUint16(b[20:22], 1)
	binary.LittleEndian.PutUint16(b[22:24], 1)
	binary.LittleEndian.PutUint32(b[24:28], uint32(rate))
	binary.LittleEndian.PutUint32(b[28:32], uint32(rate*2))
	binary.LittleEndian.PutUint16(b[32:34], 2)
	binary.LittleEndian.PutUint16(b[34:36], 16)
	copy(b[36:40], "data")
	binary.LittleEndian.PutUint32(b[40:44], uint32(dataSize))
	copy(b[44:], pcm)
	return b
}
