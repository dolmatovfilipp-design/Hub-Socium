package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/media"
	"github.com/jackc/pgx/v5"
)

const transcriptMaxAudio = 40 << 20

// SpeechConfig wires the self-hosted Whisper service and translators.
type SpeechConfig struct {
	STTURL        string
	STTLanguage   string
	STTModel      string
	MediaDir      string
	TranslateURL  string
	TranslateKey  string
	OpenAIKey     string
	OpenAIBase    string
	YandexKey     string
	YandexFolder  string
	AllowFallback bool
	HTTP          *http.Client
}

// ConfigureSpeech stores optional STT / translation settings.
func (s *Service) ConfigureSpeech(c SpeechConfig) {
	if s == nil {
		return
	}
	c.STTURL = strings.TrimRight(strings.TrimSpace(c.STTURL), "/")
	c.TranslateURL = strings.TrimRight(strings.TrimSpace(c.TranslateURL), "/")
	c.STTLanguage = strings.TrimSpace(c.STTLanguage)
	if c.STTLanguage == "" {
		c.STTLanguage = "ru"
	}
	c.STTModel = strings.TrimSpace(c.STTModel)
	c.MediaDir = strings.TrimSpace(c.MediaDir)
	if c.MediaDir == "" {
		c.MediaDir = ".data/media"
	}
	c.OpenAIBase = strings.TrimRight(strings.TrimSpace(c.OpenAIBase), "/")
	if c.OpenAIBase == "" {
		c.OpenAIBase = "https://api.openai.com/v1"
	}
	s.speech = c
}

// Features reports whether voice transcription and translation are available.
func (s *Service) Features(w http.ResponseWriter, r *http.Request) {
	if _, ok := apiutil.UserIDFromContext(r.Context()); !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"transcribe": s != nil && s.speech.STTURL != "",
		"translate":  s != nil && s.speech.translator() != trNone,
	})
}

// RequestTranscript enqueues a voice / video-note message for Whisper.
func (s *Service) RequestTranscript(w http.ResponseWriter, r *http.Request) {
	uid, convID, msgID, ok := s.memberMessage(w, r)
	if !ok {
		return
	}
	if s.speech.STTURL == "" {
		apiutil.Error(w, http.StatusServiceUnavailable, "unavailable", "Сервис расшифровки не настроен")
		return
	}
	var ignore struct{}
	if err := apiutil.DecodeJSON(r, &ignore); err != nil && !errors.Is(err, io.EOF) {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	_, _, msgType, err := s.loadMessage(r.Context(), convID, msgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apiutil.Error(w, http.StatusNotFound, "not_found", "message not found")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось прочитать сообщение")
		return
	}
	if msgType != "voice" && msgType != "video_note" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Расшифровка доступна для голосовых сообщений")
		return
	}
	var status, text, errText string
	err = s.pool.QueryRow(r.Context(), `
		INSERT INTO message_transcripts (message_id, status, requested_by)
		VALUES ($1::uuid, 'pending', $2::uuid)
		ON CONFLICT (message_id) DO UPDATE SET
		  status = CASE
		    WHEN message_transcripts.status IN ('done', 'processing') THEN message_transcripts.status
		    ELSE 'pending'
		  END,
		  error = CASE
		    WHEN message_transcripts.status IN ('done', 'processing') THEN message_transcripts.error
		    ELSE ''
		  END,
		  requested_by = COALESCE(message_transcripts.requested_by, EXCLUDED.requested_by),
		  updated_at = CASE
		    WHEN message_transcripts.status IN ('done', 'processing') THEN message_transcripts.updated_at
		    ELSE now()
		  END
		RETURNING status, text, error`, msgID, uid).Scan(&status, &text, &errText)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось поставить в очередь")
		return
	}
	apiutil.JSON(w, http.StatusOK, transcriptView(msgID, status, text, errText))
}

// GetTranscript returns the queued or finished transcript for a message.
func (s *Service) GetTranscript(w http.ResponseWriter, r *http.Request) {
	_, convID, msgID, ok := s.memberMessage(w, r)
	if !ok {
		return
	}
	if _, _, _, err := s.loadMessage(r.Context(), convID, msgID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apiutil.Error(w, http.StatusNotFound, "not_found", "message not found")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось прочитать сообщение")
		return
	}
	var status, text, errText string
	err := s.pool.QueryRow(r.Context(), `
		SELECT status, text, error FROM message_transcripts WHERE message_id=$1::uuid`, msgID).
		Scan(&status, &text, &errText)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apiutil.JSON(w, http.StatusOK, transcriptView(msgID, "none", "", ""))
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось прочитать расшифровку")
		return
	}
	apiutil.JSON(w, http.StatusOK, transcriptView(msgID, status, text, errText))
}

func (s *Service) attachTranscripts(ctx context.Context, items []map[string]any) {
	if s == nil || s.pool == nil || len(items) == 0 {
		return
	}
	ids := make([]string, 0, len(items))
	for _, it := range items {
		id, _ := it["id"].(string)
		if id != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return
	}
	rows, err := s.pool.Query(ctx, `
		SELECT message_id::text, status, text, error
		FROM message_transcripts
		WHERE message_id::text = ANY($1::text[])`, ids)
	if err != nil {
		return
	}
	defer rows.Close()
	byID := map[string]map[string]any{}
	for rows.Next() {
		var id, status, text, errText string
		if rows.Scan(&id, &status, &text, &errText) != nil {
			continue
		}
		byID[id] = transcriptView(id, status, text, errText)
	}
	for _, it := range items {
		id, _ := it["id"].(string)
		if tr, ok := byID[id]; ok {
			it["transcript"] = tr
		}
	}
}

// StartTranscriptWorker drains pending message_transcripts via the stt service.
func (s *Service) StartTranscriptWorker(ctx context.Context) {
	if s == nil || s.pool == nil {
		return
	}
	go func() {
		t := time.NewTicker(2 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.reapStuckTranscripts(ctx)
				s.processOneTranscript(ctx)
			}
		}
	}()
}

func (s *Service) reapStuckTranscripts(ctx context.Context) {
	_, err := s.pool.Exec(ctx, `
		UPDATE message_transcripts
		SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
		    error = CASE WHEN attempts >= 3 THEN 'Не удалось расшифровать' ELSE error END,
		    updated_at = now()
		WHERE status = 'processing' AND updated_at < now() - interval '3 minutes'`)
	if err != nil && ctx.Err() == nil {
		slog.Warn("transcript reap", "err", err)
	}
}

func (s *Service) processOneTranscript(ctx context.Context) {
	if s.speech.STTURL == "" {
		_, _ = s.pool.Exec(ctx, `
			UPDATE message_transcripts
			SET status='failed', error='Сервис расшифровки не настроен', updated_at=now()
			WHERE status='pending'`)
		return
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return
	}
	var msgID string
	var attempts int
	err = tx.QueryRow(ctx, `
		UPDATE message_transcripts
		SET status='processing', attempts=message_transcripts.attempts+1, error='', updated_at=now()
		WHERE message_id = (
			SELECT message_id FROM message_transcripts
			WHERE status='pending'
			ORDER BY created_at
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		RETURNING message_id::text, attempts`).Scan(&msgID, &attempts)
	if err != nil {
		_ = tx.Rollback(ctx)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		return
	}

	var convID, mediaURL, msgType string
	err = s.pool.QueryRow(ctx, `
		SELECT conversation_id::text, COALESCE(media_url,''), COALESCE(msg_type,'text')
		FROM messages
		WHERE id=$1::uuid AND deleted_at IS NULL`, msgID).Scan(&convID, &mediaURL, &msgType)
	if err != nil {
		s.finishTranscript(ctx, convID, msgID, "failed", "", "", "Сообщение удалено", 0)
		return
	}
	if msgType != "voice" && msgType != "video_note" {
		s.finishTranscript(ctx, convID, msgID, "failed", "", "", "Расшифровка доступна для голосовых сообщений", 0)
		return
	}

	started := time.Now()
	text, callErr := s.transcribeMedia(ctx, mediaURL)
	dur := int(time.Since(started).Milliseconds())
	if dur < 0 {
		dur = 0
	}
	if callErr != nil {
		public := "Не удалось расшифровать"
		retry := false
		var tf *transcriptFail
		if errors.As(callErr, &tf) {
			if tf.public != "" {
				public = tf.public
			}
			retry = tf.retry
		}
		slog.Warn("transcript", "message_id", msgID, "err", callErr, "attempt", attempts)
		status := "failed"
		if retry && attempts < 3 {
			status = "pending"
		}
		s.finishTranscript(ctx, convID, msgID, status, "", "", public, dur)
		return
	}
	s.finishTranscript(ctx, convID, msgID, "done", text, "whisper", "", dur)
}

func (s *Service) finishTranscript(ctx context.Context, convID, msgID, status, text, provider, errText string, durationMs int) {
	_, err := s.pool.Exec(ctx, `
		UPDATE message_transcripts SET
		  status=$2,
		  text=CASE WHEN $2='done' THEN $3 ELSE text END,
		  provider=CASE WHEN $4<>'' THEN $4 ELSE provider END,
		  error=CASE WHEN $2='done' THEN '' ELSE $5 END,
		  duration_ms=CASE WHEN $6>0 THEN $6 ELSE duration_ms END,
		  updated_at=now()
		WHERE message_id=$1::uuid`, msgID, status, text, provider, errText, durationMs)
	if err != nil {
		slog.Warn("transcript save", "err", err)
		return
	}
	if convID == "" {
		_ = s.pool.QueryRow(ctx, `SELECT conversation_id::text FROM messages WHERE id=$1::uuid`, msgID).Scan(&convID)
	}
	if convID == "" {
		return
	}
	var storedText, storedErr string
	_ = s.pool.QueryRow(ctx, `SELECT text, error FROM message_transcripts WHERE message_id=$1::uuid`, msgID).
		Scan(&storedText, &storedErr)
	s.BroadcastEvent(convID, map[string]any{
		"type":            "transcript",
		"conversation_id": convID,
		"transcript":      transcriptView(msgID, status, storedText, storedErr),
	})
}

func (s *Service) transcribeMedia(ctx context.Context, mediaURL string) (string, error) {
	audio, filename, contentType, err := s.loadMessageAudio(ctx, mediaURL)
	if err != nil {
		return "", &transcriptFail{public: "Не удалось прочитать аудио", retry: false}
	}
	if len(audio) == 0 {
		return "", &transcriptFail{public: "Не удалось прочитать аудио", retry: false}
	}
	text, err := s.callWhisper(ctx, audio, filename, contentType)
	if err != nil {
		return "", err
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return "", &transcriptFail{public: "Не удалось распознать речь", retry: false}
	}
	return text, nil
}

func (s *Service) callWhisper(ctx context.Context, audio []byte, filename, contentType string) (string, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, err := mw.CreateFormFile("file", filename)
	if err != nil {
		return "", &transcriptFail{public: "Не удалось расшифровать", retry: false}
	}
	if _, err := part.Write(audio); err != nil {
		return "", &transcriptFail{public: "Не удалось расшифровать", retry: false}
	}
	_ = mw.WriteField("language", s.speech.STTLanguage)
	_ = mw.WriteField("response_format", "json")
	_ = mw.WriteField("task", "transcribe")
	if s.speech.STTModel != "" {
		_ = mw.WriteField("model", s.speech.STTModel)
	}
	if err := mw.Close(); err != nil {
		return "", &transcriptFail{public: "Не удалось расшифровать", retry: false}
	}
	_ = contentType
	reqCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, sttEndpoint(s.speech.STTURL), &buf)
	if err != nil {
		return "", &transcriptFail{public: "Сервис расшифровки недоступен", retry: true}
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := s.httpClient().Do(req)
	if err != nil {
		return "", &transcriptFail{public: "Сервис расшифровки недоступен", retry: true}
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	text, perr := parseWhisperBody(res.StatusCode, body)
	if perr != nil {
		retry := res.StatusCode >= 500 || res.StatusCode == 0
		public := "Не удалось расшифровать"
		if retry {
			public = "Сервис расшифровки недоступен"
		}
		return "", &transcriptFail{public: public, retry: retry}
	}
	return text, nil
}

func (s *Service) loadMessageAudio(ctx context.Context, mediaURL string) ([]byte, string, string, error) {
	mediaURL = strings.TrimSpace(mediaURL)
	if mediaURL == "" {
		return nil, "", "", fmt.Errorf("empty media")
	}
	if strings.HasPrefix(mediaURL, "http://") || strings.HasPrefix(mediaURL, "https://") {
		return s.httpGetAudio(ctx, mediaURL)
	}
	id := mediaURL
	if strings.HasPrefix(mediaURL, "/v1/media/") {
		id = strings.TrimPrefix(mediaURL, "/v1/media/")
	}
	id = strings.Trim(strings.SplitN(id, "?", 2)[0], "/")
	if _, err := uuid.Parse(id); err != nil {
		return nil, "", "", fmt.Errorf("bad media id")
	}
	var storage, ct string
	err := s.pool.QueryRow(ctx, `SELECT storage_name, content_type FROM media WHERE id=$1::uuid`, id).Scan(&storage, &ct)
	if err != nil {
		return nil, "", "", err
	}
	filename := "audio" + extFromContentType(ct)
	if strings.HasPrefix(storage, "s3:") {
		u, uerr := s3ObjectURL(storage)
		if uerr != nil {
			return nil, "", "", uerr
		}
		b, name, gotCT, gerr := s.httpGetAudio(ctx, u)
		if name == "" {
			name = filename
		}
		if gotCT == "" {
			gotCT = ct
		}
		return b, name, gotCT, gerr
	}
	if storage == "" || filepath.Base(storage) != storage || strings.Contains(storage, "..") {
		return nil, "", "", fmt.Errorf("bad storage name")
	}
	b, rerr := os.ReadFile(filepath.Join(s.speech.MediaDir, storage))
	if rerr != nil {
		return nil, "", "", rerr
	}
	if len(b) > transcriptMaxAudio {
		return nil, "", "", fmt.Errorf("audio too large")
	}
	return b, filename, ct, nil
}

func (s *Service) httpGetAudio(ctx context.Context, rawURL string) ([]byte, string, string, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", "", err
	}
	res, err := s.httpClient().Do(req)
	if err != nil {
		return nil, "", "", err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return nil, "", "", fmt.Errorf("media http %d", res.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, transcriptMaxAudio+1))
	if err != nil {
		return nil, "", "", err
	}
	if len(b) > transcriptMaxAudio {
		return nil, "", "", fmt.Errorf("audio too large")
	}
	name := "audio" + extFromContentType(res.Header.Get("Content-Type"))
	return b, name, res.Header.Get("Content-Type"), nil
}

func s3ObjectURL(storage string) (string, error) {
	key := strings.TrimPrefix(storage, "s3:")
	key = strings.TrimLeft(key, "/")
	if key == "" {
		return "", fmt.Errorf("empty s3 key")
	}
	s3 := media.S3FromEnv()
	if s3 == nil || !s3.Enabled() {
		return "", fmt.Errorf("s3 not configured")
	}
	base := s3.PublicBase
	if base == "" {
		base = strings.TrimRight(s3.Endpoint, "/") + "/" + s3.Bucket
	}
	return strings.TrimRight(base, "/") + "/" + key, nil
}

func (s *Service) memberMessage(w http.ResponseWriter, r *http.Request) (uid, convID, msgID string, ok bool) {
	uid, ok = apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return "", "", "", false
	}
	convID = chi.URLParam(r, "id")
	msgID = chi.URLParam(r, "msgId")
	if _, err := uuid.Parse(convID); err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return "", "", "", false
	}
	if _, err := uuid.Parse(msgID); err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "message not found")
		return "", "", "", false
	}
	if !s.isMember(r, uid, convID) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return "", "", "", false
	}
	return uid, convID, msgID, true
}

func (s *Service) loadMessage(ctx context.Context, convID, msgID string) (body, mediaURL, msgType string, err error) {
	err = s.pool.QueryRow(ctx, `
		SELECT body, COALESCE(media_url,''), COALESCE(msg_type,'text')
		FROM messages
		WHERE id=$1::uuid AND conversation_id=$2::uuid AND deleted_at IS NULL
		  AND (expires_at IS NULL OR expires_at > now())`, msgID, convID).
		Scan(&body, &mediaURL, &msgType)
	return
}

func (s *Service) httpClient() *http.Client {
	if s != nil && s.speech.HTTP != nil {
		return s.speech.HTTP
	}
	return &http.Client{Timeout: 3 * time.Minute}
}

func transcriptView(id, status, text, errText string) map[string]any {
	out := map[string]any{
		"message_id": id,
		"status":     status,
		"text":       text,
	}
	if strings.TrimSpace(errText) != "" {
		out["error"] = errText
	}
	return out
}

func sttEndpoint(base string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		return ""
	}
	if strings.Contains(base, "/audio/transcriptions") || strings.HasSuffix(base, "/asr") {
		return base
	}
	if strings.HasSuffix(base, "/v1") {
		return base + "/audio/transcriptions"
	}
	return base + "/v1/audio/transcriptions"
}

func parseWhisperBody(status int, body []byte) (string, error) {
	if status >= 300 {
		return "", fmt.Errorf("stt %d", status)
	}
	var parsed struct {
		Text     string `json:"text"`
		Segments []struct {
			Text string `json:"text"`
		} `json:"segments"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		trim := strings.TrimSpace(string(body))
		if trim != "" && !strings.HasPrefix(trim, "{") && !strings.HasPrefix(trim, "[") {
			return trim, nil
		}
		return "", err
	}
	if strings.TrimSpace(parsed.Text) != "" {
		return strings.TrimSpace(parsed.Text), nil
	}
	var b strings.Builder
	for _, seg := range parsed.Segments {
		b.WriteString(seg.Text)
	}
	return strings.TrimSpace(b.String()), nil
}

func extFromContentType(ct string) string {
	ct = strings.ToLower(strings.TrimSpace(strings.Split(ct, ";")[0]))
	switch ct {
	case "audio/ogg":
		return ".ogg"
	case "audio/mpeg":
		return ".mp3"
	case "audio/mp4", "video/mp4":
		return ".m4a"
	case "audio/wav", "audio/x-wav":
		return ".wav"
	case "video/webm":
		return ".webm"
	default:
		return ".webm"
	}
}

type transcriptFail struct {
	public string
	retry  bool
}

func (e *transcriptFail) Error() string {
	if e == nil {
		return ""
	}
	return e.public
}
