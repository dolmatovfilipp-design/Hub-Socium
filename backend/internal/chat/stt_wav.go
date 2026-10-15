package chat

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/hub-socium/hub/backend/internal/voice"
)

// ffmpegBin is the transcoder used before Whisper. Tests swap runFFmpeg.
var ffmpegBin = "ffmpeg"

// runFFmpeg writes 16 kHz mono PCM WAV for the STT service.
// iPhone voice and video circles are MP4/AAC; Whisper then reports it could
// not read the audio unless we hand it a plain WAV.
var runFFmpeg = func(ctx context.Context, bin, inPath, outPath string) error {
	cmd := exec.CommandContext(ctx, bin,
		"-hide_banner", "-loglevel", "error", "-y",
		"-i", inPath,
		"-vn",
		"-ac", "1",
		"-ar", "16000",
		"-c:a", "pcm_s16le",
		"-f", "wav",
		outPath,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("ffmpeg: %w: %s", err, out)
	}
	return nil
}

// prepareSTTAudio returns 16 kHz mono WAV. Files that are already in that
// shape skip ffmpeg. Everything else (m4a, aac, mp4, webm, 44.1k wav) is
// transcoded. The WAV length is only for Whisper. It must not replace
// messages.duration_ms: iOS blobs often decode shorter than the take, and
// the message keeps the client recorder clock (ClientMediaDurationMs).
func prepareSTTAudio(ctx context.Context, raw []byte, filename string) (wav []byte, name, contentType string, err error) {
	if len(raw) == 0 {
		return nil, "", "", fmt.Errorf("empty audio")
	}
	if pcm, rate, perr := voice.PCMFromWAV(raw); perr == nil && rate == 16000 && len(pcm) > 0 {
		return raw, "audio.wav", "audio/wav", nil
	}
	transcoded, terr := ffmpegToWav16k(ctx, raw, filename)
	if terr != nil {
		return nil, "", "", terr
	}
	if _, rate, perr := voice.PCMFromWAV(transcoded); perr != nil || rate != 16000 {
		return nil, "", "", fmt.Errorf("transcode did not produce 16k wav")
	}
	return transcoded, "audio.wav", "audio/wav", nil
}

func ffmpegToWav16k(ctx context.Context, raw []byte, filename string) ([]byte, error) {
	if _, err := exec.LookPath(ffmpegBin); err != nil {
		return nil, fmt.Errorf("ffmpeg not installed")
	}
	ext := filepath.Ext(filename)
	switch ext {
	case ".m4a", ".mp4", ".webm", ".ogg", ".wav", ".mp3", ".aac":
	default:
		ext = ".bin"
	}
	dir, err := os.MkdirTemp("", "hub-stt-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	inPath := filepath.Join(dir, "in"+ext)
	outPath := filepath.Join(dir, "out.wav")
	if err := os.WriteFile(inPath, raw, 0o600); err != nil {
		return nil, err
	}
	tctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	if err := runFFmpeg(tctx, ffmpegBin, inPath, outPath); err != nil {
		return nil, err
	}
	out, err := os.ReadFile(outPath)
	if err != nil {
		return nil, err
	}
	if len(out) < 44 {
		return nil, fmt.Errorf("empty wav")
	}
	return out, nil
}
