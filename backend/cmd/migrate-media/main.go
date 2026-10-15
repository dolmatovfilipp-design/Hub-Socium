// Command migrate-media copies local photos, video, voice, circles, and
// avatars into the Selectel bucket. Files on disk are left in place.
//
//	DATABASE_URL=postgres://... \
//	S3_ENDPOINT=https://s3.ru-1.storage.selcloud.ru S3_REGION=ru-1 \
//	S3_BUCKET=... S3_ACCESS_KEY=... S3_SECRET_KEY=... \
//	go run ./cmd/migrate-media
//
// -dry-run lists what would be copied and does not upload.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/hub-socium/hub/backend/internal/db"
	"github.com/hub-socium/hub/backend/internal/media"
	"github.com/joho/godotenv"
)

func main() {
	dry := flag.Bool("dry-run", false, "count local files and do not upload")
	flag.Parse()
	_ = godotenv.Load()
	_ = godotenv.Load(filepath.Join("backend", ".env"))

	s3 := media.S3FromEnv()
	if !*dry && (s3 == nil || !s3.Enabled()) {
		fmt.Fprintln(os.Stderr, "Selectel is not configured. New uploads stay on local disk.")
		fmt.Fprintln(os.Stderr, "Required:", strings.Join(media.RequiredEnv(), ", "))
		fmt.Fprintln(os.Stderr, "Selectel also needs S3_REGION (ru-1, ru-2, ru-3, or ru-7). The code default is ru-central1, which is Yandex.")
		fmt.Fprintln(os.Stderr, "Optional: S3_PUBLIC_BASE — public bucket or CDN origin. Without it, downloads use a presigned URL.")
		if missing := media.MissingEnv(); len(missing) > 0 {
			fmt.Fprintln(os.Stderr, "Missing now:", strings.Join(missing, ", "))
		}
		os.Exit(1)
	}
	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dbURL == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL is required so existing media rows can be updated.")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	pool, err := db.Connect(ctx, dbURL)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	dir := strings.TrimSpace(os.Getenv("MEDIA_DIR"))
	if dir == "" {
		dir = ".data/media"
	}
	voiceDir := filepath.Join(".data", "voice-stt")
	stats, err := media.CopyLocalMedia(ctx, pool, dir, voiceDir, s3, *dry)
	if err != nil {
		log.Fatal(err)
	}
	mode := "copied"
	if *dry {
		mode = "would copy"
	}
	fmt.Printf("%s %d media objects, %d files not in the database, %d voice-command clips\n", mode, stats.Copied, stats.Orphans, stats.Voice)
	fmt.Printf("missing on disk: %d, failed: %d\n", stats.Missing, stats.Failed)
	fmt.Println("local files were not deleted")
	if stats.Failed > 0 {
		os.Exit(1)
	}
}
