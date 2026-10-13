package presence

import (
	"fmt"
	"time"
)

const onlineWindow = 90 * time.Second

// Label is the Russian presence line: «в сети» or «был(а) в сети …».
// gender is "male", "female", or anything else (neutral «был(а)»).
func Label(seen time.Time, gender string, now time.Time) string {
	if seen.IsZero() {
		return ""
	}
	delta := now.Sub(seen)
	if delta < 0 {
		delta = 0
	}
	if delta < onlineWindow {
		return "в сети"
	}
	verb := "был(а)"
	switch gender {
	case "male":
		verb = "был"
	case "female":
		verb = "была"
	}
	return verb + " в сети " + ago(delta, seen)
}

func ago(delta time.Duration, seen time.Time) string {
	mins := int(delta / time.Minute)
	if mins < 1 {
		mins = 1
	}
	if mins < 60 {
		return fmt.Sprintf("%d мин. назад", mins)
	}
	hours := mins / 60
	if hours < 24 {
		return fmt.Sprintf("%d ч. назад", hours)
	}
	days := hours / 24
	if days < 7 {
		return fmt.Sprintf("%d дн. назад", days)
	}
	return seen.Format("02.01.2006")
}
