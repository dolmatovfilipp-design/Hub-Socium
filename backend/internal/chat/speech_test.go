package chat

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hub-socium/hub/backend/internal/apiutil"
)

func TestAudioFilenameSniffsMP4(t *testing.T) {
	raw := make([]byte, 12)
	copy(raw[4:8], "ftyp")
	if got := audioFilename("audio/webm", raw); got != "audio.m4a" {
		t.Fatalf("mp4 labeled webm: %s", got)
	}
	if got := audioFilename("audio/ogg", nil); got != "audio.ogg" {
		t.Fatalf("ogg: %s", got)
	}
}

func TestSTTEndpoint(t *testing.T) {
	if got := sttEndpoint("http://stt:8000/"); got != "http://stt:8000/v1/audio/transcriptions" {
		t.Fatalf("base: %s", got)
	}
	if got := sttEndpoint("http://stt:8000/v1"); got != "http://stt:8000/v1/audio/transcriptions" {
		t.Fatalf("v1: %s", got)
	}
	if got := sttEndpoint("http://stt:9000/asr"); got != "http://stt:9000/asr" {
		t.Fatalf("asr: %s", got)
	}
}

func TestParseWhisperBody(t *testing.T) {
	text, err := parseWhisperBody(200, []byte(`{"text":" привет "}`))
	if err != nil || text != "привет" {
		t.Fatalf("text=%q err=%v", text, err)
	}
	text, err = parseWhisperBody(200, []byte(`{"text":"","segments":[{"text":"раз "},{"text":"два"}]}`))
	if err != nil || text != "раз два" {
		t.Fatalf("segments=%q err=%v", text, err)
	}
	if _, err := parseWhisperBody(503, []byte(`{"text":"x"}`)); err == nil {
		t.Fatal("expected error on 503")
	}
	text, err = parseWhisperBody(200, []byte("plain line"))
	if err != nil || text != "plain line" {
		t.Fatalf("plain=%q err=%v", text, err)
	}
}

func TestLangHelpers(t *testing.T) {
	if guessLang("Hello there") != "en" {
		t.Fatal("latin")
	}
	if guessLang("Привет, как дела") != "ru" {
		t.Fatal("cyrillic")
	}
	lang, ok := normalizeLang("EN-us")
	if !ok || lang != "en" {
		t.Fatalf("normalize %q %v", lang, ok)
	}
	if _, ok := normalizeLang("rus"); ok {
		t.Fatal("expected reject")
	}
	if otherLang("en") != "ru" || otherLang("ru") != "en" {
		t.Fatal("other")
	}
	if bodyHash("a") == "" || bodyHash("a") != bodyHash("a") || bodyHash("a") == bodyHash("b") {
		t.Fatal("hash")
	}
	parts := splitRunes("абвгд", 2)
	if len(parts) != 3 || parts[0] != "аб" {
		t.Fatalf("split %#v", parts)
	}
}

func TestTranslatorSelection(t *testing.T) {
	if (SpeechConfig{}).translator() != trNone {
		t.Fatal("empty")
	}
	if (SpeechConfig{AllowFallback: true}).translator() != trMyMemory {
		t.Fatal("fallback")
	}
	if (SpeechConfig{TranslateURL: "http://libre", OpenAIKey: "k", AllowFallback: true}).translator() != trLibre {
		t.Fatal("libre wins")
	}
	if (SpeechConfig{OpenAIKey: "k", YandexKey: "y", YandexFolder: "f"}).translator() != trOpenAI {
		t.Fatal("openai")
	}
	if (SpeechConfig{YandexKey: "y", YandexFolder: "f"}).translator() != trYandex {
		t.Fatal("yandex")
	}
}

func TestFeaturesFlags(t *testing.T) {
	s := &Service{}
	s.ConfigureSpeech(SpeechConfig{AllowFallback: true})
	req := httptest.NewRequest(http.MethodGet, "/v1/features", nil)
	req = req.WithContext(apiutil.WithUser(req.Context(), "u", "name"))
	rr := httptest.NewRecorder()
	s.Features(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d", rr.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["transcribe"] != false || body["translate"] != false || body["ai"] != false {
		t.Fatalf("body %#v", body)
	}

	s.ConfigureSpeech(SpeechConfig{STTURL: "http://stt:8000", OpenAIKey: "sk"})
	rr = httptest.NewRecorder()
	s.Features(rr, req)
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["transcribe"] != true || body["translate"] != true || body["ai"] != true || body["stickers"] != true {
		t.Fatalf("configured %#v", body)
	}
}

func TestLibreTranslateAndSameLanguage(t *testing.T) {
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		b, _ := io.ReadAll(r.Body)
		var req map[string]any
		_ = json.Unmarshal(b, &req)
		q, _ := req["q"].(string)
		source, _ := req["source"].(string)
		target, _ := req["target"].(string)
		detected := "en"
		if strings.Contains(q, "привет") || source == "ru" {
			detected = "ru"
		}
		text := q
		if target == "ru" && detected == "en" {
			text = "привет"
		}
		if target == "en" && detected == "ru" {
			text = "hello"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"translatedText": text,
			"detectedLanguage": map[string]any{
				"language":   detected,
				"confidence": 0.9,
			},
		})
	}))
	defer srv.Close()

	s := &Service{}
	s.ConfigureSpeech(SpeechConfig{TranslateURL: srv.URL, HTTP: srv.Client()})
	out, src, provider, err := s.translateText(context.Background(), "hello", "ru")
	if err != nil || out != "привет" || src != "en" || provider != "libretranslate" {
		t.Fatalf("out=%q src=%q provider=%q err=%v", out, src, provider, err)
	}

	out, src, _, err = s.translateText(context.Background(), "привет", "ru")
	if err != nil || src != "ru" || out != "hello" {
		t.Fatalf("same-lang out=%q src=%q err=%v calls=%d", out, src, err, calls)
	}
	if calls < 3 {
		t.Fatalf("expected a second call when source==target, calls=%d", calls)
	}
}

func TestMyMemoryFallback(t *testing.T) {
	old := myMemoryEndpoint
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("q")
		if strings.Contains(q, "bad") {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"responseData":   map[string]string{"translatedText": "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS"},
				"responseStatus": 429,
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"responseData":   map[string]string{"translatedText": "привет"},
			"responseStatus": 200,
		})
	}))
	defer srv.Close()
	myMemoryEndpoint = srv.URL
	defer func() { myMemoryEndpoint = old }()

	s := &Service{}
	s.ConfigureSpeech(SpeechConfig{AllowFallback: true, HTTP: srv.Client()})
	out, src, provider, err := s.translateText(context.Background(), "hello", "ru")
	if err != nil || out != "привет" || src != "en" || provider != "mymemory" {
		t.Fatalf("out=%q src=%q provider=%q err=%v", out, src, provider, err)
	}
	if _, _, _, err := s.translateText(context.Background(), "bad news", "ru"); err == nil {
		t.Fatal("expected graceful failure")
	}

	s.ConfigureSpeech(SpeechConfig{})
	if _, _, _, err := s.translateText(context.Background(), "hello", "ru"); err == nil || !strings.Contains(err.Error(), "не настроен") {
		t.Fatalf("err=%v", err)
	}
}

func TestCallWhisper(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/transcriptions" {
			t.Errorf("path %s", r.URL.Path)
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Error(err)
		}
		if r.FormValue("language") != "ru" {
			t.Errorf("language %s", r.FormValue("language"))
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"text": "голос"})
	}))
	defer srv.Close()
	s := &Service{}
	s.ConfigureSpeech(SpeechConfig{STTURL: srv.URL, STTLanguage: "ru", HTTP: srv.Client()})
	text, err := s.callWhisper(context.Background(), []byte("abc"), "voice.webm", "audio/webm")
	if err != nil || text != "голос" {
		t.Fatalf("text=%q err=%v", text, err)
	}
}
