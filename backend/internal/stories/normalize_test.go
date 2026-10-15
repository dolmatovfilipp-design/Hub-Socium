package stories

import "testing"

func TestFieldsFromRequestDefaultsAndClamp(t *testing.T) {
	got, err := fieldsFromRequest("Привет", nil, "", "none", "Москва", "", "plate", "", "", nil, nil, nil, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if got.FilterID != "" || got.Audience != "all" || got.MediaKind != "text" {
		t.Fatalf("defaults: %+v", got)
	}
	if got.TextStyle != "plate" || got.TextX != 50 || got.TextY != 42 || got.PlaceX != 50 || got.PlaceY != 76 {
		t.Fatalf("positions: %+v", got)
	}
	if got.PlaceName != "Москва" {
		t.Fatalf("place: %+v", got)
	}

	x, y := 140.0, -4.0
	media := "https://cdn.example/story.jpg"
	got, err = fieldsFromRequest("", &media, "close_friends", "Warm", "", "image", "nope", "", "", &x, &y, nil, nil, true)
	if err == nil || err.Error() != "Неизвестный стиль текста" {
		t.Fatalf("style: %v", err)
	}

	got, err = fieldsFromRequest("", &media, "close_friends", "warm", "", "image", "outline", "https://cdn.example/a.mp3", "Песня", &x, &y, nil, nil, true)
	if err != nil {
		t.Fatal(err)
	}
	if got.TextX != 100 || got.TextY != 0 || got.FilterID != "warm" || !got.Mirrored || got.SongTitle != "Песня" {
		t.Fatalf("clamp: %+v", got)
	}
}

func TestFieldsFromRequestValidation(t *testing.T) {
	cases := []struct {
		name string
		body string
		filt string
		aud  string
		kind string
		song string
		want string
	}{
		{"empty", "", "warm", "all", "image", "", "Нужен текст или медиа"},
		{"filter", "а", "sepia", "all", "text", "", "Неизвестный фильтр"},
		{"audience", "а", "", "friends", "text", "", "Аудитория: все или близкие друзья"},
		{"kind", "а", "", "all", "gif", "", "Неизвестный тип медиа"},
		{"song", "а", "", "all", "text", string(make([]byte, 2001)), "Слишком длинная ссылка на песню"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := fieldsFromRequest(tc.body, nil, tc.aud, tc.filt, "", tc.kind, "", tc.song, "", nil, nil, nil, nil, false)
			if err == nil || err.Error() != tc.want {
				t.Fatalf("got %v want %s", err, tc.want)
			}
		})
	}
}
