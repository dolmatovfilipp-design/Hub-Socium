package chat

import (
	"bytes"
	"context"
	"encoding/binary"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/hub-socium/hub/backend/internal/voice"
)

func TestPrepareSTTAudioKeeps16kWav(t *testing.T) {
	wav := tinyPCMWav(16000)
	calls := 0
	orig := runFFmpeg
	runFFmpeg = func(context.Context, string, string, string) error {
		calls++
		return nil
	}
	t.Cleanup(func() { runFFmpeg = orig })

	got, name, ct, err := prepareSTTAudio(context.Background(), wav, "audio.wav")
	if err != nil {
		t.Fatal(err)
	}
	if calls != 0 {
		t.Fatalf("ffmpeg calls %d", calls)
	}
	if name != "audio.wav" || ct != "audio/wav" || !bytes.Equal(got, wav) {
		t.Fatalf("name=%s ct=%s", name, ct)
	}
}

func TestPrepareSTTAudioTranscodesMP4(t *testing.T) {
	raw := make([]byte, 16)
	copy(raw[4:8], "ftyp")
	copy(raw[8:12], "mp42")
	want := tinyPCMWav(16000)
	orig := runFFmpeg
	runFFmpeg = func(_ context.Context, _, inPath, outPath string) error {
		in, err := os.ReadFile(inPath)
		if err != nil {
			return err
		}
		if string(in[4:8]) != "ftyp" {
			t.Fatalf("ffmpeg input is not mp4: %q", in[4:8])
		}
		if filepath.Ext(inPath) != ".m4a" && filepath.Ext(inPath) != ".mp4" {
			t.Fatalf("ext %s", inPath)
		}
		return os.WriteFile(outPath, want, 0o600)
	}
	t.Cleanup(func() { runFFmpeg = orig })

	got, name, ct, err := prepareSTTAudio(context.Background(), raw, "audio.m4a")
	if err != nil {
		t.Fatal(err)
	}
	if name != "audio.wav" || ct != "audio/wav" || !bytes.Equal(got, want) {
		t.Fatalf("name=%s ct=%s len=%d", name, ct, len(got))
	}
}

func TestPrepareSTTAudioFFmpegAAC(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg missing")
	}
	dir := t.TempDir()
	m4a := filepath.Join(dir, "note.m4a")
	cmd := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=0.4",
		"-c:a", "aac", m4a)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("lavfi aac: %v %s", err, out)
	}
	raw, err := os.ReadFile(m4a)
	if err != nil {
		t.Fatal(err)
	}
	got, name, ct, err := prepareSTTAudio(context.Background(), raw, "voice.m4a")
	if err != nil {
		t.Fatal(err)
	}
	if name != "audio.wav" || ct != "audio/wav" {
		t.Fatalf("name=%s ct=%s", name, ct)
	}
	_, rate, err := voice.PCMFromWAV(got)
	if err != nil || rate != 16000 {
		t.Fatalf("rate=%d err=%v", rate, err)
	}
}

func tinyPCMWav(rate int) []byte {
	const samples = 160
	pcm := make([]byte, samples*2)
	buf := make([]byte, 44+len(pcm))
	copy(buf[0:4], "RIFF")
	binary.LittleEndian.PutUint32(buf[4:8], uint32(36+len(pcm)))
	copy(buf[8:12], "WAVE")
	copy(buf[12:16], "fmt ")
	binary.LittleEndian.PutUint32(buf[16:20], 16)
	binary.LittleEndian.PutUint16(buf[20:22], 1)
	binary.LittleEndian.PutUint16(buf[22:24], 1)
	binary.LittleEndian.PutUint32(buf[24:28], uint32(rate))
	binary.LittleEndian.PutUint32(buf[28:32], uint32(rate*2))
	binary.LittleEndian.PutUint16(buf[32:34], 2)
	binary.LittleEndian.PutUint16(buf[34:36], 16)
	copy(buf[36:40], "data")
	binary.LittleEndian.PutUint32(buf[40:44], uint32(len(pcm)))
	copy(buf[44:], pcm)
	return buf
}
