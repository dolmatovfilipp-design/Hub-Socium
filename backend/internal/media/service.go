package media

import (
	"bytes"
	"fmt"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	MaxUploadBytes = 10 << 20 // 10 MiB (voice + images)
	MaxDimension   = 1920
)

var allowedTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
	"image/gif":  ".gif",
	"audio/webm": ".webm",
	"audio/ogg":  ".ogg",
	"audio/mp4":  ".m4a",
	"audio/mpeg": ".mp3",
	"audio/wav":  ".wav",
	"video/webm": ".webm", // MediaRecorder sometimes reports video/webm for audio-only
}

type Service struct {
	pool *pgxpool.Pool
	dir  string
}

func NewService(pool *pgxpool.Pool, dir string) (*Service, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("media dir: %w", err)
	}
	return &Service{pool: pool, dir: dir}, nil
}

func (s *Service) Upload(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, MaxUploadBytes+512*1024)
	if err := r.ParseMultipartForm(MaxUploadBytes + 256*1024); err != nil {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "file too large or invalid multipart (max ~10MB)")
		return
	}

	file, hdr, err := r.FormFile("file")
	if err != nil {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "multipart field \"file\" required")
		return
	}
	defer file.Close()

	raw, err := io.ReadAll(io.LimitReader(file, MaxUploadBytes+1))
	if err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "could not read file")
		return
	}
	if len(raw) == 0 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "empty file")
		return
	}
	if len(raw) > MaxUploadBytes {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "file max 10MB")
		return
	}

	ct := normalizeContentType(hdr.Header.Get("Content-Type"), raw)
	ext, ok := allowedTypes[ct]
	if !ok {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "only jpeg/png/webp/gif or audio webm/ogg/mp4/mpeg/wav allowed")
		return
	}

	var outBytes []byte
	var outCT, outExt string
	if strings.HasPrefix(ct, "audio/") || ct == "video/webm" {
		outBytes, outCT, outExt = raw, ct, ext
	} else {
		outBytes, outCT, outExt, err = processImage(raw, ct, ext)
		if err != nil {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
			return
		}
	}

	id := uuid.New()
	storageName := id.String() + outExt
	path := filepath.Join(s.dir, storageName)
	if err := os.WriteFile(path, outBytes, 0o644); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "failed to store file")
		return
	}

	var created time.Time
	err = s.pool.QueryRow(r.Context(), `
		INSERT INTO media (id, user_id, content_type, bytes, storage_name)
		VALUES ($1, $2::uuid, $3, $4, $5)
		RETURNING created_at`, id, uid, outCT, len(outBytes), storageName).Scan(&created)
	if err != nil {
		_ = os.Remove(path)
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	apiutil.JSON(w, http.StatusCreated, map[string]any{
		"id":           id.String(),
		"url":          "/v1/media/" + id.String(),
		"content_type": outCT,
		"bytes":        len(outBytes),
		"created_at":   created.UTC().Format(time.RFC3339Nano),
	})
}

func (s *Service) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, err := uuid.Parse(id); err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "media not found")
		return
	}

	var storageName, contentType string
	err := s.pool.QueryRow(r.Context(), `
		SELECT storage_name, content_type FROM media WHERE id = $1`, id).
		Scan(&storageName, &contentType)
	if err != nil {
		if err == pgx.ErrNoRows {
			apiutil.Error(w, http.StatusNotFound, "not_found", "media not found")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	path := filepath.Join(s.dir, storageName)
	// Prevent path traversal — storage_name is UUID+ext from us.
	if filepath.Base(storageName) != storageName {
		apiutil.Error(w, http.StatusNotFound, "not_found", "media not found")
		return
	}
	f, err := os.Open(path)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "media file missing")
		return
	}
	defer f.Close()

	st, err := f.Stat()
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "stat failed")
		return
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", st.Size()))
	http.ServeContent(w, r, storageName, st.ModTime(), f)
}

func normalizeContentType(headerCT string, raw []byte) string {
	ct := strings.ToLower(strings.TrimSpace(strings.Split(headerCT, ";")[0]))
	if _, ok := allowedTypes[ct]; ok {
		return ct
	}
	detected := http.DetectContentType(raw)
	detected = strings.ToLower(strings.TrimSpace(strings.Split(detected, ";")[0]))
	if detected == "image/jpeg" || detected == "image/png" || detected == "image/gif" || detected == "image/webp" {
		return detected
	}
	// WebP: DetectContentType may miss some; sniff RIFF....WEBP
	if len(raw) >= 12 && string(raw[0:4]) == "RIFF" && string(raw[8:12]) == "WEBP" {
		return "image/webp"
	}
	if strings.HasPrefix(detected, "audio/") || detected == "video/webm" {
		if _, ok := allowedTypes[detected]; ok {
			return detected
		}
	}
	// Ogg / WebM audio sniff
	if len(raw) >= 4 && string(raw[0:4]) == "OggS" {
		return "audio/ogg"
	}
	if len(raw) >= 12 && string(raw[0:4]) == "RIFF" && string(raw[8:12]) == "WEBP" {
		return "image/webp"
	}
	if len(raw) >= 4 && raw[0] == 0x1A && raw[1] == 0x45 && raw[2] == 0xDF && raw[3] == 0xA3 {
		return "audio/webm"
	}
	return detected
}

func processImage(raw []byte, ct, ext string) ([]byte, string, string, error) {
	// webp: keep as-is (stdlib has no encoder); still enforce size
	if ct == "image/webp" {
		return raw, ct, ext, nil
	}

	img, format, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, "", "", fmt.Errorf("invalid image data")
	}
	_ = format

	img = resizeIfNeeded(img, MaxDimension)

	var buf bytes.Buffer
	switch ct {
	case "image/jpeg":
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
			return nil, "", "", fmt.Errorf("jpeg encode failed")
		}
		return buf.Bytes(), "image/jpeg", ".jpg", nil
	case "image/png":
		if err := png.Encode(&buf, img); err != nil {
			return nil, "", "", fmt.Errorf("png encode failed")
		}
		return buf.Bytes(), "image/png", ".png", nil
	case "image/gif":
		// Re-encode single frame; animated gifs may lose frames — acceptable for demo.
		if err := gif.Encode(&buf, img, nil); err != nil {
			return nil, "", "", fmt.Errorf("gif encode failed")
		}
		return buf.Bytes(), "image/gif", ".gif", nil
	default:
		return raw, ct, ext, nil
	}
}

func resizeIfNeeded(img image.Image, maxDim int) image.Image {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= maxDim && h <= maxDim {
		return img
	}
	scale := float64(maxDim) / float64(w)
	if h > w {
		scale = float64(maxDim) / float64(h)
	}
	nw := int(float64(w) * scale)
	nh := int(float64(h) * scale)
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	for y := 0; y < nh; y++ {
		sy := b.Min.Y + y*h/nh
		for x := 0; x < nw; x++ {
			sx := b.Min.X + x*w/nw
			dst.Set(x, y, img.At(sx, sy))
		}
	}
	return dst
}
