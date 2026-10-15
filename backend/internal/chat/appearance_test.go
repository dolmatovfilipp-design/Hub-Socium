package chat

import "testing"

func TestNormalizeBackgroundWallpaper(t *testing.T) {
	got, err := NormalizeBackground(ChatBackground{Kind: "wallpaper", ID: "bg12", Blur: 80, Dim: -4, URL: "/wallpapers/bg12.png"})
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "bg12" || got.Blur != bgBlurMax || got.Dim != 0 || got.URL != "/wallpapers/bg12.png" {
		t.Fatalf("got %+v", got)
	}
	got, err = NormalizeBackground(ChatBackground{Kind: "wallpaper", URL: "/wallpapers/night-sky.webp"})
	if err != nil || got.ID != "night-sky" {
		t.Fatalf("stem: %+v %v", got, err)
	}
}

func TestNormalizeBackgroundRejectsUnsafe(t *testing.T) {
	cases := []ChatBackground{
		{Kind: "custom", URL: "https://evil.test/a.jpg"},
		{Kind: "custom", URL: "javascript:alert(1)"},
		{Kind: "wallpaper", ID: "../etc", URL: "/wallpapers/../secret.png"},
		{Kind: "wallpaper", URL: "/wallpapers/a/b.png"},
		{Kind: "nope"},
	}
	for _, c := range cases {
		if _, err := NormalizeBackground(c); err == nil {
			t.Fatalf("expected error for %+v", c)
		}
	}
}

func TestNormalizeBackgroundCustomAndNone(t *testing.T) {
	got, err := NormalizeBackground(ChatBackground{
		Kind: "custom",
		URL:  "/v1/media/11111111-1111-1111-1111-111111111111",
		Blur: 3,
		Dim:  40,
		ID:   "ignored",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "" || got.URL == "" || got.Blur != 3 || got.Dim != 40 {
		t.Fatalf("got %+v", got)
	}
	got, err = NormalizeBackground(ChatBackground{Kind: "none", URL: "/wallpapers/bg1.png", Blur: 10, Dim: 10})
	if err != nil || got.URL != "" || got.Blur != 0 || got.Dim != 0 || got.Kind != "none" {
		t.Fatalf("none: %+v %v", got, err)
	}
}

func TestNormalizeAccentAndFont(t *testing.T) {
	if _, err := normalizeAccent("blue"); err != nil {
		t.Fatal(err)
	}
	if _, err := normalizeAccent("neon"); err == nil {
		t.Fatal("expected unknown accent")
	}
	if _, err := normalizeFontScale("lg"); err != nil {
		t.Fatal(err)
	}
	if _, err := normalizeFontScale("xl"); err == nil {
		t.Fatal("expected unknown font")
	}
	if _, err := normalizeAppearance(""); err == nil {
		t.Fatal("expected appearance error")
	}
}
