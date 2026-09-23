package explore

import (
	"net/http"
	"strings"
	"time"

	"github.com/hub-socium/hub/backend/internal/apiutil"
)

// Unified GET /v1/search?q= — people + posts + tags + ads
func (s *Service) Unified(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		apiutil.JSON(w, http.StatusOK, map[string]any{
			"q": q, "people": []any{}, "posts": []any{}, "tags": []any{}, "ads": []any{},
			"empty_reason": "Введите запрос: люди, посты, теги или объявления",
		})
		return
	}
	people := []map[string]any{}
	pRows, err := s.pool.Query(r.Context(), `
		SELECT id::text, username, display_name, COALESCE(avatar_url,''), COALESCE(city,'')
		FROM users WHERE deleted_at IS NULL
		  AND (username ILIKE '%'||$1||'%' OR display_name ILIKE '%'||$1||'%')
		  AND id <> $2::uuid
		ORDER BY username LIMIT 15`, q, uid)
	if err == nil {
		defer pRows.Close()
		for pRows.Next() {
			var id, uname, dname, av, city string
			if pRows.Scan(&id, &uname, &dname, &av, &city) == nil {
				item := map[string]any{"id": id, "username": uname, "display_name": dname, "avatar_url": av}
				if city != "" {
					item["city"] = city
				}
				people = append(people, item)
			}
		}
	}
	posts := []map[string]any{}
	postRows, err := s.pool.Query(r.Context(), `
		SELECT p.id::text, p.author_id::text, p.body, p.created_at,
		       (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id=p.id)
		FROM posts p
		WHERE p.deleted_at IS NULL AND COALESCE(p.status,'published')='published'
		  AND (p.body ILIKE '%'||$1||'%' OR $1 = ANY(p.tags))
		ORDER BY p.created_at DESC LIMIT 20`, q)
	if err == nil {
		defer postRows.Close()
		for postRows.Next() {
			var id, author, body string
			var created time.Time
			var likes int64
			if postRows.Scan(&id, &author, &body, &created, &likes) == nil {
				posts = append(posts, map[string]any{
					"id": id, "author_id": author, "body": body,
					"created_at": created.UTC().Format(time.RFC3339Nano), "likes": likes,
				})
			}
		}
	}
	tags := []map[string]any{}
	tagRows, err := s.pool.Query(r.Context(), `
		SELECT t.tag, COUNT(*)::int FROM posts p, LATERAL unnest(p.tags) AS t(tag)
		WHERE p.deleted_at IS NULL AND t.tag ILIKE '%'||$1||'%'
		GROUP BY t.tag ORDER BY COUNT(*) DESC LIMIT 15`, q)
	if err == nil {
		defer tagRows.Close()
		for tagRows.Next() {
			var t string
			var c int
			if tagRows.Scan(&t, &c) == nil {
				tags = append(tags, map[string]any{"tag": t, "count": c})
			}
		}
	}
	ads := []map[string]any{}
	adRows, err := s.pool.Query(r.Context(), `
		SELECT id::text, title, price, city, seller_id::text FROM market_ads
		WHERE deleted_at IS NULL AND (title ILIKE '%'||$1||'%' OR description ILIKE '%'||$1||'%' OR city ILIKE '%'||$1||'%')
		ORDER BY created_at DESC LIMIT 15`, q)
	if err == nil {
		defer adRows.Close()
		for adRows.Next() {
			var id, title, city, seller string
			var price int
			if adRows.Scan(&id, &title, &price, &city, &seller) == nil {
				ads = append(ads, map[string]any{"id": id, "title": title, "price": price, "city": city, "seller_id": seller})
			}
		}
	}
	empty := len(people)+len(posts)+len(tags)+len(ads) == 0
	out := map[string]any{"q": q, "people": people, "posts": posts, "tags": tags, "ads": ads}
	if empty {
		out["empty_reason"] = "Ничего не найдено по «" + q + "». Попробуйте другое слово."
	}
	apiutil.JSON(w, http.StatusOK, out)
}
