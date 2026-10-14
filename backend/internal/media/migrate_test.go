package media

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCopyLocalMediaKeepsDiskAndPointsAtBucket(t *testing.T) {
	dsn := os.Getenv("HUB_TEST_DSN")
	if dsn == "" {
		dsn = "postgres://hub:hub@127.0.0.1:54329/hub?sslmode=disable"
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skip(err.Error())
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Skip(err.Error())
	}

	dir := t.TempDir()
	voiceDir := t.TempDir()
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	var userID string
	err = pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, email)
		VALUES ($1, 'x', 'Медиа', $2) RETURNING id::text`,
		"media_"+suffix, "media_"+suffix+"@example.com").Scan(&userID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1::uuid`, userID)
	})

	name := uuid.NewString() + ".wav"
	body := []byte("RIFFvoice")
	if err := os.WriteFile(filepath.Join(dir, name), body, 0o644); err != nil {
		t.Fatal(err)
	}
	orphan := "orphan-circle.webm"
	if err := os.WriteFile(filepath.Join(dir, orphan), []byte("webm"), 0o644); err != nil {
		t.Fatal(err)
	}
	var mediaID string
	err = pool.QueryRow(ctx, `
		INSERT INTO media (user_id, content_type, bytes, storage_name)
		VALUES ($1::uuid, 'audio/wav', $2, $3) RETURNING id::text`,
		userID, len(body), name).Scan(&mediaID)
	if err != nil {
		t.Fatal(err)
	}
	voiceName := uuid.NewString() + ".wav"
	if err := os.WriteFile(filepath.Join(voiceDir, voiceName), []byte("RIFF"), 0o644); err != nil {
		t.Fatal(err)
	}
	voiceID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO voice_command_audio (id, user_id, storage_key, bytes, expires_at)
		VALUES ($1::uuid, $2::uuid, $3, 4, now() + interval '1 hour')`,
		voiceID, userID, "local:"+voiceName); err != nil {
		t.Fatal(err)
	}

	puts := 0
	srv := startPutServer(t, func(string, string, []byte) { puts++ })
	cfg := &S3Config{Endpoint: srv, Region: "ru-1", Bucket: "hub-media", AccessKey: "key", SecretKey: "secret"}

	dry, err := CopyLocalMedia(ctx, pool, dir, voiceDir, cfg, true)
	if err != nil {
		t.Fatal(err)
	}
	if dry.Copied != 1 || dry.Orphans != 1 || dry.Voice != 1 || puts != 0 {
		t.Fatalf("dry %#v puts %d", dry, puts)
	}

	stats, err := CopyLocalMedia(ctx, pool, dir, voiceDir, cfg, false)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Copied != 1 || stats.Orphans != 1 || stats.Voice != 1 || stats.Failed != 0 {
		t.Fatalf("stats %#v", stats)
	}
	if puts != 3 {
		t.Fatalf("puts %d", puts)
	}
	left, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil || string(left) != string(body) {
		t.Fatal("local media file was deleted")
	}
	if _, err := os.Stat(filepath.Join(voiceDir, voiceName)); err != nil {
		t.Fatal("local voice clip was deleted")
	}
	var storage, voiceKey string
	if err := pool.QueryRow(ctx, `SELECT storage_name FROM media WHERE id=$1::uuid`, mediaID).Scan(&storage); err != nil {
		t.Fatal(err)
	}
	if storage != "s3:media/"+name {
		t.Fatal(storage)
	}
	if err := pool.QueryRow(ctx, `SELECT storage_key FROM voice_command_audio WHERE id=$1::uuid`, voiceID).Scan(&voiceKey); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(voiceKey, "s3:voice-stt/") {
		t.Fatal(voiceKey)
	}

	again, err := CopyLocalMedia(ctx, pool, dir, voiceDir, cfg, false)
	if err != nil {
		t.Fatal(err)
	}
	if again.Copied != 0 || again.Voice != 0 {
		t.Fatalf("second run should skip rows already in the bucket: %#v", again)
	}
}
