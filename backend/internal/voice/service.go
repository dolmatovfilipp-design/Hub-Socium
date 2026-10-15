package voice

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/config"
	"github.com/hub-socium/hub/backend/internal/media"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	maxClipBytes = 512 << 10
	retention    = 24 * time.Hour
)

// Service stores a short command clip and turns it into text.
type Service struct {
	pool   *pgxpool.Pool
	cfg    config.Config
	s3     *media.S3Config
	dir    string
	client *http.Client
}

func NewService(pool *pgxpool.Pool, cfg config.Config, s3 *media.S3Config, dir string) (*Service, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &Service{
		pool:   pool,
		cfg:    cfg,
		s3:     s3,
		dir:    dir,
		client: &http.Client{Timeout: 45 * time.Second},
	}, nil
}

func (s *Service) provider() Provider {
	return ResolveProvider(s.cfg.VoiceSTTProvider, s.cfg.YandexSpeechAPIKey, s.cfg.OpenAIAPIKey, s.cfg.STTURL)
}

func (s *Service) storageReady() bool {
	if s.s3 != nil && s.s3.Enabled() {
		return true
	}
	return s.cfg.DevMode
}

func (s *Service) Status(w http.ResponseWriter, r *http.Request) {
	p := s.provider()
	storage := "none"
	if s.s3 != nil && s.s3.Enabled() {
		storage = "s3"
	} else if s.cfg.DevMode {
		storage = "local"
	}
	ready := p != ProviderNone && s.storageReady() && s.pool != nil
	if p == ProviderYandex && strings.TrimSpace(s.cfg.YandexSpeechFolder) == "" {
		ready = false
	}
	hint := SetupHint(p, s.storageReady())
	if p == ProviderYandex && strings.TrimSpace(s.cfg.YandexSpeechFolder) == "" {
		hint = "Задайте YANDEX_SPEECHKIT_FOLDER или YANDEX_GPT_FOLDER."
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"provider":        string(p),
		"storage":         storage,
		"ready":           ready,
		"hint":            hint,
		"retention_hours": 24,
	})
}

func (s *Service) Transcribe(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	if s.pool == nil {
		apiutil.Error(w, http.StatusServiceUnavailable, "voice_stt_unconfigured", "база недоступна")
		return
	}
	p := s.provider()
	if p == ProviderNone {
		apiutil.Error(w, http.StatusServiceUnavailable, "voice_stt_unconfigured", SetupHint(p, false))
		return
	}
	if p == ProviderYandex && strings.TrimSpace(s.cfg.YandexSpeechFolder) == "" {
		apiutil.Error(w, http.StatusServiceUnavailable, "voice_stt_unconfigured", "Задайте YANDEX_SPEECHKIT_FOLDER или YANDEX_GPT_FOLDER.")
		return
	}
	if !s.storageReady() {
		apiutil.Error(w, http.StatusServiceUnavailable, "voice_storage_unconfigured", SetupHint(p, false))
		return
	}

	s.purgeExpired(r.Context())

	raw, err := readClip(w, r)
	if err != nil {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
		return
	}
	pcm, rate, err := PCMFromWAV(raw)
	if err != nil {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
		return
	}
	if rate != 16000 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "нужен WAV 16000 Гц, моно, 16 бит")
		return
	}

	id := uuid.New()
	key := fmt.Sprintf("voice-stt/%s/%s.wav", uid, id.String())
	storageKey := ""
	if s.s3 != nil && s.s3.Enabled() {
		if _, putErr := s.s3.PutObject(key, "audio/wav", raw); putErr != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось сохранить запись")
			return
		}
		storageKey = "s3:" + key
	} else {
		name := id.String() + ".wav"
		if writeErr := os.WriteFile(filepath.Join(s.dir, name), raw, 0o644); writeErr != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось сохранить запись")
			return
		}
		storageKey = "local:" + name
	}

	expires := time.Now().UTC().Add(retention)
	_, err = s.pool.Exec(r.Context(), `
		INSERT INTO voice_command_audio (id, user_id, storage_key, bytes, expires_at)
		VALUES ($1, $2::uuid, $3, $4, $5)`,
		id, uid, storageKey, len(raw), expires)
	if err != nil {
		s.deleteStored(storageKey)
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось записать срок хранения")
		return
	}

	text, err := s.recognize(r.Context(), p, pcm, raw)
	if err != nil {
		apiutil.Error(w, http.StatusBadGateway, "voice_stt_failed", "распознавание не ответило")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"text":       strings.TrimSpace(text),
		"expires_at": expires.Format(time.RFC3339),
	})
}

func readClip(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxClipBytes+1024)
	ct := r.Header.Get("Content-Type")
	if strings.HasPrefix(ct, "multipart/form-data") {
		if err := r.ParseMultipartForm(maxClipBytes + 1024); err != nil {
			return nil, fmt.Errorf("файл слишком большой или повреждён")
		}
		file, _, err := r.FormFile("file")
		if err != nil {
			return nil, fmt.Errorf("поле file обязательно")
		}
		defer file.Close()
		raw, err := io.ReadAll(io.LimitReader(file, maxClipBytes+1))
		if err != nil {
			return nil, fmt.Errorf("не удалось прочитать файл")
		}
		if len(raw) == 0 || len(raw) > maxClipBytes {
			return nil, fmt.Errorf("пустая или слишком длинная запись")
		}
		return raw, nil
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxClipBytes+1))
	if err != nil || len(raw) == 0 || len(raw) > maxClipBytes {
		return nil, fmt.Errorf("пустая или слишком длинная запись")
	}
	return raw, nil
}

func (s *Service) recognize(ctx context.Context, p Provider, pcm, wav []byte) (string, error) {
	switch p {
	case ProviderYandex:
		return s.yandex(ctx, pcm)
	case ProviderOpenAI:
		return s.openAI(ctx, wav)
	case ProviderSTT:
		return s.localSTT(ctx, wav)
	default:
		return "", fmt.Errorf("no provider")
	}
}

// localSTT posts a WAV clip to the compose stt service (STT_URL).
func (s *Service) localSTT(ctx context.Context, wav []byte) (string, error) {
	endpoint := sttTranscribeURL(s.cfg.STTURL)
	if endpoint == "" {
		return "", fmt.Errorf("stt url empty")
	}
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", "command.wav")
	if err != nil {
		return "", err
	}
	if _, err := part.Write(wav); err != nil {
		return "", err
	}
	model := strings.TrimSpace(s.cfg.STTModel)
	if model == "" {
		model = "Systran/faster-whisper-small"
	}
	lang := strings.TrimSpace(s.cfg.STTLanguage)
	if lang == "" {
		lang = "ru"
	}
	_ = w.WriteField("model", model)
	_ = w.WriteField("language", lang)
	_ = w.WriteField("response_format", "json")
	if err := w.Close(); err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	res, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("stt %d", res.StatusCode)
	}
	var out struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		trim := strings.TrimSpace(string(body))
		if trim != "" && !strings.HasPrefix(trim, "{") {
			return trim, nil
		}
		return "", err
	}
	return out.Text, nil
}

func sttTranscribeURL(base string) string {
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

func (s *Service) yandex(ctx context.Context, pcm []byte) (string, error) {
	url := fmt.Sprintf(
		"https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?lang=ru-RU&format=lpcm&sampleRateHertz=16000&folderId=%s",
		s.cfg.YandexSpeechFolder,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(pcm))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Api-Key "+s.cfg.YandexSpeechAPIKey)
	req.Header.Set("Content-Type", "application/octet-stream")
	res, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("yandex %d", res.StatusCode)
	}
	var out struct {
		Result string `json:"result"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", err
	}
	return out.Result, nil
}

func (s *Service) openAI(ctx context.Context, wav []byte) (string, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", "command.wav")
	if err != nil {
		return "", err
	}
	if _, err := part.Write(wav); err != nil {
		return "", err
	}
	_ = w.WriteField("model", "whisper-1")
	_ = w.WriteField("language", "ru")
	if err := w.Close(); err != nil {
		return "", err
	}
	base := strings.TrimRight(s.cfg.OpenAIBaseURL, "/")
	if base == "" {
		base = "https://api.openai.com/v1"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/audio/transcriptions", &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.OpenAIAPIKey)
	req.Header.Set("Content-Type", w.FormDataContentType())
	res, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("openai %d", res.StatusCode)
	}
	var out struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", err
	}
	return out.Text, nil
}

func (s *Service) purgeExpired(ctx context.Context) {
	rows, err := s.pool.Query(ctx, `
		DELETE FROM voice_command_audio
		WHERE id IN (
			SELECT id FROM voice_command_audio
			WHERE expires_at < now()
			LIMIT 40
		)
		RETURNING storage_key`)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		if rows.Scan(&key) == nil {
			s.deleteStored(key)
		}
	}
}

func (s *Service) deleteStored(storageKey string) {
	switch {
	case strings.HasPrefix(storageKey, "s3:"):
		if s.s3 != nil && s.s3.Enabled() {
			_ = s.s3.DeleteObject(strings.TrimPrefix(storageKey, "s3:"))
		}
	case strings.HasPrefix(storageKey, "local:"):
		name := filepath.Base(strings.TrimPrefix(storageKey, "local:"))
		_ = os.Remove(filepath.Join(s.dir, name))
	}
}
