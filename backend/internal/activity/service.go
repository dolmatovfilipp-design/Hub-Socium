package activity

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/notifprefs"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// Insert creates an activity for recipient if actor != recipient. Best-effort (errors ignored by callers).
func (s *Service) Insert(ctx context.Context, userID, actorID, typ string, postID *string, meta map[string]any) error {
	if userID == "" || actorID == "" || typ == "" || userID == actorID {
		return nil
	}
	if !notifprefs.AllowActivity(ctx, s.pool, userID, typ) {
		return nil
	}
	if meta == nil {
		meta = map[string]any{}
	}
	raw, err := json.Marshal(meta)
	if err != nil {
		raw = []byte("{}")
	}
	var post any
	if postID != nil && *postID != "" {
		post = *postID
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO activities (user_id, actor_id, type, post_id, meta)
		VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::jsonb)`,
		userID, actorID, typ, post, raw)
	return err
}

func (s *Service) List(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	filter := r.URL.Query().Get("filter")
	if filter == "" {
		filter = "all"
	}
	limit := 30
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > 50 {
		limit = 50
	}

	cursorCreated, cursorID, hasCursor := decodeCursor(r.URL.Query().Get("cursor"))

	q := `
		SELECT a.id, a.actor_id, a.type, a.post_id, a.meta, a.created_at, a.read_at,
		       u.username, u.display_name, COALESCE(u.avatar_url,'')
		FROM activities a
		JOIN users u ON u.id = a.actor_id
		WHERE a.user_id = $1::uuid`
	args := []any{uid}
	argN := 2

	prefs := notifprefs.Load(r.Context(), s.pool, uid)
	if muted := notifprefs.MutedTypeList(prefs); len(muted) > 0 {
		q += fmt.Sprintf(` AND a.type <> ALL($%d::text[])`, argN)
		args = append(args, muted)
		argN++
	}

	switch filter {
	case "follows":
		q += ` AND a.type = 'follow'`
	case "replies":
		q += ` AND a.type IN ('reply','comment')`
	case "mentions":
		q += ` AND a.type = 'mention'`
	case "all", "":
		// no extra filter
	default:
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "filter must be all|follows|replies|mentions")
		return
	}

	if hasCursor {
		q += fmt.Sprintf(` AND (a.created_at, a.id) < ($%d::timestamptz, $%d::uuid)`, argN, argN+1)
		args = append(args, cursorCreated, cursorID)
		argN += 2
	}
	q += fmt.Sprintf(` ORDER BY a.created_at DESC, a.id DESC LIMIT $%d`, argN)
	args = append(args, limit+1)

	rows, err := s.pool.Query(r.Context(), q, args...)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()

	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, actorID uuid.UUID
		var typ string
		var postID *uuid.UUID
		var meta []byte
		var created time.Time
		var readAt *time.Time
		var username, displayName, avatar string
		if err := rows.Scan(&id, &actorID, &typ, &postID, &meta, &created, &readAt, &username, &displayName, &avatar); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		var metaObj any = map[string]any{}
		_ = json.Unmarshal(meta, &metaObj)
		item := map[string]any{
			"id":         id.String(),
			"actor_id":   actorID.String(),
			"type":       typ,
			"meta":       metaObj,
			"created_at": created.UTC().Format(time.RFC3339Nano),
			"read":       readAt != nil,
			"actor": map[string]any{
				"id":           actorID.String(),
				"username":     username,
				"display_name": displayName,
				"avatar_url":   avatar,
			},
		}
		if postID != nil {
			item["post_id"] = postID.String()
		}
		if readAt != nil {
			item["read_at"] = readAt.UTC().Format(time.RFC3339Nano)
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
		"items":       items,
		"next_cursor": next,
	})
}

func (s *Service) MarkRead(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		IDs []string `json:"ids"`
		All bool     `json:"all"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		// empty body → mark all
		req.All = true
	}
	if !req.All && len(req.IDs) == 0 {
		req.All = true
	}

	var err error
	if req.All {
		_, err = s.pool.Exec(r.Context(), `
			UPDATE activities SET read_at = now()
			WHERE user_id = $1::uuid AND read_at IS NULL`, uid)
	} else {
		_, err = s.pool.Exec(r.Context(), `
			UPDATE activities SET read_at = now()
			WHERE user_id = $1::uuid AND id = ANY($2::uuid[]) AND read_at IS NULL`,
			uid, req.IDs)
	}
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func encodeCursor(createdAt, id string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(createdAt + "|" + id))
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
