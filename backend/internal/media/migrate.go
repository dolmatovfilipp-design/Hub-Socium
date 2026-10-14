package media

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CopyStats is the result of copying local media into the bucket.
// Local files are never removed.
type CopyStats struct {
	Copied  int
	Skipped int
	Missing int
	Failed  int
	Orphans int
	Voice   int
}

// CopyLocalMedia uploads media rows and leftover files in dir to the bucket,
// then points the row at the object. The file on disk stays.
// voiceDir is the voice-command folder (.data/voice-stt). Empty skips that pass.
// dryRun counts work and does not upload or update rows.
func CopyLocalMedia(ctx context.Context, pool *pgxpool.Pool, dir, voiceDir string, s3 *S3Config, dryRun bool) (CopyStats, error) {
	var stats CopyStats
	if pool == nil {
		return stats, fmt.Errorf("database is not connected")
	}
	if !dryRun && (s3 == nil || !s3.Enabled()) {
		return stats, fmt.Errorf("s3 not configured")
	}
	known := map[string]bool{}
	rows, err := pool.Query(ctx, `
		SELECT id::text, storage_name, content_type
		FROM media
		ORDER BY created_at`)
	if err != nil {
		return stats, err
	}
	defer rows.Close()
	type item struct{ id, name, ct string }
	var pending []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.id, &it.name, &it.ct); err != nil {
			return stats, err
		}
		if strings.HasPrefix(it.name, "s3:") {
			known[filepath.Base(strings.TrimPrefix(it.name, "s3:"))] = true
			stats.Skipped++
			continue
		}
		pending = append(pending, it)
		known[it.name] = true
	}
	if err := rows.Err(); err != nil {
		return stats, err
	}
	for _, it := range pending {
		if !safeLocalName(it.name) {
			stats.Failed++
			continue
		}
		path := filepath.Join(dir, it.name)
		body, err := os.ReadFile(path)
		if err != nil {
			if os.IsNotExist(err) {
				stats.Missing++
				continue
			}
			stats.Failed++
			continue
		}
		key := "media/" + it.name
		if dryRun {
			stats.Copied++
			continue
		}
		ct := it.ct
		if ct == "" {
			ct = "application/octet-stream"
		}
		if _, err := s3.PutObject(key, ct, body); err != nil {
			stats.Failed++
			continue
		}
		tag, err := pool.Exec(ctx, `
			UPDATE media SET storage_name = $2
			WHERE id = $1::uuid AND storage_name = $3`, it.id, "s3:"+key, it.name)
		if err != nil || tag.RowsAffected() == 0 {
			stats.Failed++
			continue
		}
		stats.Copied++
	}

	orphans, err := orphanFiles(dir, known)
	if err != nil {
		return stats, err
	}
	for _, name := range orphans {
		body, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			stats.Failed++
			continue
		}
		if dryRun {
			stats.Orphans++
			continue
		}
		if _, err := s3.PutObject("media/"+name, "application/octet-stream", body); err != nil {
			stats.Failed++
			continue
		}
		stats.Orphans++
	}

	voice, err := copyVoiceCommands(ctx, pool, voiceDir, s3, dryRun)
	if err != nil {
		return stats, err
	}
	stats.Voice = voice
	return stats, nil
}

func copyVoiceCommands(ctx context.Context, pool *pgxpool.Pool, dir string, s3 *S3Config, dryRun bool) (int, error) {
	if dir == "" {
		return 0, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT id::text, user_id::text, storage_key
		FROM voice_command_audio
		WHERE storage_key LIKE 'local:%'`)
	if err != nil {
		if strings.Contains(err.Error(), "voice_command_audio") {
			return 0, nil
		}
		return 0, err
	}
	defer rows.Close()
	type item struct{ id, user, key string }
	var pending []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.id, &it.user, &it.key); err != nil {
			return 0, err
		}
		pending = append(pending, it)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	n := 0
	for _, it := range pending {
		name := strings.TrimPrefix(it.key, "local:")
		if !safeLocalName(name) {
			continue
		}
		body, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			continue
		}
		key := "voice-stt/" + it.user + "/" + it.id + ".wav"
		if dryRun {
			n++
			continue
		}
		if _, err := s3.PutObject(key, "audio/wav", body); err != nil {
			return n, err
		}
		if _, err := pool.Exec(ctx, `
			UPDATE voice_command_audio SET storage_key = $2
			WHERE id = $1::uuid AND storage_key = $3`, it.id, "s3:"+key, it.key); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

func orphanFiles(dir string, known map[string]bool) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var names []string
	for _, ent := range entries {
		if ent.IsDir() {
			continue
		}
		name := ent.Name()
		if !safeLocalName(name) || known[name] {
			continue
		}
		info, err := ent.Info()
		if err != nil || info.Size() == 0 {
			continue
		}
		names = append(names, name)
	}
	return names, nil
}

func safeLocalName(name string) bool {
	return name != "" && name != "." && filepath.Base(name) == name && !strings.Contains(name, "..")
}

// ReadFileLimited reads a local media file. Exported for tests of the copy path.
func ReadFileLimited(path string, max int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(io.LimitReader(f, max))
}
