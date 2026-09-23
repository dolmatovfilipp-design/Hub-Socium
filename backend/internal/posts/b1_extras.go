package posts

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
)

func validMediaURL(u string) bool {
	u = strings.TrimSpace(u)
	if u == "" || strings.HasPrefix(u, "data:") || len(u) > 2048 {
		return false
	}
	return strings.HasPrefix(u, "/v1/media/") ||
		strings.HasPrefix(u, "http://") ||
		strings.HasPrefix(u, "https://")
}

func (s *Service) savePostImages(r *http.Request, postID string, urls []string) []string {
	out := make([]string, 0, len(urls))
	seen := map[string]bool{}
	pos := 0
	for _, raw := range urls {
		u := strings.TrimSpace(raw)
		if !validMediaURL(u) || seen[u] {
			continue
		}
		seen[u] = true
		_, err := s.pool.Exec(r.Context(), `
			INSERT INTO post_images (post_id, position, url) VALUES ($1::uuid,$2,$3)
			ON CONFLICT (post_id, position) DO UPDATE SET url=EXCLUDED.url`, postID, pos, u)
		if err != nil {
			continue
		}
		out = append(out, u)
		pos++
		if pos >= 10 {
			break
		}
	}
	return out
}

func (s *Service) loadPostImages(r *http.Request, postID string) []string {
	rows, err := s.pool.Query(r.Context(), `
		SELECT url FROM post_images WHERE post_id=$1::uuid ORDER BY position ASC`, postID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	urls := make([]string, 0)
	for rows.Next() {
		var u string
		if rows.Scan(&u) == nil && u != "" {
			urls = append(urls, u)
		}
	}
	return urls
}

type pollIn struct {
	Question string   `json:"question"`
	Options  []string `json:"options"`
	Multi    bool     `json:"multi"`
}

func (s *Service) createPollForPost(r *http.Request, postID string, p pollIn) map[string]any {
	q := strings.TrimSpace(p.Question)
	if q == "" || utf8.RuneCountInString(q) > 200 {
		return nil
	}
	opts := make([]string, 0, 6)
	seen := map[string]bool{}
	for _, o := range p.Options {
		lab := strings.TrimSpace(o)
		if lab == "" || seen[lab] || utf8.RuneCountInString(lab) > 80 {
			continue
		}
		seen[lab] = true
		opts = append(opts, lab)
		if len(opts) >= 6 {
			break
		}
	}
	if len(opts) < 2 {
		return nil
	}
	pid := uuid.New()
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO polls (id, post_id, question, multi) VALUES ($1,$2::uuid,$3,$4)`,
		pid, postID, q, p.Multi)
	if err != nil {
		return nil
	}
	for i, lab := range opts {
		_, _ = s.pool.Exec(r.Context(), `
			INSERT INTO poll_options (id, poll_id, label, position) VALUES ($1,$2,$3,$4)`,
			uuid.New(), pid, lab, i)
	}
	return s.pollPayload(r, pid.String(), "")
}

func (s *Service) pollPayload(r *http.Request, pollID, viewerID string) map[string]any {
	var question string
	var multi bool
	var postID, channelPostID *string
	err := s.pool.QueryRow(r.Context(), `
		SELECT question, multi, post_id::text, channel_post_id::text FROM polls WHERE id=$1::uuid`, pollID).
		Scan(&question, &multi, &postID, &channelPostID)
	if err != nil {
		return nil
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT o.id::text, o.label, o.position,
		       (SELECT COUNT(*)::int FROM poll_votes v WHERE v.option_id=o.id) AS votes,
		       CASE WHEN $2::text = '' THEN false
		            ELSE EXISTS(SELECT 1 FROM poll_votes v2 WHERE v2.option_id=o.id AND v2.user_id=$2::uuid)
		       END AS mine
		FROM poll_options o
		WHERE o.poll_id=$1::uuid
		ORDER BY o.position`, pollID, viewerID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	options := make([]map[string]any, 0)
	total := 0
	myVotes := make([]string, 0)
	for rows.Next() {
		var oid, label string
		var pos, votes int
		var mine bool
		if rows.Scan(&oid, &label, &pos, &votes, &mine) != nil {
			continue
		}
		total += votes
		opt := map[string]any{"id": oid, "label": label, "votes": votes, "position": pos}
		if mine {
			opt["voted"] = true
			myVotes = append(myVotes, oid)
		}
		options = append(options, opt)
	}
	out := map[string]any{
		"id": pollID, "question": question, "multi": multi,
		"options": options, "total_votes": total, "my_votes": myVotes,
	}
	if postID != nil && *postID != "" {
		out["post_id"] = *postID
	}
	if channelPostID != nil && *channelPostID != "" {
		out["channel_post_id"] = *channelPostID
	}
	return out
}

func nullUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s *Service) attachPollAndImages(r *http.Request, post map[string]any) {
	id, _ := post["id"].(string)
	if id == "" {
		return
	}
	imgs := s.loadPostImages(r, id)
	if len(imgs) > 0 {
		post["image_urls"] = imgs
		if _, ok := post["image_url"]; !ok || post["image_url"] == "" {
			post["image_url"] = imgs[0]
		}
	}
	viewer, _ := apiutil.UserIDFromContext(r.Context())
	var pollID string
	_ = s.pool.QueryRow(r.Context(), `SELECT id::text FROM polls WHERE post_id=$1::uuid`, id).Scan(&pollID)
	if pollID != "" {
		if p := s.pollPayload(r, pollID, viewer); p != nil {
			post["poll"] = p
		}
	}
}

// VotePoll POST /v1/polls/{id}/vote {option_id} or {option_ids}
func (s *Service) VotePoll(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	pollID := chi.URLParam(r, "id")
	var multi bool
	err := s.pool.QueryRow(r.Context(), `SELECT multi FROM polls WHERE id=$1::uuid`, pollID).Scan(&multi)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "poll not found")
		return
	}
	var req struct {
		OptionID  string   `json:"option_id"`
		OptionIDs []string `json:"option_ids"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	ids := req.OptionIDs
	if req.OptionID != "" {
		ids = append(ids, req.OptionID)
	}
	if len(ids) == 0 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "option_id required")
		return
	}
	if !multi {
		ids = ids[:1]
		_, _ = s.pool.Exec(r.Context(), `DELETE FROM poll_votes WHERE poll_id=$1::uuid AND user_id=$2::uuid`, pollID, uid)
	}
	for _, oid := range ids {
		var belongs bool
		_ = s.pool.QueryRow(r.Context(), `
			SELECT EXISTS(SELECT 1 FROM poll_options WHERE id=$1::uuid AND poll_id=$2::uuid)`, oid, pollID).Scan(&belongs)
		if !belongs {
			continue
		}
		_, _ = s.pool.Exec(r.Context(), `
			INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES ($1::uuid,$2::uuid,$3::uuid)
			ON CONFLICT DO NOTHING`, pollID, oid, uid)
	}
	apiutil.JSON(w, http.StatusOK, s.pollPayload(r, pollID, uid))
}

// GetPoll GET /v1/polls/{id}
func (s *Service) GetPoll(w http.ResponseWriter, r *http.Request) {
	uid, _ := apiutil.UserIDFromContext(r.Context())
	p := s.pollPayload(r, chi.URLParam(r, "id"), uid)
	if p == nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "poll not found")
		return
	}
	apiutil.JSON(w, http.StatusOK, p)
}

// --- Bookmark folders (T10) ---

func (s *Service) ListBookmarkFolders(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT f.id::text, f.name, f.created_at,
		       (SELECT COUNT(*)::int FROM post_bookmarks b WHERE b.folder_id=f.id) AS cnt
		FROM bookmark_folders f
		WHERE f.user_id=$1::uuid
		ORDER BY f.created_at ASC`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, name string
		var created time.Time
		var cnt int
		if rows.Scan(&id, &name, &created, &cnt) != nil {
			continue
		}
		items = append(items, map[string]any{
			"id": id, "name": name, "count": cnt,
			"created_at": created.UTC().Format(time.RFC3339Nano),
		})
	}
	var unfiled int
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COUNT(*)::int FROM post_bookmarks WHERE user_id=$1::uuid AND folder_id IS NULL`, uid).Scan(&unfiled)
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items, "unfiled": unfiled})
}

func (s *Service) CreateBookmarkFolder(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || utf8.RuneCountInString(req.Name) > 60 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "name 1..60")
		return
	}
	id := uuid.New()
	var created time.Time
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO bookmark_folders (id, user_id, name) VALUES ($1,$2::uuid,$3)
		RETURNING created_at`, id, uid, req.Name).Scan(&created)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			apiutil.Error(w, http.StatusConflict, "conflict", "folder exists")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusCreated, map[string]any{
		"id": id.String(), "name": req.Name, "count": 0,
		"created_at": created.UTC().Format(time.RFC3339Nano),
	})
}

func (s *Service) MoveBookmark(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	postID := chi.URLParam(r, "id")
	var req struct {
		FolderID *string `json:"folder_id"` // null = unfiled
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	var folder any
	if req.FolderID != nil && strings.TrimSpace(*req.FolderID) != "" {
		fid := strings.TrimSpace(*req.FolderID)
		var owns bool
		_ = s.pool.QueryRow(r.Context(), `
			SELECT EXISTS(SELECT 1 FROM bookmark_folders WHERE id=$1::uuid AND user_id=$2::uuid)`, fid, uid).Scan(&owns)
		if !owns {
			apiutil.Error(w, http.StatusNotFound, "not_found", "folder not found")
			return
		}
		folder = fid
	}
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE post_bookmarks SET folder_id=$3
		WHERE post_id=$1::uuid AND user_id=$2::uuid`, postID, uid, folder)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		// upsert bookmark into folder
		_, err = s.pool.Exec(r.Context(), `
			INSERT INTO post_bookmarks (post_id, user_id, folder_id) VALUES ($1::uuid,$2::uuid,$3)
			ON CONFLICT (post_id, user_id) DO UPDATE SET folder_id=EXCLUDED.folder_id`, postID, uid, folder)
		if err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "folder_id": folder})
}
