package chat

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
)

// allowedClientMsgType is the set SendMessage accepts. call/poll/e2e are written
// by their own flows; the live check also includes sticker, gif, location, contact.
func allowedClientMsgType(t string) bool {
	switch t {
	case "text", "voice", "image", "video_note", "video", "file", "sticker", "gif", "location", "contact":
		return true
	default:
		return false
	}
}

func editableMsgType(t string) bool {
	switch t {
	case "", "text", "image", "video", "file":
		return true
	default:
		return false
	}
}

func parseMetaObject(raw json.RawMessage) (map[string]any, []byte, int, string) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return nil, nil, 0, ""
	}
	if len(raw) > 4096 {
		return nil, nil, http.StatusUnprocessableEntity, "meta max 4096 bytes"
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil || m == nil {
		return nil, nil, http.StatusUnprocessableEntity, "meta must be a JSON object"
	}
	return m, []byte(trimmed), 0, ""
}

func strField(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	s, _ := m[key].(string)
	return strings.TrimSpace(s)
}

func floatField(m map[string]any, key string) (float64, bool) {
	if m == nil {
		return 0, false
	}
	v, ok := m[key]
	if !ok || v == nil {
		return 0, false
	}
	switch n := v.(type) {
	case float64:
		if math.IsNaN(n) || math.IsInf(n, 0) {
			return 0, false
		}
		return n, true
	case json.Number:
		f, err := n.Float64()
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return 0, false
		}
		return f, true
	default:
		return 0, false
	}
}

func usableMediaRef(s string) bool {
	return strings.HasPrefix(s, "/v1/media/") || strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")
}

// applyRichMessage fills defaults for sticker, gif, location, and contact.
// Other types pass through unchanged.
func applyRichMessage(msgType, body, media string, meta map[string]any) (string, string, int, string) {
	switch msgType {
	case "sticker", "gif":
		if media == "" {
			if u := strField(meta, "media_url"); u != "" {
				media = u
			} else if u := strField(meta, "url"); u != "" {
				media = u
			}
		}
		if media == "" || !usableMediaRef(media) {
			return body, media, http.StatusUnprocessableEntity, msgType + " requires media_url"
		}
		if body == "" {
			if msgType == "sticker" {
				body = "Стикер"
			} else {
				body = "GIF"
			}
		}
	case "location":
		lat, okLat := floatField(meta, "lat")
		lng, okLng := floatField(meta, "lng")
		if !okLat || !okLng || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
			return body, media, http.StatusUnprocessableEntity, "location requires lat and lng"
		}
		if body == "" {
			if title := strField(meta, "title"); title != "" {
				body = "📍 " + title
			} else {
				body = "📍 Местоположение"
			}
		}
	case "contact":
		name := strField(meta, "name")
		phone := strField(meta, "phone")
		if name == "" && phone == "" {
			return body, media, http.StatusUnprocessableEntity, "contact requires name or phone"
		}
		if utf8.RuneCountInString(name) > 80 || utf8.RuneCountInString(phone) > 32 {
			return body, media, http.StatusUnprocessableEntity, "contact name or phone is too long"
		}
		if id := strField(meta, "user_id"); id != "" {
			if _, err := uuid.Parse(id); err != nil {
				return body, media, http.StatusUnprocessableEntity, "contact user_id"
			}
		}
		if body == "" {
			if name != "" {
				body = "👤 " + name
			} else {
				body = "👤 Контакт"
			}
		}
	}
	return body, media, 0, ""
}

func normalizeSearchQuery(q string) (string, bool) {
	var b strings.Builder
	for _, r := range strings.TrimSpace(q) {
		if r == '\n' || r == '\r' || r == '\t' {
			b.WriteRune(' ')
			continue
		}
		if unicode.IsControl(r) {
			continue
		}
		b.WriteRune(r)
	}
	q = strings.Join(strings.Fields(b.String()), " ")
	n := utf8.RuneCountInString(q)
	if n < 2 || n > 80 {
		return "", false
	}
	return q, true
}

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

func likeContains(q string) string {
	return "%" + escapeLike(q) + "%"
}

// noteDelivered advances last_delivered_at when this device has seen messages
// it did not send. A no-op once the pointer is already current.
func (s *Service) noteDelivered(ctx context.Context, uid, convID string) {
	if convID == "" {
		_, _ = s.pool.Exec(ctx, `
			UPDATE conversation_members me
			SET last_delivered_at = now()
			WHERE me.user_id = $1::uuid
			  AND EXISTS (
			    SELECT 1 FROM messages m
			    WHERE m.conversation_id = me.conversation_id
			      AND m.deleted_at IS NULL
			      AND m.sender_id <> me.user_id
			      AND (me.last_delivered_at IS NULL OR m.created_at > me.last_delivered_at)
			  )`, uid)
		return
	}
	_, _ = s.pool.Exec(ctx, `
		UPDATE conversation_members me
		SET last_delivered_at = now()
		WHERE me.user_id = $1::uuid AND me.conversation_id = $2::uuid
		  AND EXISTS (
		    SELECT 1 FROM messages m
		    WHERE m.conversation_id = me.conversation_id
		      AND m.deleted_at IS NULL
		      AND m.sender_id <> me.user_id
		      AND (me.last_delivered_at IS NULL OR m.created_at > me.last_delivered_at)
		  )`, uid, convID)
}

// peerReceipts is the earliest pointer shared by every other member.
// NULL when the chat has no peer yet, or any peer has not caught up.
func (s *Service) peerReceipts(ctx context.Context, convID, uid string) (readAt, deliveredAt *time.Time) {
	_ = s.pool.QueryRow(ctx, `
		SELECT
		  CASE WHEN bool_and(last_read_at IS NOT NULL) THEN min(last_read_at) END,
		  CASE WHEN bool_and(last_delivered_at IS NOT NULL) THEN min(last_delivered_at) END
		FROM conversation_members
		WHERE conversation_id = $1::uuid AND user_id <> $2::uuid`, convID, uid).Scan(&readAt, &deliveredAt)
	return readAt, deliveredAt
}

// MarkDelivered POST /v1/conversations/{id}/delivered
func (s *Service) MarkDelivered(w http.ResponseWriter, r *http.Request) {
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
	_, err := s.pool.Exec(r.Context(), `
		UPDATE conversation_members
		SET last_delivered_at = now()
		WHERE conversation_id = $1::uuid AND user_id = $2::uuid`, convID, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HideMessage POST /v1/conversations/{id}/messages/{msgId}/hide — delete for me.
func (s *Service) HideMessage(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	convID := chi.URLParam(r, "id")
	msgID := chi.URLParam(r, "msgId")
	if !s.isMember(r, uid, convID) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		INSERT INTO message_hidden (user_id, message_id)
		SELECT $1::uuid, m.id
		FROM messages m
		WHERE m.id = $2::uuid AND m.conversation_id = $3::uuid AND m.deleted_at IS NULL
		ON CONFLICT (user_id, message_id) DO NOTHING`, uid, msgID, convID)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		var hidden bool
		_ = s.pool.QueryRow(r.Context(), `
			SELECT EXISTS(
			  SELECT 1 FROM message_hidden h
			  JOIN messages m ON m.id = h.message_id
			  WHERE h.user_id = $1::uuid AND h.message_id = $2::uuid AND m.conversation_id = $3::uuid
			)`, uid, msgID, convID).Scan(&hidden)
		if !hidden {
			apiutil.Error(w, http.StatusNotFound, "not_found", "message not found")
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// MessageReaders GET /v1/conversations/{id}/messages/{msgId}/readers
func (s *Service) MessageReaders(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	convID := chi.URLParam(r, "id")
	msgID := chi.URLParam(r, "msgId")
	if !s.isMember(r, uid, convID) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return
	}
	var sender string
	var created time.Time
	err := s.pool.QueryRow(r.Context(), `
		SELECT sender_id::text, created_at
		FROM messages m
		WHERE m.id = $1::uuid AND m.conversation_id = $2::uuid AND m.deleted_at IS NULL
		  AND NOT EXISTS (
		    SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = $3::uuid
		  )`, msgID, convID, uid).Scan(&sender, &created)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "message not found")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT u.id, u.username, COALESCE(NULLIF(u.display_name,''), u.username, ''),
		       COALESCE(u.avatar_url,''),
		       COALESCE((
		         SELECT MIN(rl.read_at) FROM conversation_read_log rl
		         WHERE rl.conversation_id = cm.conversation_id
		           AND rl.user_id = cm.user_id
		           AND rl.read_at >= $3
		       ), cm.last_read_at)
		FROM conversation_members cm
		JOIN users u ON u.id = cm.user_id AND u.deleted_at IS NULL
		WHERE cm.conversation_id = $1::uuid
		  AND cm.user_id <> $2::uuid
		  AND cm.last_read_at IS NOT NULL
		  AND cm.last_read_at >= $3
		ORDER BY cm.last_read_at ASC
		LIMIT 200`, convID, sender, created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id uuid.UUID
		var username, name, avatar string
		var readAt time.Time
		if err := rows.Scan(&id, &username, &name, &avatar, &readAt); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		item := map[string]any{
			"user_id": id.String(), "username": username, "display_name": name,
			"read_at": readAt.UTC().Format(time.RFC3339Nano),
		}
		if avatar != "" {
			item["avatar_url"] = avatar
		}
		items = append(items, item)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// SearchMessages GET /v1/messages/search?q=&conversation_id=
func (s *Service) SearchMessages(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	q, okq := normalizeSearchQuery(r.URL.Query().Get("q"))
	if !okq {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "q must be 2..80 characters")
		return
	}
	convID := strings.TrimSpace(r.URL.Query().Get("conversation_id"))
	if convID != "" {
		if _, err := uuid.Parse(convID); err != nil {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "conversation_id")
			return
		}
		if !s.isMember(r, uid, convID) {
			apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
			return
		}
	}
	limit := 20
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := atoiPos(v); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > 50 {
		limit = 50
	}
	cursorCreated, cursorID, hasCursor := decodeCursor(r.URL.Query().Get("cursor"))

	args := []any{uid, q, likeContains(q)}
	where := `
		m.deleted_at IS NULL
		AND (m.expires_at IS NULL OR m.expires_at > now())
		AND COALESCE(m.msg_type,'text') <> 'e2e'
		AND NOT EXISTS (
		  SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = $1::uuid
		)
		AND (
		  to_tsvector('russian', COALESCE(m.body,'')) @@ plainto_tsquery('russian', $2)
		  OR m.body ILIKE $3 ESCAPE '\'
		)`
	if convID != "" {
		args = append(args, convID)
		where += fmt.Sprintf(` AND m.conversation_id = $%d::uuid`, len(args))
	}
	if hasCursor {
		args = append(args, cursorCreated, cursorID)
		where += fmt.Sprintf(` AND (m.created_at, m.id) < ($%d::timestamptz, $%d::uuid)`, len(args)-1, len(args))
	}
	args = append(args, limit+1)
	sql := fmt.Sprintf(`
		SELECT m.id, m.conversation_id, m.sender_id, m.body, m.created_at,
		       COALESCE(m.msg_type,'text'),
		       COALESCE(NULLIF(u.display_name,''), u.username, ''),
		       COALESCE(c.is_group, false),
		       COALESCE(NULLIF(c.title,''), (
		         SELECT COALESCE(NULLIF(pu.display_name,''), pu.username, '')
		         FROM conversation_members pm
		         JOIN users pu ON pu.id = pm.user_id
		         WHERE pm.conversation_id = c.id AND pm.user_id <> $1::uuid
		         ORDER BY CASE
		           WHEN pu.deleted_at IS NULL AND pu.purged_at IS NULL AND COALESCE(pu.is_bot,false)=false THEN 0
		           WHEN COALESCE(pu.is_bot,false)=false THEN 1
		           ELSE 2
		         END, pm.joined_at ASC
		         LIMIT 1
		       ), '')
		FROM messages m
		JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = $1::uuid
		JOIN conversations c ON c.id = m.conversation_id
		LEFT JOIN users u ON u.id = m.sender_id
		WHERE %s
		ORDER BY m.created_at DESC, m.id DESC
		LIMIT $%d`, where, len(args))

	rows, err := s.pool.Query(r.Context(), sql, args...)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, conv, sender uuid.UUID
		var body, msgType, senderName, title string
		var created time.Time
		var isGroup bool
		if err := rows.Scan(&id, &conv, &sender, &body, &created, &msgType, &senderName, &isGroup, &title); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		item := map[string]any{
			"id": id.String(), "conversation_id": conv.String(), "sender_id": sender.String(),
			"body": body, "created_at": created.UTC().Format(time.RFC3339Nano),
			"msg_type": msgType, "is_group": isGroup, "conversation_title": title,
		}
		if senderName != "" {
			item["sender_name"] = senderName
		}
		items = append(items, item)
	}
	var next any
	if len(items) > limit {
		last := items[limit-1]
		items = items[:limit]
		next = encodeCursor(last["created_at"].(string), last["id"].(string))
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": next})
}

func atoiPos(s string) (int, error) {
	n := 0
	if s == "" {
		return 0, errors.New("empty")
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, errors.New("nan")
		}
		n = n*10 + int(r-'0')
		if n > 1000 {
			return n, nil
		}
	}
	return n, nil
}

// --- link previews ---

type linkPreview struct {
	URL         string `json:"url"`
	OK          bool   `json:"ok"`
	Title       string `json:"title"`
	Description string `json:"description"`
	ImageURL    string `json:"image_url"`
	SiteName    string `json:"site_name"`
	FinalURL    string `json:"final_url"`
}

func isPrivateIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() || ip.IsUnspecified() || ip.IsInterfaceLocalMulticast() {
		return true
	}
	// CGNAT 100.64.0.0/10 and link-local 169.254.0.0/16 (IsLinkLocal covers the latter on newer Go).
	if v4 := ip.To4(); v4 != nil {
		if v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
			return true
		}
		if v4[0] == 169 && v4[1] == 254 {
			return true
		}
		if v4[0] == 0 {
			return true
		}
	}
	return false
}

func blockedPreviewHost(host string) bool {
	h := strings.ToLower(strings.TrimSuffix(host, "."))
	if h == "" || h == "localhost" || strings.HasSuffix(h, ".localhost") || strings.HasSuffix(h, ".local") ||
		strings.HasSuffix(h, ".internal") || h == "metadata.google.internal" {
		return true
	}
	return false
}

// validatePreviewURL accepts public http(s) URLs on ports 80 and 443.
func validatePreviewURL(raw string) (*url.URL, string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 2000 {
		return nil, "", errors.New("invalid url")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return nil, "", errors.New("invalid url")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, "", errors.New("invalid url")
	}
	if u.User != nil {
		return nil, "", errors.New("invalid url")
	}
	host := u.Hostname()
	if blockedPreviewHost(host) {
		return nil, "", errors.New("blocked url")
	}
	if ip := net.ParseIP(host); ip != nil && isPrivateIP(ip) {
		return nil, "", errors.New("blocked url")
	}
	port := u.Port()
	if port != "" && port != "80" && port != "443" {
		return nil, "", errors.New("blocked url")
	}
	u.Fragment = ""
	u.Host = strings.ToLower(u.Host)
	return u, u.String(), nil
}

var (
	metaTagRe = regexp.MustCompile(`(?i)<meta\s+[^>]*>`)
	attrRe    = regexp.MustCompile(`(?i)([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')`)
	titleRe   = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	tagStrip  = regexp.MustCompile(`(?s)<[^>]*>`)
)

func parseAttrs(tag string) map[string]string {
	out := map[string]string{}
	for _, m := range attrRe.FindAllStringSubmatch(tag, 16) {
		val := m[3]
		if m[2] != "" && strings.HasPrefix(m[2], "'") {
			val = m[4]
		}
		out[strings.ToLower(m[1])] = html.UnescapeString(val)
	}
	return out
}

func openGraphFields(page string) (title, desc, image, site string) {
	if len(page) > 512*1024 {
		page = page[:512*1024]
	}
	for _, tag := range metaTagRe.FindAllString(page, 100) {
		attrs := parseAttrs(tag)
		key := strings.ToLower(attrs["property"])
		if key == "" {
			key = strings.ToLower(attrs["name"])
		}
		content := strings.TrimSpace(attrs["content"])
		if content == "" {
			continue
		}
		switch key {
		case "og:title":
			title = content
		case "og:description":
			desc = content
		case "twitter:title":
			if title == "" {
				title = content
			}
		case "twitter:description", "description":
			if desc == "" {
				desc = content
			}
		case "og:image", "og:image:secure_url":
			image = content
		case "twitter:image":
			if image == "" {
				image = content
			}
		case "og:site_name":
			site = content
		}
	}
	if title == "" {
		if m := titleRe.FindStringSubmatch(page); len(m) == 2 {
			title = strings.TrimSpace(html.UnescapeString(tagStrip.ReplaceAllString(m[1], "")))
		}
	}
	return clip(title, 200), clip(desc, 300), clip(image, 1000), clip(site, 80)
}

func clip(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n])
}

func resolveRef(base *url.URL, ref string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" || base == nil {
		return ""
	}
	u, err := url.Parse(ref)
	if err != nil {
		return ""
	}
	abs := base.ResolveReference(u)
	if abs.Scheme != "http" && abs.Scheme != "https" {
		return ""
	}
	if _, _, err := validatePreviewURL(abs.String()); err != nil {
		return ""
	}
	return abs.String()
}

func previewDialer() func(ctx context.Context, network, addr string) (net.Conn, error) {
	d := &net.Dialer{Timeout: 5 * time.Second}
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		if blockedPreviewHost(host) {
			return nil, errors.New("blocked url")
		}
		if ip := net.ParseIP(host); ip != nil {
			if isPrivateIP(ip) {
				return nil, errors.New("blocked url")
			}
			return d.DialContext(ctx, network, addr)
		}
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		if len(ips) == 0 {
			return nil, errors.New("no address")
		}
		for _, ip := range ips {
			if isPrivateIP(ip.IP) {
				return nil, errors.New("blocked url")
			}
		}
		return d.DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
	}
}

func fetchLinkPreview(ctx context.Context, raw string) (linkPreview, error) {
	u, canonical, err := validatePreviewURL(raw)
	if err != nil {
		return linkPreview{}, err
	}
	out := linkPreview{URL: canonical, FinalURL: canonical, SiteName: u.Hostname()}
	client := &http.Client{
		Timeout: 8 * time.Second,
		Transport: &http.Transport{
			Proxy:                 nil,
			DialContext:           previewDialer(),
			TLSHandshakeTimeout:   5 * time.Second,
			ResponseHeaderTimeout: 5 * time.Second,
			DisableKeepAlives:     true,
			TLSClientConfig:       &tls.Config{MinVersion: tls.VersionTLS12},
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("too many redirects")
			}
			if _, _, err := validatePreviewURL(req.URL.String()); err != nil {
				return err
			}
			return nil
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, canonical, nil)
	if err != nil {
		return out, err
	}
	req.Header.Set("User-Agent", "HubLinkPreview/1.0")
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	res, err := client.Do(req)
	if err != nil {
		return out, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return out, errors.New("upstream status")
	}
	final := res.Request.URL
	if final != nil {
		if _, canon, err := validatePreviewURL(final.String()); err == nil {
			out.FinalURL = canon
		}
	}
	ct := strings.ToLower(res.Header.Get("Content-Type"))
	if strings.Contains(ct, "image/") {
		out.OK = true
		out.ImageURL = out.FinalURL
		out.Title = u.Hostname()
		return out, nil
	}
	buf, err := io.ReadAll(io.LimitReader(res.Body, 512*1024))
	if err != nil {
		return out, err
	}
	title, desc, image, site := openGraphFields(string(buf))
	if site != "" {
		out.SiteName = site
	}
	out.Title = title
	out.Description = desc
	if final != nil {
		out.ImageURL = resolveRef(final, image)
	}
	out.OK = out.Title != "" || out.Description != "" || out.ImageURL != ""
	return out, nil
}

// LinkPreview GET|POST /v1/link-preview?url=
func (s *Service) LinkPreview(w http.ResponseWriter, r *http.Request) {
	if _, ok := apiutil.UserIDFromContext(r.Context()); !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	raw := ""
	if r.Method == http.MethodPost {
		var req struct {
			URL string `json:"url"`
		}
		if err := apiutil.DecodeJSON(r, &req); err != nil {
			apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
			return
		}
		raw = req.URL
	} else {
		raw = r.URL.Query().Get("url")
	}
	u, canonical, err := validatePreviewURL(raw)
	if err != nil || u == nil {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "invalid url")
		return
	}
	var cached linkPreview
	var fetched time.Time
	err = s.pool.QueryRow(r.Context(), `
		SELECT ok, title, description, image_url, site_name, final_url, fetched_at
		FROM link_previews WHERE url = $1`, canonical).
		Scan(&cached.OK, &cached.Title, &cached.Description, &cached.ImageURL, &cached.SiteName, &cached.FinalURL, &fetched)
	if err == nil {
		cached.URL = canonical
		fresh := time.Since(fetched) < 24*time.Hour
		if !cached.OK {
			fresh = time.Since(fetched) < 15*time.Minute
		}
		if fresh {
			apiutil.JSON(w, http.StatusOK, cached)
			return
		}
	}
	preview, ferr := fetchLinkPreview(r.Context(), canonical)
	if ferr != nil {
		preview = linkPreview{URL: canonical, FinalURL: canonical, SiteName: u.Hostname(), OK: false}
	}
	_, _ = s.pool.Exec(r.Context(), `
		INSERT INTO link_previews (url, ok, title, description, image_url, site_name, final_url, fetched_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7, now())
		ON CONFLICT (url) DO UPDATE SET
		  ok = EXCLUDED.ok, title = EXCLUDED.title, description = EXCLUDED.description,
		  image_url = EXCLUDED.image_url, site_name = EXCLUDED.site_name,
		  final_url = EXCLUDED.final_url, fetched_at = now()`,
		canonical, preview.OK, preview.Title, preview.Description, preview.ImageURL, preview.SiteName, preview.FinalURL)
	apiutil.JSON(w, http.StatusOK, preview)
}
