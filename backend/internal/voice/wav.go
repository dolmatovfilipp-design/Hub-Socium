package voice

import (
	"encoding/binary"
	"fmt"
)

// PCMFromWAV returns 16-bit little-endian mono PCM and its sample rate.
// Yandex SpeechKit short audio wants raw LPCM, not the WAV container.
func PCMFromWAV(b []byte) (pcm []byte, sampleRate int, err error) {
	if len(b) < 44 || string(b[0:4]) != "RIFF" || string(b[8:12]) != "WAVE" {
		return nil, 0, fmt.Errorf("not a wav file")
	}
	off := 12
	var rate int
	var data []byte
	for off+8 <= len(b) {
		id := string(b[off : off+4])
		size := int(binary.LittleEndian.Uint32(b[off+4 : off+8]))
		off += 8
		if size < 0 || off+size > len(b) {
			return nil, 0, fmt.Errorf("bad wav chunk")
		}
		chunk := b[off : off+size]
		off += size
		if size%2 == 1 && off < len(b) {
			off++
		}
		switch id {
		case "fmt ":
			if len(chunk) < 16 {
				return nil, 0, fmt.Errorf("short fmt chunk")
			}
			format := binary.LittleEndian.Uint16(chunk[0:2])
			channels := binary.LittleEndian.Uint16(chunk[2:4])
			rate = int(binary.LittleEndian.Uint32(chunk[4:8]))
			bits := binary.LittleEndian.Uint16(chunk[14:16])
			if format != 1 || channels != 1 || bits != 16 {
				return nil, 0, fmt.Errorf("wav must be PCM 16-bit mono")
			}
		case "data":
			data = chunk
		}
	}
	if rate == 0 || len(data) == 0 {
		return nil, 0, fmt.Errorf("wav has no pcm data")
	}
	return data, rate, nil
}
