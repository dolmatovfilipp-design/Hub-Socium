package push

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureKeysGeneratesOnce(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	if err := os.WriteFile(path, []byte("HTTP_ADDR=:8080\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	pub, priv, generated, err := EnsureKeys("", "", path)
	if err != nil {
		t.Fatal(err)
	}
	if !generated || pub == "" || priv == "" || pub == priv {
		t.Fatalf("generated=%v pub=%q priv set=%v", generated, pub, priv != "")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if !strings.Contains(text, "HTTP_ADDR=:8080") || !strings.Contains(text, "VAPID_PUBLIC_KEY="+pub) || !strings.Contains(text, "VAPID_PRIVATE_KEY="+priv) {
		t.Fatalf("env file lost existing lines or keys:\n%s", text)
	}
	pub2, priv2, generated2, err := EnsureKeys("", "", path)
	if err != nil {
		t.Fatal(err)
	}
	if generated2 || pub2 != pub || priv2 != priv {
		t.Fatal("second start must reuse the stored pair")
	}
	pub3, priv3, generated3, err := EnsureKeys("env-pub", "env-priv", path)
	if err != nil {
		t.Fatal(err)
	}
	if generated3 || pub3 != "env-pub" || priv3 != "env-priv" {
		t.Fatal("explicit env keys must win")
	}
}
