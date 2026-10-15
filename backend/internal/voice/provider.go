package voice

import "strings"

// Provider is the speech-to-text backend for a command clip.
type Provider string

const (
	ProviderNone   Provider = "none"
	ProviderYandex Provider = "yandex"
	ProviderOpenAI Provider = "openai"
	// ProviderSTT is the compose "stt" container (OpenAI-compatible Whisper).
	ProviderSTT Provider = "stt"
)

// ResolveProvider picks STT. OpenAI is used only when VOICE_STT_PROVIDER=openai.
// Yandex SpeechKit wins when its key is set. With no SpeechKit key, a configured
// STT_URL (the self-hosted stt container) is the provider.
func ResolveProvider(explicit, yandexKey, openAIKey, sttURL string) Provider {
	switch strings.ToLower(strings.TrimSpace(explicit)) {
	case "off", "none":
		return ProviderNone
	case "openai":
		if strings.TrimSpace(openAIKey) != "" {
			return ProviderOpenAI
		}
		return ProviderNone
	case "stt", "whisper", "local":
		if strings.TrimSpace(sttURL) != "" {
			return ProviderSTT
		}
		return ProviderNone
	default:
		if strings.TrimSpace(yandexKey) != "" {
			return ProviderYandex
		}
		if strings.TrimSpace(sttURL) != "" {
			return ProviderSTT
		}
		return ProviderNone
	}
}

func SetupHint(p Provider, storageReady bool) string {
	if p == ProviderSTT {
		if !storageReady {
			return "Локальный сервис расшифровки включён. Для коротких команд задайте хранилище (S3 или режим разработки)."
		}
		return ""
	}
	if p == ProviderNone {
		return "Задайте YANDEX_SPEECHKIT_API_KEY или STT_URL (сервис stt). OpenAI только при VOICE_STT_PROVIDER=openai."
	}
	if !storageReady {
		return "Задайте S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY и S3_SECRET_KEY для Selectel. Для Selectel регион не ru-central1, а ru-1, ru-2, ru-3 или ru-7."
	}
	return ""
}
