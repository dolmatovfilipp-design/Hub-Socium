package posts

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/mentions"
	"github.com/hub-socium/hub/backend/internal/push"
)

// SetPush wires optional push for mentions.
func (s *Service) SetPush(p *push.Service) { s.push = p }

// push field added via this file — need to extend Service
// We use a package-level approach: add push to Service in this file by embedding via method receivers
// Actually Service doesn't have push — add it carefully.

var postsPush *push.Service

func (s *Service) BindPush(p *push.Service) {
	postsPush = p
	s.push = p
}

// StartScheduleWorker publishes due scheduled posts every 30s.
func (s *Service) StartScheduleWorker(ctx context.Context) {
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				tag, err := s.pool.Exec(ctx, `
					UPDATE posts
					SET status = 'published', scheduled_at = NULL
					WHERE status = 'scheduled'
					  AND deleted_at IS NULL
					  AND scheduled_at IS NOT NULL
					  AND scheduled_at <= now()`)
				if err != nil {
					slog.Warn("schedule worker", "err", err)
					continue
				}
				if tag.RowsAffected() > 0 {
					slog.Info("published scheduled posts", "count", tag.RowsAffected())
				}
			}
		}
	}()
}

// ListMyDrafts GET /v1/me/drafts
func (s *Service) ListMyDrafts(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT id::text, body, COALESCE(image_url,''), status, scheduled_at, created_at, COALESCE(tags,'{}')
		FROM posts
		WHERE author_id = $1::uuid AND deleted_at IS NULL AND status IN ('draft','scheduled')
		ORDER BY COALESCE(scheduled_at, created_at) DESC
		LIMIT 100`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, body, image, status string
		var scheduled *time.Time
		var created time.Time
		var tags []string
		if err := rows.Scan(&id, &body, &image, &status, &scheduled, &created, &tags); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		item := map[string]any{
			"id": id, "body": body, "status": status,
			"created_at": created.UTC().Format(time.RFC3339Nano),
			"tags": tags,
		}
		if image != "" {
			item["image_url"] = image
		}
		if scheduled != nil {
			item["scheduled_at"] = scheduled.UTC().Format(time.RFC3339Nano)
		}
		items = append(items, item)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// PublishDraft POST /v1/posts/{id}/publish
func (s *Service) PublishDraft(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE posts SET status = 'published', scheduled_at = NULL, created_at = now()
		WHERE id = $1::uuid AND author_id = $2::uuid AND deleted_at IS NULL
		  AND status IN ('draft','scheduled')`, id, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "draft not found")
		return
	}
	p, err := s.fetch(r, id)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, p)
}

// CreateDraftOrSchedule is used when Create gets status/scheduled_at — handled in patched Create.
// QuoteRepost POST /v1/posts/{id}/repost with body.quote_text
func (s *Service) afterMentions(r *http.Request, actorID, text, postID string) {
	pid := postID
	mentions.ResolveAndNotify(r.Context(), s.pool, s.activity, postsPush, actorID, text, &pid, nil)
}

func (s *Service) nestOriginal(r *http.Request, repostOf string) map[string]any {
	if repostOf == "" {
		return nil
	}
	p, err := s.fetch(r, repostOf)
	if err != nil {
		return nil
	}
	return p
}

// helper for quote body length
func clipQuote(s string) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > 500 {
		return string([]rune(s)[:500])
	}
	return s
}

