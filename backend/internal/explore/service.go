package explore

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// Search GET /v1/explore?q=&tag=
func (s *Service) Search(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	tag := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(r.URL.Query().Get("tag"), "#")))
	limit := 30
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 50 {
			limit = n
		}
	}

	sql := `
		SELECT p.id, p.author_id, p.body, COALESCE(p.image_url,''), p.created_at,
		       (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) AS likes,
		       (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comments,
		       COALESCE(p.tags, '{}')
		FROM posts p
		JOIN users u ON u.id = p.author_id AND u.deleted_at IS NULL
		WHERE p.deleted_at IS NULL
		  AND COALESCE(p.status,'published') = 'published'
		  AND p.author_id NOT IN (SELECT muted_id FROM mutes WHERE muter_id = $1::uuid)
		  AND p.author_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $1::uuid)
		  AND p.author_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = $1::uuid)
		  AND (
		    COALESCE(u.is_private,false) = false
		    OR p.author_id = $1::uuid
		    OR EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = $1::uuid AND f.followee_id = p.author_id)
		  )`
	args := []any{uid}
	argN := 2
	if tag != "" {
		sql += ` AND $` + itoa(argN) + ` = ANY(p.tags)`
		args = append(args, tag)
		argN++
	}
	if q != "" {
		sql += ` AND (p.body ILIKE '%' || $` + itoa(argN) + ` || '%' OR $` + itoa(argN) + ` = ANY(p.tags))`
		args = append(args, q)
		argN++
	}
	sql += ` ORDER BY likes DESC, p.created_at DESC LIMIT $` + itoa(argN)
	args = append(args, limit)

	rows, err := s.pool.Query(r.Context(), sql, args...)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, author uuid.UUID
		var body, image string
		var created time.Time
		var likes, comments int64
		var tags []string
		if err := rows.Scan(&id, &author, &body, &image, &created, &likes, &comments, &tags); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		item := map[string]any{
			"id": id.String(), "author_id": author.String(), "body": body,
			"created_at": created.UTC().Format(time.RFC3339Nano),
			"likes": likes, "comments": comments, "tags": tags,
		}
		if image != "" {
			item["image_url"] = image
		}
		items = append(items, item)
	}

	// Tag cloud
	tagRows, err := s.pool.Query(r.Context(), `
		SELECT t.tag, COUNT(*)::int AS cnt
		FROM posts p, LATERAL unnest(p.tags) AS t(tag)
		WHERE p.deleted_at IS NULL AND COALESCE(p.status,'published') = 'published'
		  AND p.created_at > now() - interval '14 days'
		GROUP BY t.tag
		ORDER BY cnt DESC
		LIMIT 30`)
	tagsOut := make([]map[string]any, 0)
	if err == nil {
		defer tagRows.Close()
		for tagRows.Next() {
			var t string
			var c int
			if tagRows.Scan(&t, &c) == nil {
				tagsOut = append(tagsOut, map[string]any{"tag": t, "count": c})
			}
		}
	}

	apiutil.JSON(w, http.StatusOK, map[string]any{
		"items": items,
		"tags":  tagsOut,
		"q":     q,
		"tag":   tag,
	})
}

func itoa(n int) string {
	return strconv.Itoa(n)
}
