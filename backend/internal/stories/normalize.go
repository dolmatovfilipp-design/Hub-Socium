package stories

import (
	"errors"
	"math"
	"strings"
	"unicode/utf8"
)

type storyFields struct {
	Body      string
	Media     string
	Audience  string
	FilterID  string
	PlaceName string
	MediaKind string
	TextStyle string
	TextX     float64
	TextY     float64
	PlaceX    float64
	PlaceY    float64
	SongURL   string
	SongTitle string
	Mirrored  bool
}

func fieldsFromRequest(
	body string,
	media *string,
	audience, filterID, placeName, mediaKind, textStyle, songURL, songTitle string,
	textX, textY, placeX, placeY *float64,
	mirrored bool,
) (storyFields, error) {
	in := storyFields{
		Body:      strings.TrimSpace(body),
		Audience:  strings.TrimSpace(audience),
		FilterID:  strings.ToLower(strings.TrimSpace(filterID)),
		PlaceName: strings.TrimSpace(placeName),
		MediaKind: strings.ToLower(strings.TrimSpace(mediaKind)),
		TextStyle: strings.ToLower(strings.TrimSpace(textStyle)),
		SongURL:   strings.TrimSpace(songURL),
		SongTitle: strings.TrimSpace(songTitle),
		TextX:     50,
		TextY:     42,
		PlaceX:    50,
		PlaceY:    76,
		Mirrored:  mirrored,
	}
	if media != nil {
		in.Media = strings.TrimSpace(*media)
	}
	if textX != nil {
		in.TextX = *textX
	}
	if textY != nil {
		in.TextY = *textY
	}
	if placeX != nil {
		in.PlaceX = *placeX
	}
	if placeY != nil {
		in.PlaceY = *placeY
	}
	return normalizeStory(in)
}

func normalizeStory(in storyFields) (storyFields, error) {
	if in.Body == "" && in.Media == "" {
		return in, errors.New("Нужен текст или медиа")
	}
	if utf8.RuneCountInString(in.Body) > 300 {
		return in, errors.New("Текст — до 300 символов")
	}
	if in.Audience == "" {
		in.Audience = "all"
	}
	if in.Audience != "all" && in.Audience != "close_friends" {
		return in, errors.New("Аудитория: все или близкие друзья")
	}
	switch in.FilterID {
	case "", "none", "warm", "cool", "mono", "fade":
		if in.FilterID == "none" {
			in.FilterID = ""
		}
	default:
		return in, errors.New("Неизвестный фильтр")
	}
	if utf8.RuneCountInString(in.PlaceName) > 80 {
		return in, errors.New("Название места — до 80 символов")
	}
	switch in.MediaKind {
	case "", "image", "video", "audio", "text":
	default:
		return in, errors.New("Неизвестный тип медиа")
	}
	if in.MediaKind == "" {
		if in.Media == "" {
			in.MediaKind = "text"
		}
	}
	switch in.TextStyle {
	case "", "classic", "plate", "outline":
	default:
		return in, errors.New("Неизвестный стиль текста")
	}
	if in.Body == "" {
		in.TextStyle = ""
	} else if in.TextStyle == "" {
		in.TextStyle = "classic"
	}
	if utf8.RuneCountInString(in.SongURL) > 2000 {
		return in, errors.New("Слишком длинная ссылка на песню")
	}
	if utf8.RuneCountInString(in.SongTitle) > 80 {
		return in, errors.New("Название песни — до 80 символов")
	}
	if in.SongURL == "" {
		in.SongTitle = ""
	}
	in.TextX = clampPct(in.TextX)
	in.TextY = clampPct(in.TextY)
	in.PlaceX = clampPct(in.PlaceX)
	in.PlaceY = clampPct(in.PlaceY)
	return in, nil
}

func clampPct(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 50
	}
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}
