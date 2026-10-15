package media

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func startPutServer(t *testing.T, on func(path, contentType string, body []byte)) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("method %s", r.Method)
		}
		b, _ := io.ReadAll(r.Body)
		on(r.URL.Path, r.Header.Get("Content-Type"), b)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func TestAccessURLPublicOrSigned(t *testing.T) {
	pub := &S3Config{
		Endpoint: "https://s3.ru-1.storage.selcloud.ru", Region: "ru-1",
		Bucket: "hub-media", AccessKey: "key", SecretKey: "secret",
		PublicBase: "https://cdn.gethub.online",
	}
	got, err := pub.AccessURL("media/photo.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://cdn.gethub.online/media/photo.jpg" {
		t.Fatal(got)
	}

	priv := *pub
	priv.PublicBase = ""
	signed, err := priv.AccessURL("media/voice.webm")
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(signed)
	if err != nil {
		t.Fatal(err)
	}
	if u.Host != "s3.ru-1.storage.selcloud.ru" || u.Path != "/hub-media/media/voice.webm" {
		t.Fatal(u.String())
	}
	q := u.Query()
	if q.Get("X-Amz-Signature") == "" || q.Get("X-Amz-Expires") == "" {
		t.Fatal(q.Encode())
	}
	if !strings.Contains(q.Get("X-Amz-Credential"), "/ru-1/s3/aws4_request") {
		t.Fatal(q.Get("X-Amz-Credential"))
	}
}

func TestCopyKeepsLocalFile(t *testing.T) {
	dir := t.TempDir()
	name := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png"
	body := []byte("png-bytes")
	if err := os.WriteFile(filepath.Join(dir, name), body, 0o644); err != nil {
		t.Fatal(err)
	}
	var gotPath, gotType string
	var gotBody []byte
	srv := startPutServer(t, func(path, ct string, b []byte) {
		gotPath, gotType, gotBody = path, ct, append([]byte(nil), b...)
	})
	cfg := &S3Config{
		Endpoint: srv, Region: "ru-1", Bucket: "hub-media",
		AccessKey: "key", SecretKey: "secret",
	}
	if _, err := cfg.PutObject("media/"+name, "image/png", body); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/hub-media/media/"+name || gotType != "image/png" || string(gotBody) != string(body) {
		t.Fatalf("path=%s type=%s body=%q", gotPath, gotType, gotBody)
	}
	left, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil || string(left) != string(body) {
		t.Fatal("local file was removed or changed")
	}
}

func TestMissingEnv(t *testing.T) {
	t.Setenv("S3_ENDPOINT", "")
	t.Setenv("S3_BUCKET", "")
	t.Setenv("S3_ACCESS_KEY", "")
	t.Setenv("S3_SECRET_KEY", "")
	missing := MissingEnv()
	if len(missing) != 4 {
		t.Fatal(missing)
	}
	t.Setenv("S3_ENDPOINT", "https://s3.ru-1.storage.selcloud.ru")
	t.Setenv("S3_BUCKET", "hub")
	t.Setenv("S3_ACCESS_KEY", "a")
	t.Setenv("S3_SECRET_KEY", "b")
	if len(MissingEnv()) != 0 || S3FromEnv() == nil {
		t.Fatal("configured env should enable s3")
	}
	if S3FromEnv().Region != "ru-central1" {
		t.Fatal("region default stays ru-central1 until S3_REGION is set")
	}
}
