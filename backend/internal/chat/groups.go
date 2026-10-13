package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/activity"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/presence"
	"github.com/jackc/pgx/v5"
)

func applyPresence(dst map[string]any, seen *time.Time, gender *string) {
	if seen == nil || seen.IsZero() {
		return
	}
	g := ""
	if gender != nil {
		g = *gender
	}
	dst["last_seen_at"] = seen.UTC().Format(time.RFC3339Nano)
	dst["last_seen_label"] = presence.Label(*seen, g, time.Now())
}

// isDirectChat reports a 1:1 thread. An explicit is_group flag stays a group.
// Extra bot rows must not turn a two-human chat into a group just because member_count > 2.
func isDirectChat(groupFlag bool, humanMembers int) bool {
	if groupFlag {
		return false
	}
	return humanMembers <= 2
}

func directPeerMap(id, username, display, avatar string, verified bool, seen *time.Time, gender *string, isBot bool, deleted, purged *time.Time) map[string]any {
	if username == "" {
		username = "user"
	}
	if display == "" {
		display = username
	}
	gone := deleted != nil || purged != nil
	if gone {
		display = "Удалённый аккаунт"
	}
	m := map[string]any{
		"id": id, "username": username, "display_name": display, "avatar_url": avatar,
		"is_verified": verified, "is_bot": isBot,
	}
	if gone {
		m["is_deleted"] = true
		return m
	}
	if !isBot {
		applyPresence(m, seen, gender)
	}
	return m
}

// humanSpeakerPeer finds a non-bot who actually spoke, preferring a live account.
// Used when the membership join would otherwise surface a bot (username "chat").
func (s *Service) humanSpeakerPeer(ctx context.Context, convID, uid string) (map[string]any, bool) {
	var id uuid.UUID
	var username, display, avatar string
	var verified bool
	var seen *time.Time
	var gender *string
	var deleted, purged *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT u.id, u.username, u.display_name, COALESCE(u.avatar_url,''), COALESCE(u.is_verified,false),
		       u.last_seen_at, u.gender, u.deleted_at, u.purged_at
		FROM messages m
		JOIN users u ON u.id = m.sender_id
		WHERE m.conversation_id = $1::uuid AND m.sender_id <> $2::uuid
		  AND COALESCE(u.is_bot, false) = false
		ORDER BY (u.deleted_at IS NULL AND u.purged_at IS NULL) DESC, m.created_at DESC
		LIMIT 1`, convID, uid).Scan(&id, &username, &display, &avatar, &verified, &seen, &gender, &deleted, &purged)
	if err != nil {
		return nil, false
	}
	return directPeerMap(id.String(), username, display, avatar, verified, seen, gender, false, deleted, purged), true
}

func (s *Service) peerForDirect(ctx context.Context, convID, uid string, scanned map[string]any, scannedIsBot bool) map[string]any {
	if scanned != nil && !scannedIsBot {
		return scanned
	}
	if alt, ok := s.humanSpeakerPeer(ctx, convID, uid); ok {
		return alt
	}
	if scanned != nil {
		return scanned
	}
	return map[string]any{
		"id": "", "username": "Удалённый аккаунт", "display_name": "Удалённый аккаунт",
		"avatar_url": "", "is_verified": false, "is_bot": false, "is_deleted": true,
	}
}

func (s *Service) isGroupAdmin(r *http.Request, uid, convID string) bool {
	return staffRole(s.roleOf(r, uid, convID))
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
		if len(invitees) >= maxGroupMembers-1 {
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
		VALUES ($1, $2::uuid, 'owner')`, nid, uid); err != nil {
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
	_, _ = s.pool.Exec(r.Context(), `UPDATE users SET last_seen_at=now() WHERE id=$1::uuid`, uid)
	rows, err := s.pool.Query(r.Context(), `
		SELECT u.id::text, u.username, u.display_name, COALESCE(u.avatar_url,''), COALESCE(cm.role,'member'),
		       u.last_seen_at,
		       (u.last_seen_at IS NOT NULL AND u.last_seen_at > now() - interval '90 seconds')
		FROM conversation_members cm
		JOIN users u ON u.id = cm.user_id AND u.deleted_at IS NULL
		WHERE cm.conversation_id = $1::uuid
		ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, cm.joined_at`, convID)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, uname, display, avatar, role string
		var seenAt *time.Time
		var online bool
		if err := rows.Scan(&id, &uname, &display, &avatar, &role, &seenAt, &online); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		item := map[string]any{
			"id": id, "username": uname, "display_name": display, "avatar_url": avatar,
			"role": role, "online": online,
		}
		if seenAt != nil {
			item["last_seen_at"] = seenAt.UTC().Format(time.RFC3339Nano)
		}
		items = append(items, item)
	}
	var title, avatarURL, permSend, permAdd, permInfo, permPin string
	var isGroup bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(is_group,false), COALESCE(title,''), COALESCE(avatar_url,''),
		       COALESCE(perm_send,'all'), COALESCE(perm_add,'all'), COALESCE(perm_info,'admins'), COALESCE(perm_pin,'all')
		FROM conversations WHERE id=$1::uuid`, convID).Scan(&isGroup, &title, &avatarURL, &permSend, &permAdd, &permInfo, &permPin)
	myRole := s.roleOf(r, uid, convID)
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"items": items, "is_group": isGroup, "title": title, "avatar_url": avatarURL,
		"member_count": len(items), "max_members": maxGroupMembers,
		"am_admin": staffRole(myRole), "my_role": myRole,
		"can_invite":    isGroup && permAllows(permAdd, myRole),
		"can_edit_info": isGroup && permAllows(permInfo, myRole),
		"can_pin":       isGroup && permAllows(permPin, myRole),
		"permissions": map[string]any{
			"send": permSend, "add": permAdd, "info": permInfo, "pin": permPin,
		},
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
	allowed, isGroup := s.mayAct(r, uid, convID, "add")
	if !isGroup {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Это не группа")
		return
	}
	if !allowed {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "Недостаточно прав, чтобы приглашать")
		return
	}
	if s.groupMemberCount(r, convID) >= maxGroupMembers {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Группа заполнена — максимум 256")
		return
	}
	var title, avatar string
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(title,''), COALESCE(avatar_url,'')
		FROM conversations WHERE id=$1::uuid`, convID).Scan(&title, &avatar)
	if err != nil {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Это не группа")
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
	actorRole := s.roleOf(r, uid, convID)
	targetRole := s.roleOf(r, target, convID)
	if targetRole == "" {
		apiutil.Error(w, http.StatusNotFound, "not_found", "Участник не найден")
		return
	}
	if !leaving {
		if !staffRole(actorRole) {
			apiutil.Error(w, http.StatusForbidden, "forbidden", "Недостаточно прав")
			return
		}
		if targetRole == "owner" {
			apiutil.Error(w, http.StatusForbidden, "forbidden", "Нельзя исключить владельца")
			return
		}
		if targetRole == "admin" && actorRole != "owner" {
			apiutil.Error(w, http.StatusForbidden, "forbidden", "Админа может снять только владелец")
			return
		}
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(), `
		DELETE FROM conversation_members WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, target); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	transferred := false
	if leaving && actorRole == "owner" {
		tag, err := tx.Exec(r.Context(), `
			UPDATE conversation_members SET role='owner'
			WHERE conversation_id=$1::uuid
			  AND user_id = (
			    SELECT user_id FROM conversation_members
			    WHERE conversation_id=$1::uuid
			    ORDER BY (role='admin') DESC, joined_at ASC
			    LIMIT 1
			  )`, convID)
		if err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		transferred = tag.RowsAffected() > 0
	}
	_, _ = tx.Exec(r.Context(), `
		DELETE FROM conversation_invites WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, target)
	if err := tx.Commit(r.Context()); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "transferred": transferred})
}

// SetMemberRole PATCH /v1/conversations/{id}/members/{userId} {role: admin|member}
func (s *Service) SetMemberRole(w http.ResponseWriter, r *http.Request) {
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
	if s.roleOf(r, uid, convID) != "owner" {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "Только владелец назначает роли")
		return
	}
	if target == uid {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Нельзя сменить свою роль")
		return
	}
	var req struct {
		Role string `json:"role"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	role := strings.TrimSpace(req.Role)
	if role != "admin" && role != "member" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Роль: admin или member")
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE conversation_members SET role=$3
		WHERE conversation_id=$1::uuid AND user_id=$2::uuid AND role <> 'owner'`, convID, target, role)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "Участник не найден")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "role": role})
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
	if s.groupMemberCount(r, convID) >= maxGroupMembers {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Группа заполнена — максимум 256")
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
	s.noteDelivered(r.Context(), uid, "")
	folder := strings.TrimSpace(r.URL.Query().Get("folder"))
	includeArchived := r.URL.Query().Get("archived") == "1"
	rows, err := s.pool.Query(r.Context(), `
		SELECT c.id, c.updated_at,
		       COALESCE(c.is_group,false), COALESCE(c.title,''), COALESCE(c.avatar_url,''),
		       (SELECT COUNT(*)::int FROM conversation_members m WHERE m.conversation_id = c.id),
		       (SELECT COUNT(*)::int FROM conversation_members hm
		         JOIN users hu ON hu.id = hm.user_id
		         WHERE hm.conversation_id = c.id
		           AND hu.deleted_at IS NULL AND hu.purged_at IS NULL
		           AND COALESCE(hu.is_bot,false)=false),
		       peer.id, peer.username, peer.display_name, COALESCE(peer.avatar_url,''), COALESCE(peer.is_verified,false),
		       peer.last_seen_at, peer.gender, COALESCE(peer.is_bot,false), peer.deleted_at, peer.purged_at,
		       lm.id, lm.body, lm.sender_id, lm.created_at, COALESCE(lm.msg_type,'text'), lm.call_meta,
		       COALESCE((
		         SELECT COUNT(*)::int FROM messages m
		         WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
		           AND m.sender_id <> $1::uuid
		           AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at)
		           AND NOT EXISTS (
		             SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = $1::uuid
		           )
		       ), 0),
		       me.pinned_at, me.archived_at, COALESCE(me.folder,'inbox')
		FROM conversation_members me
		JOIN conversations c ON c.id = me.conversation_id
		LEFT JOIN LATERAL (
		  SELECT u.id, u.username, u.display_name, u.avatar_url, COALESCE(u.is_verified,false) AS is_verified, u.last_seen_at, u.gender,
		         COALESCE(u.is_bot,false) AS is_bot, u.deleted_at, u.purged_at
		  FROM conversation_members om
		  JOIN users u ON u.id = om.user_id
		  WHERE om.conversation_id = c.id AND om.user_id <> $1::uuid
		  ORDER BY CASE
		    WHEN u.deleted_at IS NULL AND u.purged_at IS NULL AND COALESCE(u.is_bot,false)=false THEN 0
		    WHEN COALESCE(u.is_bot,false)=false THEN 1
		    ELSE 2
		  END, om.joined_at ASC
		  LIMIT 1
		) peer ON true
		LEFT JOIN LATERAL (
		  SELECT m.id,
		         CASE WHEN m.msg_type='poll' THEN COALESCE(NULLIF(m.body,''), '📊 Опрос') ELSE m.body END AS body,
		         m.sender_id, m.created_at, m.msg_type, m.call_meta FROM messages m
		  WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
		    AND NOT EXISTS (
		      SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = $1::uuid
		    )
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
		var memberCount, humanCount int
		var peerID *uuid.UUID
		var peerUsername, peerDisplay, peerAvatar *string
		var peerVerified, peerIsBot bool
		var peerSeen *time.Time
		var peerGender *string
		var peerDeleted, peerPurged *time.Time
		var lastID *uuid.UUID
		var lastBody *string
		var lastSender *uuid.UUID
		var lastCreated *time.Time
		var lastMsgType string
		var lastCallMeta []byte
		var unread int
		var pinnedAt, archivedAt *time.Time
		var folderVal string
		if err := rows.Scan(&cid, &updated, &isGroup, &title, &gAvatar, &memberCount, &humanCount, &peerID, &peerUsername, &peerDisplay, &peerAvatar, &peerVerified, &peerSeen, &peerGender, &peerIsBot, &peerDeleted, &peerPurged, &lastID, &lastBody, &lastSender, &lastCreated, &lastMsgType, &lastCallMeta, &unread, &pinnedAt, &archivedAt, &folderVal); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		if folder != "" && folderVal != folder {
			continue
		}
		if !includeArchived && folder == "" && archivedAt != nil {
			continue
		}
		isGroup = !isDirectChat(isGroup, humanCount)
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
			item["peer"] = map[string]any{"id": cid.String(), "username": "group", "display_name": d, "avatar_url": gAvatar, "is_bot": false}
		} else {
			var scanned map[string]any
			if peerID != nil && peerUsername != nil && peerDisplay != nil {
				av := ""
				if peerAvatar != nil {
					av = *peerAvatar
				}
				scanned = directPeerMap(peerID.String(), *peerUsername, *peerDisplay, av, peerVerified, peerSeen, peerGender, peerIsBot, peerDeleted, peerPurged)
			}
			item["peer"] = s.peerForDirect(r.Context(), cid.String(), uid, scanned, peerIsBot)
		}
		if lastID != nil && lastBody != nil && lastSender != nil && lastCreated != nil {
			lm := map[string]any{
				"id": lastID.String(), "body": *lastBody, "sender_id": lastSender.String(),
				"created_at": lastCreated.UTC().Format(time.RFC3339Nano), "msg_type": lastMsgType,
			}
			if len(lastCallMeta) > 0 {
				var meta any
				if json.Unmarshal(lastCallMeta, &meta) == nil {
					lm["call_meta"] = meta
				}
			}
			item["last_message"] = lm
		}
		items = append(items, item)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Service) conversationItem(r *http.Request, uid, convID string) (map[string]any, error) {
	var updated time.Time
	var isGroup bool
	var title, groupAvatar string
	var memberCount, humanCount, unread int
	err := s.pool.QueryRow(r.Context(), `
		SELECT c.updated_at, COALESCE(c.is_group,false), COALESCE(c.title,''), COALESCE(c.avatar_url,''),
		       (SELECT COUNT(*)::int FROM conversation_members m WHERE m.conversation_id = c.id),
		       (SELECT COUNT(*)::int FROM conversation_members hm
		         JOIN users hu ON hu.id = hm.user_id
		         WHERE hm.conversation_id = c.id
		           AND hu.deleted_at IS NULL AND hu.purged_at IS NULL
		           AND COALESCE(hu.is_bot,false)=false),
		       COALESCE((
		         SELECT COUNT(*)::int FROM messages m
		         WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
		           AND m.sender_id <> $1::uuid
		           AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at)
		           AND NOT EXISTS (
		             SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = $1::uuid
		           )
		       ), 0)
		FROM conversations c
		JOIN conversation_members me ON me.conversation_id = c.id AND me.user_id = $1::uuid
		WHERE c.id = $2::uuid`, uid, convID).
		Scan(&updated, &isGroup, &title, &groupAvatar, &memberCount, &humanCount, &unread)
	if err != nil {
		return nil, err
	}
	isGroup = !isDirectChat(isGroup, humanCount)
	item := map[string]any{
		"id": convID, "updated_at": updated.UTC().Format(time.RFC3339Nano), "unread": unread,
		"is_group": isGroup, "title": title, "avatar_url": groupAvatar, "member_count": memberCount,
	}
	if isGroup {
		d := title
		if d == "" {
			d = "Группа"
		}
		item["peer"] = map[string]any{"id": convID, "username": "group", "display_name": d, "avatar_url": groupAvatar, "is_bot": false}
		return item, nil
	}
	var peerID uuid.UUID
	var peerUsername, peerDisplay, peerAvatar string
	var peerVerified, peerIsBot bool
	var peerSeen *time.Time
	var peerGender *string
	var peerDeleted, peerPurged *time.Time
	err = s.pool.QueryRow(r.Context(), `
		SELECT peer.id, peer.username, peer.display_name, COALESCE(peer.avatar_url,''), COALESCE(peer.is_verified,false),
		       peer.last_seen_at, peer.gender, COALESCE(peer.is_bot,false), peer.deleted_at, peer.purged_at
		FROM conversation_members other
		JOIN users peer ON peer.id = other.user_id
		WHERE other.conversation_id = $1::uuid AND other.user_id <> $2::uuid
		ORDER BY CASE
		  WHEN peer.deleted_at IS NULL AND peer.purged_at IS NULL AND COALESCE(peer.is_bot,false)=false THEN 0
		  WHEN COALESCE(peer.is_bot,false)=false THEN 1
		  ELSE 2
		END, other.joined_at ASC
		LIMIT 1`, convID, uid).Scan(&peerID, &peerUsername, &peerDisplay, &peerAvatar, &peerVerified, &peerSeen, &peerGender, &peerIsBot, &peerDeleted, &peerPurged)
	if err != nil {
		if alt, ok := s.humanSpeakerPeer(r.Context(), convID, uid); ok {
			item["peer"] = alt
			return item, nil
		}
		return nil, err
	}
	scanned := directPeerMap(peerID.String(), peerUsername, peerDisplay, peerAvatar, peerVerified, peerSeen, peerGender, peerIsBot, peerDeleted, peerPurged)
	item["peer"] = s.peerForDirect(r.Context(), convID, uid, scanned, peerIsBot)
	return item, nil
}
