package voice

import "strings"

// Provider is the speech-to-text backend for a command clip.
type Provider string

const (
	ProviderNone   Provider = "none"
	ProviderYandex Provider = "yandex"
	ProviderOpenAI Provider = "openai"
)

// ResolveProvider picks STT. OpenAI is used only when VOICE_STT_PROVIDER=openai.
// The default path is Yandex SpeechKit so audio stays in Russia.
func ResolveProvider(explicit, yandexKey, openAIKey string) Provider {
	switch strings.ToLower(strings.TrimSpace(explicit)) {
	case "off", "none":
		return ProviderNone
	case "openai":
		if strings.TrimSpace(openAIKey) != "" {
			return ProviderOpenAI
		}
		return ProviderNone
	default:
		if strings.TrimSpace(yandexKey) != "" {
			return ProviderYandex
		}
		return ProviderNone
	}
}

func SetupHint(p Provider, storageReady bool) string {
	if p == ProviderNone {
		return "Задайте YANDEX_SPEECHKIT_API_KEY и YANDEX_SPEECHKIT_FOLDER (или YANDEX_GPT_FOLDER). OpenAI только при VOICE_STT_PROVIDER=openai."
	}
	if !storageReady {
		return "Задайте S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY и S3_SECRET_KEY для Selectel. Для Selectel регион не ru-central1, а ru-1, ru-2, ru-3 или ru-7."
	}
	return ""
}
