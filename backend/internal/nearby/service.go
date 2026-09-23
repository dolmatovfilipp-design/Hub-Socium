package nearby

import (
	"net/http"
	"strings"

	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// List GET /v1/nearby — posts, ads, meetups for viewer's city (or ?city=)
func (s *Service) List(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	city := strings.TrimSpace(r.URL.Query().Get("city"))
	if city == "" {
		_ = s.pool.QueryRow(r.Context(), `SELECT COALESCE(city,'') FROM users WHERE id=$1::uuid`, uid).Scan(&city)
	}
	city = strings.TrimSpace(city)
	if city == "" {
		apiutil.JSON(w, http.StatusOK, map[string]any{
			"city": "", "posts": []any{}, "ads": []any{}, "meetups": []any{},
			"note": "Укажите город в профиле, чтобы видеть ленту рядом.",
		})
		return
	}

	posts := []map[string]any{}
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

	ads := []map[string]any{}
	rows2, err := s.pool.Query(r.Context(), `
		SELECT id::text, title, price, city, created_at
		FROM market_ads WHERE deleted_at IS NULL AND LOWER(COALESCE(city,'')) = LOWER($1)
		ORDER BY created_at DESC LIMIT 40`, city)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var id, title, c string
			var price int
			var created interface{}
			if rows2.Scan(&id, &title, &price, &c, &created) == nil {
				ads = append(ads, map[string]any{"id": id, "title": title, "price": price, "city": c, "created_at": created})
			}
		}
	}

	meetups := []map[string]any{}
	rows3, err := s.pool.Query(r.Context(), `
		SELECT id::text, title, place, starts_at, city
		FROM meetups WHERE deleted_at IS NULL AND LOWER(COALESCE(city,'')) = LOWER($1) AND starts_at >= now() - interval '1 day'
		ORDER BY starts_at ASC LIMIT 40`, city)
	if err == nil {
		defer rows3.Close()
		for rows3.Next() {
			var id, title, place, c string
			var starts interface{}
			if rows3.Scan(&id, &title, &place, &starts, &c) == nil {
				meetups = append(meetups, map[string]any{"id": id, "title": title, "place": place, "starts_at": starts, "city": c})
			}
		}
	}

	apiutil.JSON(w, http.StatusOK, map[string]any{
		"city": city, "posts": posts, "ads": ads, "meetups": meetups,
	})
}
