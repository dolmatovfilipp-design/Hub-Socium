package chat

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/activity"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5"
)

func (s *Service) isGroupAdmin(r *http.Request, uid, convID string) bool {
	var role string
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(role,'member') FROM conversation_members
		WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, uid).Scan(&role)
	return err == nil && role == "admin"
}

// CreateGroup POST /v1/conversations/group
func (s *Service) CreateGroup(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Title     string   `json:"title"`
		AvatarURL string   `json:"avatar_url"`
		MemberIDs []string `json:"member_ids"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" || utf8.RuneCountInString(title) > 80 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "title 1–80 chars")
		return
	}
	avatar := strings.TrimSpace(req.AvatarURL)
	if utf8.RuneCountInString(avatar) > 500 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "avatar_url too long")
		return
	}

	seen := map[string]struct{}{}
	var invitees []string
	for _, id := range req.MemberIDs {
		id = strings.TrimSpace(id)
		if id == "" || id == uid {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		invitees = append(invitees, id)
		if len(invitees) >= 40 {
			break
		}
	}

	nid := uuid.New()
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	var av any
	if avatar != "" {
		av = avatar
	}
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO conversations (id, is_group, title, avatar_url, created_by)
		VALUES ($1, true, $2, $3, $4::uuid)`, nid, title, av, uid); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO conversation_members (conversation_id, user_id, role)
		VALUES ($1, $2::uuid, 'admin')`, nid, uid); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	act := activity.NewService(s.pool)
	for _, mid := range invitees {
		var exists bool
		_ = s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1::uuid AND deleted_at IS NULL)`, mid).Scan(&exists)
		if !exists || s.isBlockedEither(r, uid, mid) {
			continue
		}
		_, _ = s.pool.Exec(r.Context(), `
			INSERT INTO conversation_invites (conversation_id, user_id, invited_by)
			VALUES ($1, $2::uuid, $3::uuid)
			ON CONFLICT DO NOTHING`, nid, mid, uid)
		_ = act.Insert(r.Context(), mid, uid, "group_invite", nil, map[string]any{
			"conversation_id": nid.String(),
			"title":           title,
			"avatar_url":      avatar,
		})
	}

	item, err := s.conversationItem(r, uid, nid.String())
	if err != nil {
		apiutil.JSON(w, http.StatusCreated, map[string]any{
			"id": nid.String(), "is_group": true, "title": title, "avatar_url": avatar, "unread": 0,
			"peer": map[string]any{"id": nid.String(), "username": "group", "display_name": title, "avatar_url": avatar},
		})
		return
	}
	apiutil.JSON(w, http.StatusCreated, item)
}

// ListMembers GET /v1/conversations/{id}/members
func (s *Service) ListMembers(w http.ResponseWriter, r *http.Request) {
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
		SELECT u.id::text, u.username, u.display_name, COALESCE(u.avatar_url,''), COALESCE(cm.role,'member')
		FROM conversation_members cm
		JOIN users u ON u.id = cm.user_id AND u.deleted_at IS NULL
		WHERE cm.conversation_id = $1::uuid
		ORDER BY CASE WHEN cm.role='admin' THEN 0 ELSE 1 END, cm.joined_at`, convID)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, uname, display, avatar, role string
		if err := rows.Scan(&id, &uname, &display, &avatar, &role); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": id, "username": uname, "display_name": display, "avatar_url": avatar, "role": role,
		})
	}
	var title, avatarURL string
	var isGroup bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(is_group,false), COALESCE(title,''), COALESCE(avatar_url,'')
		FROM conversations WHERE id=$1::uuid`, convID).Scan(&isGroup, &title, &avatarURL)
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"items": items, "is_group": isGroup, "title": title, "avatar_url": avatarURL,
		"am_admin": s.isGroupAdmin(r, uid, convID),
	})
}

// InviteMembers POST /v1/conversations/{id}/members
func (s *Service) InviteMembers(w http.ResponseWriter, r *http.Request) {
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
	var isGroup bool
	var title, avatar string
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(is_group,false), COALESCE(title,''), COALESCE(avatar_url,'')
		FROM conversations WHERE id=$1::uuid`, convID).Scan(&isGroup, &title, &avatar)
	if err != nil || !isGroup {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "not a group")
		return
	}
	var req struct {
		UserIDs []string `json:"user_ids"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	act := activity.NewService(s.pool)
	invited := 0
	for _, mid := range req.UserIDs {
		mid = strings.TrimSpace(mid)
		if mid == "" || mid == uid {
			continue
		}
		if s.isMember(r, mid, convID) {
			continue
		}
		var exists bool
		_ = s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1::uuid AND deleted_at IS NULL)`, mid).Scan(&exists)
		if !exists || s.isBlockedEither(r, uid, mid) {
			continue
		}
		tag, err := s.pool.Exec(r.Context(), `
			INSERT INTO conversation_invites (conversation_id, user_id, invited_by)
			VALUES ($1::uuid, $2::uuid, $3::uuid)
			ON CONFLICT DO NOTHING`, convID, mid, uid)
		if err != nil {
			continue
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		_ = act.Insert(r.Context(), mid, uid, "group_invite", nil, map[string]any{
			"conversation_id": convID,
			"title":           title,
			"avatar_url":      avatar,
		})
		invited++
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "invited": invited})
}

// KickMember DELETE /v1/conversations/{id}/members/{userId}
func (s *Service) KickMember(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	convID := chi.URLParam(r, "id")
	target := chi.URLParam(r, "userId")
	if !s.isMember(r, uid, convID) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return
	}
	var isGroup bool
	_ = s.pool.QueryRow(r.Context(), `SELECT COALESCE(is_group,false) FROM conversations WHERE id=$1::uuid`, convID).Scan(&isGroup)
	if !isGroup {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "not a group")
		return
	}
	leaving := target == uid
	if !leaving && !s.isGroupAdmin(r, uid, convID) {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "admin only")
		return
	}
	if !leaving {
		var trole string
		_ = s.pool.QueryRow(r.Context(), `
			SELECT COALESCE(role,'member') FROM conversation_members
			WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, target).Scan(&trole)
		if trole == "admin" {
			apiutil.Error(w, http.StatusForbidden, "forbidden", "cannot kick admin")
			return
		}
	}
	_, err := s.pool.Exec(r.Context(), `
		DELETE FROM conversation_members WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, target)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, _ = s.pool.Exec(r.Context(), `
		DELETE FROM conversation_invites WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, target)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// AcceptGroupInvite POST /v1/conversations/{id}/invites/accept
func (s *Service) AcceptGroupInvite(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	convID := chi.URLParam(r, "id")
	var isGroup bool
	err := s.pool.QueryRow(r.Context(), `SELECT COALESCE(is_group,false) FROM conversations WHERE id=$1::uuid`, convID).Scan(&isGroup)
	if err != nil || !isGroup {
		apiutil.Error(w, http.StatusNotFound, "not_found", "group not found")
		return
	}
	var invitedBy string
	err = s.pool.QueryRow(r.Context(), `
		SELECT invited_by::text FROM conversation_invites
		WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, uid).Scan(&invitedBy)
	if err == pgx.ErrNoRows {
		if s.isMember(r, uid, convID) {
			apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "already": true, "conversation_id": convID})
			return
		}
		apiutil.Error(w, http.StatusNotFound, "not_found", "invite not found")
		return
	} else if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, err = s.pool.Exec(r.Context(), `
		INSERT INTO conversation_members (conversation_id, user_id, role)
		VALUES ($1::uuid, $2::uuid, 'member')
		ON CONFLICT DO NOTHING`, convID, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, _ = s.pool.Exec(r.Context(), `
		DELETE FROM conversation_invites WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, uid)
	_, _ = s.pool.Exec(r.Context(), `
		UPDATE activities SET read_at = COALESCE(read_at, now())
		WHERE user_id=$1::uuid AND type='group_invite'
		  AND meta->>'conversation_id'=$2`, uid, convID)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "conversation_id": convID})
}

// DeclineGroupInvite POST /v1/conversations/{id}/invites/decline
func (s *Service) DeclineGroupInvite(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	convID := chi.URLParam(r, "id")
	_, _ = s.pool.Exec(r.Context(), `
		DELETE FROM conversation_invites WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, uid)
	_, _ = s.pool.Exec(r.Context(), `
		UPDATE activities SET read_at = COALESCE(read_at, now())
		WHERE user_id=$1::uuid AND type='group_invite'
		  AND meta->>'conversation_id'=$2`, uid, convID)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true})
}


// ListConversations — group-aware inbox list
func (s *Service) ListConversations(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	folder := strings.TrimSpace(r.URL.Query().Get("folder"))
	includeArchived := r.URL.Query().Get("archived") == "1"
	rows, err := s.pool.Query(r.Context(), `
		SELECT c.id, c.updated_at,
		       COALESCE(c.is_group,false), COALESCE(c.title,''), COALESCE(c.avatar_url,''),
		       (SELECT COUNT(*)::int FROM conversation_members m WHERE m.conversation_id = c.id),
		       peer.id, peer.username, peer.display_name, COALESCE(peer.avatar_url,''),
		       lm.id, lm.body, lm.sender_id, lm.created_at,
		       COALESCE((
		         SELECT COUNT(*)::int FROM messages m
		         WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
		           AND m.sender_id <> $1::uuid
		           AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at)
		       ), 0),
		       me.pinned_at, me.archived_at, COALESCE(me.folder,'inbox')
		FROM conversation_members me
		JOIN conversations c ON c.id = me.conversation_id
		LEFT JOIN LATERAL (
		  SELECT u.id, u.username, u.display_name, u.avatar_url
		  FROM conversation_members om
		  JOIN users u ON u.id = om.user_id AND u.deleted_at IS NULL
		  WHERE om.conversation_id = c.id AND om.user_id <> $1::uuid
		  ORDER BY om.joined_at ASC LIMIT 1
		) peer ON true
		LEFT JOIN LATERAL (
		  SELECT m.id, m.body, m.sender_id, m.created_at FROM messages m
		  WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
		  ORDER BY m.created_at DESC, m.id DESC LIMIT 1
		) lm ON true
		WHERE me.user_id = $1::uuid AND COALESCE(c.is_saved,false)=false
		ORDER BY me.pinned_at DESC NULLS LAST, c.updated_at DESC LIMIT 100`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var cid uuid.UUID
		var updated time.Time
		var isGroup bool
		var title, gAvatar string
		var memberCount int
		var peerID *uuid.UUID
		var peerUsername, peerDisplay, peerAvatar *string
		var lastID *uuid.UUID
		var lastBody *string
		var lastSender *uuid.UUID
		var lastCreated *time.Time
		var unread int
		var pinnedAt, archivedAt *time.Time
		var folderVal string
		if err := rows.Scan(&cid, &updated, &isGroup, &title, &gAvatar, &memberCount, &peerID, &peerUsername, &peerDisplay, &peerAvatar, &lastID, &lastBody, &lastSender, &lastCreated, &unread, &pinnedAt, &archivedAt, &folderVal); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		if folder != "" && folderVal != folder {
			continue
		}
		if !includeArchived && folder == "" && archivedAt != nil {
			continue
		}
		if memberCount > 2 {
			isGroup = true
		}
		item := map[string]any{
			"id": cid.String(), "updated_at": updated.UTC().Format(time.RFC3339Nano), "unread": unread,
			"pinned": pinnedAt != nil, "archived": archivedAt != nil, "folder": folderVal,
			"is_group": isGroup, "title": title, "avatar_url": gAvatar, "member_count": memberCount,
		}
		if isGroup {
			d := title
			if d == "" {
				d = "Группа"
			}
			item["peer"] = map[string]any{"id": cid.String(), "username": "group", "display_name": d, "avatar_url": gAvatar}
		} else if peerID != nil && peerUsername != nil && peerDisplay != nil {
			av := ""
			if peerAvatar != nil {
				av = *peerAvatar
			}
			item["peer"] = map[string]any{"id": peerID.String(), "username": *peerUsername, "display_name": *peerDisplay, "avatar_url": av}
		} else {
			continue
		}
		if lastID != nil && lastBody != nil && lastSender != nil && lastCreated != nil {
			item["last_message"] = map[string]any{"id": lastID.String(), "body": *lastBody, "sender_id": lastSender.String(), "created_at": lastCreated.UTC().Format(time.RFC3339Nano)}
		}
		items = append(items, item)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Service) conversationItem(r *http.Request, uid, convID string) (map[string]any, error) {
	var updated time.Time
	var isGroup bool
	var title, groupAvatar string
	var memberCount, unread int
	err := s.pool.QueryRow(r.Context(), `
		SELECT c.updated_at, COALESCE(c.is_group,false), COALESCE(c.title,''), COALESCE(c.avatar_url,''),
		       (SELECT COUNT(*)::int FROM conversation_members m WHERE m.conversation_id = c.id),
		       COALESCE((
		         SELECT COUNT(*)::int FROM messages m
		         WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
		           AND m.sender_id <> $1::uuid
		           AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at)
		       ), 0)
		FROM conversations c
		JOIN conversation_members me ON me.conversation_id = c.id AND me.user_id = $1::uuid
		WHERE c.id = $2::uuid`, uid, convID).
		Scan(&updated, &isGroup, &title, &groupAvatar, &memberCount, &unread)
	if err != nil {
		return nil, err
	}
	if memberCount > 2 {
		isGroup = true
	}
	item := map[string]any{
		"id": convID, "updated_at": updated.UTC().Format(time.RFC3339Nano), "unread": unread,
		"is_group": isGroup, "title": title, "avatar_url": groupAvatar, "member_count": memberCount,
	}
	if isGroup {
		d := title
		if d == "" {
			d = "Группа"
		}
		item["peer"] = map[string]any{"id": convID, "username": "group", "display_name": d, "avatar_url": groupAvatar}
		return item, nil
	}
	var peerID uuid.UUID
	var peerUsername, peerDisplay, peerAvatar string
	err = s.pool.QueryRow(r.Context(), `
		SELECT peer.id, peer.username, peer.display_name, COALESCE(peer.avatar_url,'')
		FROM conversation_members other
		JOIN users peer ON peer.id = other.user_id
		WHERE other.conversation_id = $1::uuid AND other.user_id <> $2::uuid
		LIMIT 1`, convID, uid).Scan(&peerID, &peerUsername, &peerDisplay, &peerAvatar)
	if err != nil {
		return nil, err
	}
	item["peer"] = map[string]any{"id": peerID.String(), "username": peerUsername, "display_name": peerDisplay, "avatar_url": peerAvatar}
	return item, nil
}
