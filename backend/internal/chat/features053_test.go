package chat

import (
	"net"
	"strings"
	"testing"
)

func TestNormalizeSearchQuery(t *testing.T) {
	q, ok := normalizeSearchQuery("  Салам   группа ")
	if !ok || q != "Салам группа" {
		t.Fatalf("got %q %v", q, ok)
	}
	if _, ok := normalizeSearchQuery(" а "); ok {
		t.Fatal("expected short query to fail")
	}
	if _, ok := normalizeSearchQuery(strings.Repeat("я", 81)); ok {
		t.Fatal("expected long query to fail")
	}
	q, ok = normalizeSearchQuery("a\tb\n")
	if !ok || q != "a b" {
		t.Fatalf("whitespace: %q %v", q, ok)
	}
}

func TestEscapeLike(t *testing.T) {
	if got := escapeLike(`100%_ok\`); got != `100\%\_ok\\` {
		t.Fatalf("got %q", got)
	}
	if got := likeContains("салам"); got != "%салам%" {
		t.Fatalf("got %q", got)
	}
}

func TestApplyRichMessage(t *testing.T) {
	_, _, st, _ := applyRichMessage("location", "", "", map[string]any{"lat": 55.7, "lng": 200.0})
	if st == 0 {
		t.Fatal("expected lng rejection")
	}
	body, _, st, msg := applyRichMessage("location", "", "", map[string]any{"lat": 55.75, "lng": 37.61, "title": "Парк"})
	if st != 0 || body != "📍 Парк" || msg != "" {
		t.Fatalf("location: %q %d %s", body, st, msg)
	}
	body, _, st, _ = applyRichMessage("location", "встреча", "", map[string]any{"lat": 1.0, "lng": 2.0})
	if st != 0 || body != "встреча" {
		t.Fatalf("keep custom body: %q", body)
	}
	_, _, st, _ = applyRichMessage("contact", "", "", map[string]any{})
	if st == 0 {
		t.Fatal("expected contact rejection")
	}
	body, _, st, _ = applyRichMessage("contact", "", "", map[string]any{"name": "Андрей", "phone": "+7999"})
	if st != 0 || body != "👤 Андрей" {
		t.Fatalf("contact: %q %d", body, st)
	}
	_, media, st, _ := applyRichMessage("sticker", "", "", map[string]any{"url": "https://cdn.example/s.png"})
	if st != 0 || media != "https://cdn.example/s.png" {
		t.Fatalf("sticker: %s %d", media, st)
	}
	_, _, st, _ = applyRichMessage("gif", "", "notaurl", nil)
	if st == 0 {
		t.Fatal("expected gif media rejection")
	}
	if !allowedClientMsgType("location") || !allowedClientMsgType("contact") || allowedClientMsgType("e2e") {
		t.Fatal("msg type allow list")
	}
	if editableMsgType("voice") || !editableMsgType("text") {
		t.Fatal("edit allow list")
	}
}

func TestValidatePreviewURL(t *testing.T) {
	cases := []struct {
		raw string
		ok  bool
	}{
		{"https://example.com/path", true},
		{"http://example.com", true},
		{"https://example.com:443/a", true},
		{"file:///etc/passwd", false},
		{"https://127.0.0.1/", false},
		{"http://169.254.169.254/latest", false},
		{"http://10.0.0.5/", false},
		{"http://192.168.1.1/", false},
		{"http://localhost/admin", false},
		{"https://metadata.google.internal/", false},
		{"https://example.com:22/", false},
		{"https://user:pass@example.com/", false},
		{"javascript:alert(1)", false},
	}
	for _, tc := range cases {
		_, _, err := validatePreviewURL(tc.raw)
		if tc.ok && err != nil {
			t.Errorf("%s: %v", tc.raw, err)
		}
		if !tc.ok && err == nil {
			t.Errorf("%s: expected reject", tc.raw)
		}
	}
}

func TestIsPrivateIP(t *testing.T) {
	private := []string{"127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.8", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1"}
	for _, s := range private {
		if !isPrivateIP(net.ParseIP(s)) {
			t.Errorf("%s should be private", s)
		}
	}
	public := []string{"8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1"}
	for _, s := range public {
		if isPrivateIP(net.ParseIP(s)) {
			t.Errorf("%s should be public", s)
		}
	}
}

func TestOpenGraphFields(t *testing.T) {
	page := `<html><head>
		<meta property="og:site_name" content="Example">
		<meta property="og:title" content="Заголовок &amp; Co">
		<meta name="description" content="plain">
		<meta property="og:description" content="Описание">
		<meta property="og:image" content="/pic.jpg">
		<title>ignored</title>
	</head></html>`
	title, desc, image, site := openGraphFields(page)
	if title != "Заголовок & Co" || desc != "Описание" || image != "/pic.jpg" || site != "Example" {
		t.Fatalf("%q %q %q %q", title, desc, image, site)
	}
	title, _, _, _ = openGraphFields("<title>Только title</title>")
	if title != "Только title" {
		t.Fatalf("title fallback %q", title)
	}
}
