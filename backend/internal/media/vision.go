package media

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// visionBlocks is true when YANDEX_VISION_API_KEY is set and the classifier
// reports adult content. With no key the upload proceeds. A transport error
// does not block the upload.
func visionBlocks(contentType string, body []byte) (bool, string) {
	key := strings.TrimSpace(os.Getenv("YANDEX_VISION_API_KEY"))
	if key == "" || !strings.HasPrefix(contentType, "image/") || len(body) == 0 {
		return false, ""
	}
	payload := map[string]any{
		"folderId": strings.TrimSpace(os.Getenv("YANDEX_VISION_FOLDER")),
		"analyze_specs": []map[string]any{{
			"content": base64.StdEncoding.EncodeToString(body),
			"features": []map[string]any{{
				"type": "CLASSIFICATION",
				"classificationConfig": map[string]string{"model": "moderation"},
			}},
		}},
	}
	raw, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost, "https://vision.api.cloud.yandex.net/vision/v1/batchAnalyze", bytes.NewReader(raw))
	if err != nil {
		return false, ""
	}
	req.Header.Set("Authorization", "Api-Key "+key)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 12 * time.Second}
	res, err := client.Do(req)
	if err != nil || res.StatusCode >= 300 {
		if res != nil {
			res.Body.Close()
		}
		return false, ""
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	text := strings.ToLower(string(b))
	if strings.Contains(text, "adult") && (strings.Contains(text, "\"probability\":0.8") || strings.Contains(text, "\"probability\": 0.9") || strings.Contains(text, "\"name\":\"adult\"")) {
		return true, "Изображение не прошло проверку"
	}
	return false, ""
}
