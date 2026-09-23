package nearby

import (
	"crypto/sha256"
	"encoding/binary"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/hub-socium/hub/backend/internal/apiutil"
)

// SaveGeo POST /v1/me/geo — { lat, lng, consent: true }
func (s *Service) SaveGeo(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Lat     float64 `json:"lat"`
		Lng     float64 `json:"lng"`
		Consent bool    `json:"consent"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	if !req.Consent {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "consent required")
		return
	}
	if req.Lat < -90 || req.Lat > 90 || req.Lng < -180 || req.Lng > 180 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "invalid coordinates")
		return
	}
	_, err := s.pool.Exec(r.Context(), `
		UPDATE users SET last_lat=$2, last_lng=$3, geo_consent_at=now() WHERE id=$1::uuid`,
		uid, req.Lat, req.Lng)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"ok": true, "lat": req.Lat, "lng": req.Lng, "consent_at": time.Now().UTC().Format(time.RFC3339),
	})
}

// ListEnhanced wraps List and adds map markers when lat/lng query present.
func (s *Service) ListMap(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}

	latQ := strings.TrimSpace(r.URL.Query().Get("lat"))
	lngQ := strings.TrimSpace(r.URL.Query().Get("lng"))
	hasGeo := latQ != "" && lngQ != ""

	city := strings.TrimSpace(r.URL.Query().Get("city"))
	if city == "" {
		_ = s.pool.QueryRow(r.Context(), `SELECT COALESCE(city,'') FROM users WHERE id=$1::uuid`, uid).Scan(&city)
	}
	city = strings.TrimSpace(city)

	var viewerLat, viewerLng float64
	var geoConsent bool
	if hasGeo {
		viewerLat, _ = strconv.ParseFloat(latQ, 64)
		viewerLng, _ = strconv.ParseFloat(lngQ, 64)
		geoConsent = true
	} else {
		var la, ln *float64
		var consent *time.Time
		_ = s.pool.QueryRow(r.Context(), `
			SELECT last_lat, last_lng, geo_consent_at FROM users WHERE id=$1::uuid`, uid).Scan(&la, &ln, &consent)
		if la != nil && ln != nil && consent != nil {
			viewerLat, viewerLng = *la, *ln
			geoConsent = true
			hasGeo = true
		}
	}

	if city == "" && !hasGeo {
		apiutil.JSON(w, http.StatusOK, map[string]any{
			"city": "", "mode": "empty", "posts": []any{}, "ads": []any{}, "meetups": []any{}, "markers": []any{},
			"note": "Разрешите геолокацию или укажите город в профиле.",
			"geo_consent": false,
		})
		return
	}

	// Reuse city listing
	posts, ads, meetups := s.fetchCity(r, city)

	markers := []map[string]any{}
	if hasGeo && geoConsent {
		for _, a := range ads {
			id, _ := a["id"].(string)
			lat, lng, approx := markerCoords(a, viewerLat, viewerLng, id+"ad")
			markers = append(markers, map[string]any{
				"id": id, "kind": "ad", "title": a["title"], "lat": lat, "lng": lng, "approx": approx,
			})
		}
		for _, m := range meetups {
			id, _ := m["id"].(string)
			lat, lng, approx := markerCoords(m, viewerLat, viewerLng, id+"mt")
			markers = append(markers, map[string]any{
				"id": id, "kind": "meetup", "title": m["title"], "lat": lat, "lng": lng, "approx": approx,
			})
		}
		markers = append(markers, map[string]any{
			"id": "me", "kind": "me", "title": "Вы", "lat": viewerLat, "lng": viewerLng, "approx": false,
		})
	}

	mode := "city"
	if hasGeo {
		mode = "map"
	}
	note := ""
	if city == "" {
		note = "Город не указан — метки по геолокации."
	}
	if hasGeo && len(markers) <= 1 {
		note = "Рядом пока тихо. Метки появятся у встреч и объявлений."
	}

	apiutil.JSON(w, http.StatusOK, map[string]any{
		"city": city, "mode": mode, "geo_consent": geoConsent,
		"viewer": map[string]any{"lat": viewerLat, "lng": viewerLng},
		"posts": posts, "ads": ads, "meetups": meetups, "markers": markers,
		"note": note,
	})
}

func (s *Service) fetchCity(r *http.Request, city string) (posts, ads, meetups []map[string]any) {
	posts, ads, meetups = []map[string]any{}, []map[string]any{}, []map[string]any{}
	if city == "" {
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT p.id::text, p.body, p.created_at, u.username, u.display_name
		FROM posts p
		JOIN users u ON u.id = p.author_id AND u.deleted_at IS NULL
		WHERE p.deleted_at IS NULL AND COALESCE(p.status,'published')='published'
		  AND LOWER(COALESCE(u.city,'')) = LOWER($1)
		ORDER BY p.created_at DESC LIMIT 40`, city)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, body, uname, dname string
			var created interface{}
			if rows.Scan(&id, &body, &created, &uname, &dname) == nil {
				posts = append(posts, map[string]any{
					"id": id, "body": body, "created_at": created,
					"author": map[string]any{"username": uname, "display_name": dname},
				})
			}
		}
	}
	rows2, err := s.pool.Query(r.Context(), `
		SELECT id::text, title, price, city, created_at, lat, lng
		FROM market_ads WHERE deleted_at IS NULL AND LOWER(COALESCE(city,'')) = LOWER($1)
		ORDER BY created_at DESC LIMIT 40`, city)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var id, title, c string
			var price int
			var created interface{}
			var lat, lng *float64
			if rows2.Scan(&id, &title, &price, &c, &created, &lat, &lng) == nil {
				item := map[string]any{"id": id, "title": title, "price": price, "city": c, "created_at": created}
				if lat != nil && lng != nil {
					item["lat"] = *lat
					item["lng"] = *lng
				}
				ads = append(ads, item)
			}
		}
	}
	rows3, err := s.pool.Query(r.Context(), `
		SELECT id::text, title, place, starts_at, city, lat, lng
		FROM meetups WHERE deleted_at IS NULL AND LOWER(COALESCE(city,'')) = LOWER($1) AND starts_at >= now() - interval '1 day'
		ORDER BY starts_at ASC LIMIT 40`, city)
	if err == nil {
		defer rows3.Close()
		for rows3.Next() {
			var id, title, place, c string
			var starts interface{}
			var lat, lng *float64
			if rows3.Scan(&id, &title, &place, &starts, &c, &lat, &lng) == nil {
				item := map[string]any{"id": id, "title": title, "place": place, "starts_at": starts, "city": c}
				if lat != nil && lng != nil {
					item["lat"] = *lat
					item["lng"] = *lng
				}
				meetups = append(meetups, item)
			}
		}
	}
	return
}

func markerCoords(item map[string]any, vLat, vLng float64, seed string) (float64, float64, bool) {
	if la, ok := item["lat"].(float64); ok {
		if ln, ok2 := item["lng"].(float64); ok2 {
			return la, ln, false
		}
	}
	// deterministic jitter ~300–800m around viewer for city-matched items without coords
	h := sha256.Sum256([]byte(seed))
	u1 := binary.BigEndian.Uint32(h[0:4])
	u2 := binary.BigEndian.Uint32(h[4:8])
	ang := float64(u1) / float64(^uint32(0)) * 2 * math.Pi
	dist := 0.002 + float64(u2%600)/100000.0 // degrees ~200–800m
	return vLat + dist*math.Cos(ang), vLng + dist*math.Sin(ang), true
}
