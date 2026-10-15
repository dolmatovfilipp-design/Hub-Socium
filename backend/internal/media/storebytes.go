package media

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

// StoreBytes saves server-generated media (stickers) and returns /v1/media/{id}.
func (s *Service) StoreBytes(ctx context.Context, userID, contentType, ext string, data []byte) (string, error) {
	if s == nil || s.pool == nil {
		return "", fmt.Errorf("media store unavailable")
	}
	if len(data) == 0 || len(data) > MaxVideoBytes {
		return "", fmt.Errorf("empty or oversized media")
	}
	contentType = strings.TrimSpace(contentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	if ext == "" {
		ext = ".bin"
	}
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	id := uuid.New()
	storageName := id.String() + ext
	path := filepath.Join(s.dir, storageName)
	if s.s3 != nil && s.s3.Enabled() {
		key := "media/" + storageName
		if _, err := s.s3.PutObject(key, contentType, data); err != nil {
			return "", err
		}
		storageName = "s3:" + key
	} else if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", err
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO media (id, user_id, content_type, bytes, storage_name)
		VALUES ($1, $2::uuid, $3, $4, $5)`, id, userID, contentType, len(data), storageName)
	if err != nil {
		if !strings.HasPrefix(storageName, "s3:") {
			_ = os.Remove(path)
		}
		return "", err
	}
	return "/v1/media/" + id.String(), nil
}
