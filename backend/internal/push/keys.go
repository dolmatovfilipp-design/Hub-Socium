package push

import (
	"fmt"
	"os"
	"strings"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// EnsureKeys returns a VAPID key pair. Existing env values win. Otherwise the
// pair is read from envFile, or generated and written there as
// VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY so the next process start picks them up.
// generated is true only when a new pair was created.
func EnsureKeys(publicKey, privateKey, envFile string) (string, string, bool, error) {
	publicKey = strings.TrimSpace(publicKey)
	privateKey = strings.TrimSpace(privateKey)
	if publicKey != "" && privateKey != "" {
		return publicKey, privateKey, false, nil
	}
	if pub, priv, ok := readEnvFileKeys(envFile); ok {
		_ = os.Setenv("VAPID_PUBLIC_KEY", pub)
		_ = os.Setenv("VAPID_PRIVATE_KEY", priv)
		return pub, priv, false, nil
	}
	priv, pub, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		return "", "", false, fmt.Errorf("generate vapid: %w", err)
	}
	pub = strings.TrimSpace(pub)
	priv = strings.TrimSpace(priv)
	if pub == "" || priv == "" {
		return "", "", false, fmt.Errorf("generate vapid: empty key")
	}
	if err := upsertEnvFile(envFile, pub, priv); err != nil {
		return "", "", false, err
	}
	_ = os.Setenv("VAPID_PUBLIC_KEY", pub)
	_ = os.Setenv("VAPID_PRIVATE_KEY", priv)
	return pub, priv, true, nil
}

func readEnvFileKeys(path string) (string, string, bool) {
	if strings.TrimSpace(path) == "" {
		return "", "", false
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", "", false
	}
	var pub, priv string
	for _, line := range strings.Split(string(data), "\n") {
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "#") {
			continue
		}
		k, v, ok := strings.Cut(trim, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.Trim(strings.TrimSpace(v), `"'`)
		switch k {
		case "VAPID_PUBLIC_KEY":
			pub = v
		case "VAPID_PRIVATE_KEY":
			priv = v
		}
	}
	if pub == "" || priv == "" {
		return "", "", false
	}
	return pub, priv, true
}

func upsertEnvFile(path, publicKey, privateKey string) error {
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("vapid env file path is empty")
	}
	data, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("read vapid env: %w", err)
	}
	lines := []string{}
	if len(data) > 0 {
		lines = strings.Split(strings.TrimRight(string(data), "\n"), "\n")
	}
	set := map[string]string{
		"VAPID_PUBLIC_KEY":  publicKey,
		"VAPID_PRIVATE_KEY": privateKey,
	}
	seen := map[string]bool{}
	for i, line := range lines {
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "#") {
			continue
		}
		k, _, ok := strings.Cut(trim, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		if v, want := set[k]; want {
			lines[i] = k + "=" + v
			seen[k] = true
		}
	}
	for _, k := range []string{"VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"} {
		if seen[k] {
			continue
		}
		lines = append(lines, k+"="+set[k])
	}
	body := strings.Join(lines, "\n")
	if !strings.HasSuffix(body, "\n") {
		body += "\n"
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		return fmt.Errorf("write vapid env: %w", err)
	}
	return nil
}
