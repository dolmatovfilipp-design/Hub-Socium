package chat

import "testing"

func TestBuildStickerSVG(t *testing.T) {
	raw := string(buildStickerSVG("🔥", "скидка & <hit>", "#111111"))
	if !stringsContains(raw, "скидка &amp; &lt;hit&gt;") || !stringsContains(raw, "#111111") {
		t.Fatalf("svg: %s", raw)
	}
}

func TestParseStickerLine(t *testing.T) {
	emoji, caption, color := parseStickerLine("🎁 | Подарок | #aabbcc", "fallback")
	if emoji != "🎁" || caption != "Подарок" || color != "#aabbcc" {
		t.Fatalf("%s %s %s", emoji, caption, color)
	}
}

func stringsContains(s, part string) bool {
	return len(s) >= len(part) && (s == part || len(part) == 0 || (len(s) > 0 && contains(s, part)))
}

func contains(s, part string) bool {
	for i := 0; i+len(part) <= len(s); i++ {
		if s[i:i+len(part)] == part {
			return true
		}
	}
	return false
}
