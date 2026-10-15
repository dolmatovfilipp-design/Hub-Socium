package chat

// ClientMediaDurationMs checks the recorder wall clock sent by the client.
// iOS WebKit reports 0, NaN, or +Inf for MediaRecorder blobs, and prepareSTTAudio
// can emit a short WAV from the same file. The message duration is this value,
// never a probed media length.
func ClientMediaDurationMs(ms, max int) (int, bool) {
	if ms < 1 || ms > max {
		return 0, false
	}
	return ms, true
}
