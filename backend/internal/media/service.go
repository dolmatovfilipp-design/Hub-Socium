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
	MaxVideoBytes  = 40 << 20 // 40 MiB (clips / video notes)
	MaxDimension   = 1920
)

var allowedTypes = map[string]string{
	"image/jpeg":      ".jpg",
	"image/png":       ".png",
	"image/webp":      ".webp",
	"image/gif":       ".gif",
	"audio/webm":      ".webm",
	"audio/ogg":       ".ogg",
	"audio/mp4":       ".m4a",
	"audio/mpeg":      ".mp3",
	"audio/wav":       ".wav",
	"video/webm":      ".webm", // MediaRecorder sometimes reports video/webm for audio-only
	"video/mp4":       ".mp4",
	"video/quicktime": ".mov",
	// Documents / files in chat
	"application/pdf":  ".pdf",
	"application/zip":  ".zip",
	"application/x-zip-compressed": ".zip",
	"application/msword": ".doc",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
	"application/vnd.ms-excel": ".xls",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
	"application/vnd.ms-powerpoint": ".ppt",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
	"application/rtf":  ".rtf",
	"text/plain":       ".txt",
	"text/csv":         ".csv",
	"application/json": ".json",
}

var docExtFallback = map[string]string{
	".pdf":  "application/pdf",
	".zip":  "application/zip",
	".doc":  "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xls":  "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".ppt":  "application/vnd.ms-powerpoint",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".rtf":  "application/rtf",
	".txt":  "text/plain",
	".csv":  "text/csv",
	".json": "application/json",
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

	r.Body = http.MaxBytesReader(w, r.Body, MaxVideoBytes+512*1024)
	if err := r.ParseMultipartForm(MaxVideoBytes + 256*1024); err != nil {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "file too large or invalid multipart (max ~40MB for video)")
		return
	}

	file, hdr, err := r.FormFile("file")
	if err != nil {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "multipart field \"file\" required")
		return
	}
	defer file.Close()

	raw, err := io.ReadAll(io.LimitReader(file, MaxVideoBytes+1))
	if err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "could not read file")
		return
	}
	if len(raw) == 0 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "empty file")
		return
	}

	ct := normalizeContentType(hdr.Header.Get("Content-Type"), raw)
	if _, known := allowedTypes[ct]; !known {
		if alt := sniffDocType(raw, hdr.Filename); alt != "" {
			ct = alt
		}
	}
	ext, ok := allowedTypes[ct]
	if !ok {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "unsupported type: images, audio, video, pdf/zip/docs")
		return
	}
	isVideo := ct == "video/mp4" || ct == "video/quicktime" || (ct == "video/webm" && len(raw) > MaxUploadBytes)
	maxAllowed := MaxUploadBytes
	if ct == "video/mp4" || ct == "video/quicktime" {
		maxAllowed = MaxVideoBytes
	}
	if len(raw) > maxAllowed {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "file too large for type")
		return
	}

	var outBytes []byte
	var outCT, outExt string
	isDoc := strings.HasPrefix(ct, "application/") || strings.HasPrefix(ct, "text/")
	if strings.HasPrefix(ct, "audio/") || strings.HasPrefix(ct, "video/") || isDoc {
		_ = isVideo
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

	origName := filepath.Base(strings.TrimSpace(hdr.Filename))
	if origName == "." || origName == "/" || origName == "" {
		origName = id.String() + outExt
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

	out := map[string]any{
		"id":           id.String(),
		"url":          "/v1/media/" + id.String(),
		"content_type": outCT,
		"bytes":        len(outBytes),
		"created_at":   created.UTC().Format(time.RFC3339Nano),
	}
	if isDoc {
		out["filename"] = origName
	}
	apiutil.JSON(w, http.StatusCreated, out)
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
	if strings.HasPrefix(contentType, "application/") || strings.HasPrefix(contentType, "text/") {
		name := filepath.Base(storageName)
		w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, name))
	}
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
	// ISO BMFF / MP4
	if len(raw) >= 12 && string(raw[4:8]) == "ftyp" {
		return "video/mp4"
	}
	if detected == "video/mp4" || detected == "application/octet-stream" {
		if len(raw) >= 12 && string(raw[4:8]) == "ftyp" {
			return "video/mp4"
		}
	}
	if len(raw) >= 4 && string(raw[0:4]) == "%PDF" {
		return "application/pdf"
	}
	if len(raw) >= 2 && raw[0] == 0x50 && raw[1] == 0x4B {
		if _, ok := allowedTypes["application/zip"]; ok {
			return "application/zip"
		}
	}
	if _, ok := allowedTypes[detected]; ok {
		return detected
	}
	return detected
}

func sniffDocType(raw []byte, filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	if ct, ok := docExtFallback[ext]; ok {
		return ct
	}
	if len(raw) >= 4 && string(raw[0:4]) == "%PDF" {
		return "application/pdf"
	}
	if len(raw) >= 2 && raw[0] == 0x50 && raw[1] == 0x4B {
		// ZIP / OOXML
		if ext == ".docx" || ext == ".xlsx" || ext == ".pptx" {
			if ct, ok := docExtFallback[ext]; ok {
				return ct
			}
		}
		return "application/zip"
	}
	return ""
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
