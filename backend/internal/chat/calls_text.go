package chat

import "fmt"

// formatCallDuration renders a call length the way the inbox preview does: "0:11", "17:17", "1:01:01".
func formatCallDuration(sec int) string {
	if sec < 0 {
		sec = 0
	}
	h := sec / 3600
	m := (sec % 3600) / 60
	s := sec % 60
	if h > 0 {
		return fmt.Sprintf("%d:%02d:%02d", h, m, s)
	}
	return fmt.Sprintf("%d:%02d", m, s)
}

// callPreviewBody is the shared chat-list line for a finished call.
// Completed calls keep the duration; everything else is a missed-call line.
func callPreviewBody(video bool, outcome string, durationSec int) string {
	if outcome == "completed" && durationSec > 0 {
		if video {
			return "Видеозвонок, " + formatCallDuration(durationSec)
		}
		return "Звонок, " + formatCallDuration(durationSec)
	}
	if video {
		return "Пропущенный видеозвонок"
	}
	return "Пропущенный звонок"
}

// callDirection classifies a stored call for one viewer: missed, incoming, or outgoing.
func callDirection(viewerID, initiatorID, outcome string) string {
	mine := viewerID != "" && viewerID == initiatorID
	switch outcome {
	case "completed":
		if mine {
			return "outgoing"
		}
		return "incoming"
	case "cancelled":
		if mine {
			return "outgoing"
		}
		return "missed"
	case "declined":
		if mine {
			return "outgoing"
		}
		return "incoming"
	default:
		if mine {
			return "outgoing"
		}
		return "missed"
	}
}
