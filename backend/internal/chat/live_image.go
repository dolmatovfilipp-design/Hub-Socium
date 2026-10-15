package chat

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

func (s *Service) openAIImage(ctx context.Context, prompt string) ([]byte, error) {
	body := map[string]any{
		"model":           "dall-e-2",
		"prompt":          "messenger sticker, simple, no text, " + prompt,
		"n":               1,
		"size":            "512x512",
		"response_format": "b64_json",
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.speech.OpenAIBase, "/")+"/images/generations", bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+s.speech.OpenAIKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("openai image %s", res.Status)
	}
	var parsed struct {
		Data []struct {
			B64 string `json:"b64_json"`
		} `json:"data"`
	}
	if err := json.Unmarshal(b, &parsed); err != nil {
		return nil, err
	}
	if len(parsed.Data) == 0 || parsed.Data[0].B64 == "" {
		return nil, fmt.Errorf("empty image")
	}
	return base64.StdEncoding.DecodeString(parsed.Data[0].B64)
}
