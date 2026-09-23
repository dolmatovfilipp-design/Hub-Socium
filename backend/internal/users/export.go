package users

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/hub-socium/hub/backend/internal/apiutil"
)

// ExportMyData GET /v1/me/export — JSON dump of user's core data (S15 MVP).
func (s *Service) ExportMyData(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	ctx := r.Context()
	out := map[string]any{
		"exported_at": time.Now().UTC().Format(time.RFC3339),
		"user_id":     uid,
	}

	var username, display, bio, city, about, services string
	var email, phone *string
	_ = s.pool.QueryRow(ctx, `
		SELECT username, display_name, COALESCE(bio,''), email, phone, COALESCE(city,''),
		       COALESCE(about,''), COALESCE(services,'')
		FROM users WHERE id=$1::uuid`, uid).
		Scan(&username, &display, &bio, &email, &phone, &city, &about, &services)
	out["profile"] = map[string]any{
		"username": username, "display_name": display, "bio": bio,
		"email": email, "phone": phone, "city": city, "about": about, "services": services,
	}

	posts := []map[string]any{}
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, body, COALESCE(image_url,''), created_at
		FROM posts WHERE author_id=$1::uuid AND deleted_at IS NULL
		ORDER BY created_at DESC LIMIT 500`, uid)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, body, img string
			var created time.Time
			if rows.Scan(&id, &body, &img, &created) == nil {
				posts = append(posts, map[string]any{"id": id, "body": body, "image_url": img, "created_at": created.UTC().Format(time.RFC3339)})
			}
		}
	}
	out["posts"] = posts

	ads := []map[string]any{}
	rows2, err := s.pool.Query(ctx, `
		SELECT id::text, title, price, COALESCE(city,''), created_at
		FROM market_ads WHERE seller_id=$1::uuid AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`, uid)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var id, title, cityA string
			var price int
			var created time.Time
			if rows2.Scan(&id, &title, &price, &cityA, &created) == nil {
				ads = append(ads, map[string]any{"id": id, "title": title, "price": price, "city": cityA, "created_at": created.UTC().Format(time.RFC3339)})
			}
		}
	}
	out["market_ads"] = ads

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="hub-export.json"`)
	w.WriteHeader(http.StatusOK)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(out)
}
