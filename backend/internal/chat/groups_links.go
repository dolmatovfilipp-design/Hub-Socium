package chat

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/hub-socium/hub/backend/internal/apiutil"
)

func newInviteToken() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

type inviteLinkRow struct {
	token   string
	convID  string
	title   string
	avatar  string
	members int
	created time.Time
	expires *time.Time
	maxUses *int
	uses    int
	revoked *time.Time
}

func (s *Service) loadInviteLink(r *http.Request, token string) (inviteLinkRow, error) {
	var row inviteLinkRow
	err := s.pool.QueryRow(r.Context(), `
		SELECT l.token, l.conversation_id::text, COALESCE(c.title,''), COALESCE(c.avatar_url,''),
		       (SELECT COUNT(*)::int FROM conversation_members m WHERE m.conversation_id = c.id),
		       l.created_at, l.expires_at, l.max_uses, l.uses, l.revoked_at
		FROM group_invite_links l
		JOIN conversations c ON c.id = l.conversation_id
		WHERE l.token = $1`, token).Scan(
		&row.token, &row.convID, &row.title, &row.avatar, &row.members,
		&row.created, &row.expires, &row.maxUses, &row.uses, &row.revoked,
	)
	return row, err
}

func inviteUnusable(row inviteLinkRow, now time.Time) string {
	if row.revoked != nil {
		return "Ссылка отозвана"
	}
	if row.expires != nil && !row.expires.After(now) {
		return "Срок ссылки истёк"
	}
	if row.maxUses != nil && row.uses >= *row.maxUses {
		return "Лимит использований исчерпан"
	}
	return ""
}

func inviteLinkJSON(row inviteLinkRow) map[string]any {
	out := map[string]any{
		"token":           row.token,
		"conversation_id": row.convID,
		"title":           row.title,
		"avatar_url":      row.avatar,
		"member_count":    row.members,
		"max_members":     maxGroupMembers,
		"uses":            row.uses,
		"created_at":      row.created.UTC().Format(time.RFC3339Nano),
		"path":            "/app/join/" + row.token,
	}
	if row.expires != nil {
		out["expires_at"] = row.expires.UTC().Format(time.RFC3339Nano)
	}
	if row.maxUses != nil {
		out["max_uses"] = *row.maxUses
	}
	if row.revoked != nil {
		out["revoked_at"] = row.revoked.UTC().Format(time.RFC3339Nano)
	}
	return out
}

// CreateInviteLink POST /v1/conversations/{id}/invite-links
func (s *Service) CreateInviteLink(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	convID := chi.URLParam(r, "id")
	if !s.isMember(r, uid, convID) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return
	}
	allowed, isGroup := s.mayAct(r, uid, convID, "add")
	if !isGroup {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Это не группа")
		return
	}
	if !allowed {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "Недостаточно прав, чтобы приглашать")
		return
	}
	var req struct {
		ExpiresInHours *int `json:"expires_in_hours"`
		MaxUses        *int `json:"max_uses"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil && r.ContentLength > 0 {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	var expires any
	if req.ExpiresInHours != nil {
		h := *req.ExpiresInHours
		if h < 1 || h > 24*365 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Срок ссылки: 1…8760 часов")
			return
		}
		expires = time.Now().UTC().Add(time.Duration(h) * time.Hour)
	}
	var maxUses any
	if req.MaxUses != nil {
		if *req.MaxUses < 1 || *req.MaxUses > 100000 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "max_uses 1…100000")
			return
		}
		maxUses = *req.MaxUses
	}
	token, err := newInviteToken()
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, err = s.pool.Exec(r.Context(), `
		INSERT INTO group_invite_links (token, conversation_id, created_by, expires_at, max_uses)
		VALUES ($1, $2::uuid, $3::uuid, $4, $5)`, token, convID, uid, expires, maxUses)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	row, err := s.loadInviteLink(r, token)
	if err != nil {
		apiutil.JSON(w, http.StatusCreated, map[string]any{"token": token, "path": "/app/join/" + token, "conversation_id": convID})
		return
	}
	apiutil.JSON(w, http.StatusCreated, inviteLinkJSON(row))
}

// ListInviteLinks GET /v1/conversations/{id}/invite-links
func (s *Service) ListInviteLinks(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	convID := chi.URLParam(r, "id")
	if !s.isMember(r, uid, convID) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT l.token, l.conversation_id::text, COALESCE(c.title,''), COALESCE(c.avatar_url,''),
		       (SELECT COUNT(*)::int FROM conversation_members m WHERE m.conversation_id = c.id),
		       l.created_at, l.expires_at, l.max_uses, l.uses, l.revoked_at
		FROM group_invite_links l
		JOIN conversations c ON c.id = l.conversation_id
		WHERE l.conversation_id = $1::uuid AND l.revoked_at IS NULL
		ORDER BY l.created_at DESC
		LIMIT 50`, convID)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var row inviteLinkRow
		if err := rows.Scan(&row.token, &row.convID, &row.title, &row.avatar, &row.members, &row.created, &row.expires, &row.maxUses, &row.uses, &row.revoked); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items = append(items, inviteLinkJSON(row))
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// RevokeInviteLink DELETE /v1/conversations/{id}/invite-links/{token}
func (s *Service) RevokeInviteLink(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	convID := chi.URLParam(r, "id")
	token := chi.URLParam(r, "token")
	if !s.isMember(r, uid, convID) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return
	}
	var createdBy *string
	err := s.pool.QueryRow(r.Context(), `
		SELECT created_by::text FROM group_invite_links
		WHERE token=$1 AND conversation_id=$2::uuid AND revoked_at IS NULL`, token, convID).Scan(&createdBy)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "Ссылка не найдена")
		return
	}
	role := s.roleOf(r, uid, convID)
	if !staffRole(role) && (createdBy == nil || *createdBy != uid) {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "Недостаточно прав")
		return
	}
	_, err = s.pool.Exec(r.Context(), `
		UPDATE group_invite_links SET revoked_at=now()
		WHERE token=$1 AND conversation_id=$2::uuid AND revoked_at IS NULL`, token, convID)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// PreviewInviteLink GET /v1/invite-links/{token}
func (s *Service) PreviewInviteLink(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	token := strings.TrimSpace(chi.URLParam(r, "token"))
	row, err := s.loadInviteLink(r, token)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "Ссылка не найдена")
		return
	}
	if reason := inviteUnusable(row, time.Now()); reason != "" {
		apiutil.Error(w, http.StatusGone, "invite_invalid", reason)
		return
	}
	out := inviteLinkJSON(row)
	out["already_member"] = s.isMember(r, uid, row.convID)
	if row.title == "" {
		out["title"] = "Группа"
	}
	apiutil.JSON(w, http.StatusOK, out)
}

// JoinInviteLink POST /v1/invite-links/{token}/join
func (s *Service) JoinInviteLink(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	token := strings.TrimSpace(chi.URLParam(r, "token"))
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	var convID string
	var expires *time.Time
	var maxUses *int
	var uses int
	var revoked *time.Time
	err = tx.QueryRow(r.Context(), `
		SELECT conversation_id::text, expires_at, max_uses, uses, revoked_at
		FROM group_invite_links WHERE token=$1 FOR UPDATE`, token).
		Scan(&convID, &expires, &maxUses, &uses, &revoked)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "Ссылка не найдена")
		return
	}
	row := inviteLinkRow{expires: expires, maxUses: maxUses, uses: uses, revoked: revoked}
	if reason := inviteUnusable(row, time.Now()); reason != "" {
		apiutil.Error(w, http.StatusGone, "invite_invalid", reason)
		return
	}
	var already bool
	_ = tx.QueryRow(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM conversation_members WHERE conversation_id=$1::uuid AND user_id=$2::uuid)`,
		convID, uid).Scan(&already)
	if already {
		if err := tx.Commit(r.Context()); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "already": true, "conversation_id": convID})
		return
	}
	var n int
	if err := tx.QueryRow(r.Context(), `
		SELECT COUNT(*)::int FROM conversation_members WHERE conversation_id=$1::uuid`, convID).Scan(&n); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if n >= maxGroupMembers {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Группа заполнена — максимум 256")
		return
	}
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO conversation_members (conversation_id, user_id, role)
		VALUES ($1::uuid, $2::uuid, 'member')`, convID, uid); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `
		UPDATE group_invite_links SET uses = uses + 1 WHERE token=$1`, token); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `
		UPDATE conversations SET updated_at=now() WHERE id=$1::uuid`, convID); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "conversation_id": convID})
}
