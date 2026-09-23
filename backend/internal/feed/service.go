package feed

import (
	"encoding/base64"
	"fmt"
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

// Following returns chronological posts from followees + self.
func (s *Service) Following(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	limit := 20
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > 50 {
		limit = 50
	}

	cursorCreated, cursorID, hasCursor := decodeCursor(r.URL.Query().Get("cursor"))
	tag := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(r.URL.Query().Get("tag"), "#")))

	q := `
		SELECT p.id, p.author_id, p.body, COALESCE(p.image_url,''), p.created_at,
		       (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id),
		       (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL),
		       EXISTS(SELECT 1 FROM post_likes pl2 WHERE pl2.post_id = p.id AND pl2.user_id = $1::uuid),
		       (SELECT COUNT(*) FROM post_reposts prc WHERE prc.post_id = p.id),
		       EXISTS(SELECT 1 FROM post_reposts pr2 WHERE pr2.post_id = p.id AND pr2.user_id = $1::uuid),
		       p.repost_of
		FROM posts p
		WHERE p.deleted_at IS NULL
		  AND COALESCE(p.status,'published') = 'published'
		  AND (
		    p.author_id = $1
		    OR p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = $1)
		    OR p.id IN (
		      SELECT pr.post_id FROM post_reposts pr
		      WHERE pr.user_id = $1 OR pr.user_id IN (SELECT followee_id FROM follows WHERE follower_id = $1)
		    )
		  )
		  AND p.author_id NOT IN (
		    SELECT blocked_id FROM blocks WHERE blocker_id = $1
		  )
		  AND p.author_id NOT IN (
		    SELECT blocker_id FROM blocks WHERE blocked_id = $1
		  )
		  AND p.author_id NOT IN (
		    SELECT muted_id FROM mutes WHERE muter_id = $1
		  )`
	args := []any{uid}
	argN := 2
	if tag != "" {
		q += fmt.Sprintf(` AND $%d = ANY(p.tags)`, argN)
		args = append(args, tag)
		argN++
	}
	if hasCursor {
		q += fmt.Sprintf(` AND (p.created_at, p.id) < ($%d::timestamptz, $%d::uuid)`, argN, argN+1)
		args = append(args, cursorCreated, cursorID)
		argN += 2
	}
	q += fmt.Sprintf(` ORDER BY p.created_at DESC, p.id DESC LIMIT $%d`, argN)
	args = append(args, limit+1)

	rows, err := s.pool.Query(r.Context(), q, args...)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()

	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, author uuid.UUID
		var body, imageURL string
		var created time.Time
		var likes, comments, reposts int64
		var likedByMe, repostedByMe bool
		var repostOf *uuid.UUID
		if err := rows.Scan(&id, &author, &body, &imageURL, &created, &likes, &comments, &likedByMe, &reposts, &repostedByMe, &repostOf); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		item := map[string]any{
			"id":             id.String(),
			"author_id":      author.String(),
			"body":           body,
			"created_at":     created.UTC().Format(time.RFC3339Nano),
			"likes":          likes,
			"comments":       comments,
			"liked_by_me":    likedByMe,
			"reposts":        reposts,
			"reposted_by_me": repostedByMe,
		}
		if imageURL != "" {
			item["image_url"] = imageURL
		}
		if repostOf != nil {
			item["repost_of"] = repostOf.String()
			var oid, oauthor uuid.UUID
			var obody, oimage string
			var ocreated time.Time
			err2 := s.pool.QueryRow(r.Context(), `
				SELECT id, author_id, body, COALESCE(image_url,''), created_at
				FROM posts WHERE id=$1 AND deleted_at IS NULL`, *repostOf).
				Scan(&oid, &oauthor, &obody, &oimage, &ocreated)
			if err2 == nil {
				orig := map[string]any{
					"id": oid.String(), "author_id": oauthor.String(), "body": obody,
					"created_at": ocreated.UTC().Format(time.RFC3339Nano),
				}
				if oimage != "" {
					orig["image_url"] = oimage
				}
				item["original"] = orig
			}
		}
		items = append(items, item)
	}

	var next any
	if len(items) > limit {
		last := items[limit-1]
		items = items[:limit]
		next = encodeCursor(last["created_at"].(string), last["id"].(string))
	}

	apiutil.JSON(w, http.StatusOK, map[string]any{
		"items":        items,
		"next_cursor":  next,
	})
}

func encodeCursor(createdAt, id string) string {
	raw := createdAt + "|" + id
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeCursor(c string) (time.Time, string, bool) {
	if c == "" {
		return time.Time{}, "", false
	}
	b, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return time.Time{}, "", false
	}
	parts := strings.SplitN(string(b), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, "", false
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		t, err = time.Parse(time.RFC3339, parts[0])
		if err != nil {
			return time.Time{}, "", false
		}
	}
	return t, parts[1], true
}
