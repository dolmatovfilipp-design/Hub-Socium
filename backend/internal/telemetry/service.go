package telemetry

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	errorPerMin = 30
	eventPerMin = 60
)

// FunnelSteps is the registration path plus a sent message, in order.
var FunnelSteps = []struct {
	Name  string
	Label string
}{
	{"register_open", "Открыли регистрацию"},
	{"register_submit", "Отправили форму"},
	{"register_code", "Экран кода"},
	{"register_done", "Подтвердили почту"},
	{"message_send", "Отправили сообщение"},
}

var allowedEvents = map[string]bool{
	"session_start":   true,
	"screen_view":     true,
	"register_open":   true,
	"register_submit": true,
	"register_code":   true,
	"register_done":   true,
	"message_send":    true,
}

// Service stores client and server failures and anonymous product events.
type Service struct {
	pool *pgxpool.Pool

	mu   sync.Mutex
	hits map[string]*hitBucket
}

type hitBucket struct {
	n    int
	from time.Time
}

type errorIn struct {
	Source     string
	Message    string
	Stack      string
	Route      string
	UserAgent  string
	AppVersion string
	UserID     string
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, hits: map[string]*hitBucket{}}
}

var (
	bindMu sync.RWMutex
	bound  *Service
)

// Bind lets the HTTP middleware write 5xx and panics into the same table.
func Bind(s *Service) {
	bindMu.Lock()
	bound = s
	bindMu.Unlock()
}

func current() *Service {
	bindMu.RLock()
	defer bindMu.RUnlock()
	return bound
}

// CaptureServer records a 5xx response or a recovered panic. It never panics.
func CaptureServer(r *http.Request, status int, panicVal any) {
	defer func() { _ = recover() }()
	s := current()
	if s == nil || s.pool == nil || r == nil {
		return
	}
	path := r.URL.Path
	if strings.HasPrefix(path, "/v1/telemetry") || path == "/healthz" {
		return
	}
	source := "server"
	message := fmt.Sprintf("HTTP %d", status)
	stack := ""
	if panicVal != nil {
		source = "panic"
		message = clip(scrub(fmt.Sprint(panicVal)), 400)
		stack = clip(string(debug.Stack()), 8000)
		status = http.StatusInternalServerError
	}
	if status < 500 {
		return
	}
	userID := ""
	if uid, ok := apiutil.UserIDFromContext(r.Context()); ok {
		userID = uid
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := s.insertError(ctx, errorIn{
		Source:     source,
		Message:    message,
		Stack:      stack,
		Route:      r.Method + " " + path,
		UserAgent:  r.UserAgent(),
		AppVersion: serverVersion(),
		UserID:     userID,
	}); err != nil {
		slog.Warn("telemetry server error", "err", err)
	}
}

func serverVersion() string {
	if v := strings.TrimSpace(os.Getenv("APP_VERSION")); v != "" {
		return clip(v, 40)
	}
	return "server"
}

func (s *Service) allow(key string, limit int) bool {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.hits) > 8000 {
		for k, b := range s.hits {
			if now.Sub(b.from) > time.Minute {
				delete(s.hits, k)
			}
		}
	}
	b, ok := s.hits[key]
	if !ok || now.Sub(b.from) > time.Minute {
		s.hits[key] = &hitBucket{n: 1, from: now}
		return true
	}
	b.n++
	return b.n <= limit
}

func (s *Service) insertError(ctx context.Context, in errorIn) error {
	in.Source = clip(in.Source, 24)
	if in.Source == "" {
		in.Source = "client"
	}
	in.Message = clip(scrub(in.Message), 500)
	if in.Message == "" {
		return errEmpty
	}
	in.Stack = clip(scrub(in.Stack), 8000)
	in.Route = NormalizeRoute(in.Route)
	in.UserAgent = clip(scrub(in.UserAgent), 240)
	in.AppVersion = clip(in.AppVersion, 40)
	fp := Fingerprint(in.Source, in.Message, in.Stack, in.Route)
	var user any
	if in.UserID != "" {
		user = in.UserID
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO telemetry_errors
			(fingerprint, message, stack, route, user_agent, app_version, user_id, source, count, first_seen, last_seen)
		VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $8, 1, now(), now())
		ON CONFLICT (fingerprint) DO UPDATE SET
			count = telemetry_errors.count + 1,
			last_seen = now(),
			message = EXCLUDED.message,
			stack = CASE WHEN EXCLUDED.stack <> '' THEN EXCLUDED.stack ELSE telemetry_errors.stack END,
			route = EXCLUDED.route,
			user_agent = EXCLUDED.user_agent,
			app_version = EXCLUDED.app_version,
			user_id = COALESCE(EXCLUDED.user_id, telemetry_errors.user_id)`,
		fp, in.Message, in.Stack, in.Route, in.UserAgent, in.AppVersion, user, in.Source)
	return err
}

var errEmpty = fmt.Errorf("empty message")

// ReportError POST /v1/telemetry/errors
func (s *Service) ReportError(w http.ResponseWriter, r *http.Request) {
	if s.pool == nil {
		apiutil.Error(w, http.StatusServiceUnavailable, "db_unavailable", "База недоступна")
		return
	}
	var req struct {
		Message    string `json:"message"`
		Stack      string `json:"stack"`
		Route      string `json:"route"`
		UserAgent  string `json:"user_agent"`
		AppVersion string `json:"app_version"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	key := "err:" + clientKey(r)
	if !s.allow(key, errorPerMin) {
		apiutil.Error(w, http.StatusTooManyRequests, "rate_limited", "Слишком много отчётов об ошибках")
		return
	}
	userID := ""
	if uid, ok := apiutil.UserIDFromContext(r.Context()); ok {
		userID = uid
	}
	if strings.TrimSpace(req.UserAgent) == "" {
		req.UserAgent = r.UserAgent()
	}
	if err := s.insertError(r.Context(), errorIn{
		Source:     "client",
		Message:    req.Message,
		Stack:      req.Stack,
		Route:      req.Route,
		UserAgent:  req.UserAgent,
		AppVersion: req.AppVersion,
		UserID:     userID,
	}); err != nil {
		if err == errEmpty {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Нужен текст ошибки")
			return
		}
		slog.Warn("telemetry error insert", "err", err)
		apiutil.Error(w, http.StatusInternalServerError, "internal", "Не удалось сохранить ошибку")
		return
	}
	apiutil.JSON(w, http.StatusAccepted, map[string]any{"ok": true})
}

// ReportEvent POST /v1/telemetry/events
func (s *Service) ReportEvent(w http.ResponseWriter, r *http.Request) {
	if s.pool == nil {
		apiutil.Error(w, http.StatusServiceUnavailable, "db_unavailable", "База недоступна")
		return
	}
	var req struct {
		Name      string `json:"name"`
		Route     string `json:"route"`
		SessionID string `json:"session_id"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	name := strings.TrimSpace(req.Name)
	if !allowedEvents[name] {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Неизвестное событие")
		return
	}
	sessionID := strings.TrimSpace(req.SessionID)
	if !validSession(sessionID) {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Некорректная сессия")
		return
	}
	if !s.allow("ev:"+clientKey(r), eventPerMin) {
		apiutil.Error(w, http.StatusTooManyRequests, "rate_limited", "Слишком много событий")
		return
	}
	route := NormalizeRoute(req.Route)
	if name == "screen_view" && route == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Нужен экран")
		return
	}
	var user any
	if uid, ok := apiutil.UserIDFromContext(r.Context()); ok && uid != "" {
		user = uid
	}
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO telemetry_events (name, user_id, session_id, route)
		VALUES ($1, $2::uuid, $3, $4)`,
		name, user, sessionID, route)
	if err != nil {
		slog.Warn("telemetry event insert", "err", err)
		apiutil.Error(w, http.StatusInternalServerError, "internal", "Не удалось сохранить событие")
		return
	}
	apiutil.JSON(w, http.StatusAccepted, map[string]any{"ok": true})
}

func validSession(id string) bool {
	if len(id) < 8 || len(id) > 64 {
		return false
	}
	for _, c := range id {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '-', c == '_':
		default:
			return false
		}
	}
	return true
}

func clientKey(r *http.Request) string {
	if uid, ok := apiutil.UserIDFromContext(r.Context()); ok && uid != "" {
		return "u:" + uid
	}
	host := r.RemoteAddr
	if i := strings.LastIndex(host, ":"); i > 0 {
		host = host[:i]
	}
	return "ip:" + host
}

// Admin GET /v1/telemetry/admin — owner account only.
func (s *Service) Admin(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	if s.pool == nil {
		apiutil.Error(w, http.StatusServiceUnavailable, "db_unavailable", "База недоступна")
		return
	}
	admin, err := s.isAdmin(r.Context(), uid)
	if err != nil || !admin {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "Только для владельца")
		return
	}
	ctx := r.Context()
	start := moscowDayStart()

	var online, dau, regs int
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM users
		WHERE deleted_at IS NULL
		  AND last_seen_at IS NOT NULL
		  AND last_seen_at > now() - interval '90 seconds'`).Scan(&online); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "Сводка недоступна")
		return
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT user_id) FROM telemetry_events
		WHERE user_id IS NOT NULL AND created_at >= $1`, start).Scan(&dau); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "Сводка недоступна")
		return
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM users
		WHERE deleted_at IS NULL AND created_at >= $1`, start).Scan(&regs); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "Сводка недоступна")
		return
	}

	counts := map[string]int{}
	rows, err := s.pool.Query(ctx, `
		SELECT name, COUNT(*) FROM telemetry_events
		WHERE created_at >= $1
		GROUP BY name`, start)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "Сводка недоступна")
		return
	}
	for rows.Next() {
		var name string
		var n int
		if err := rows.Scan(&name, &n); err != nil {
			rows.Close()
			apiutil.Error(w, http.StatusInternalServerError, "internal", "Сводка недоступна")
			return
		}
		counts[name] = n
	}
	rows.Close()

	funnel := make([]map[string]any, 0, len(FunnelSteps))
	for _, step := range FunnelSteps {
		funnel = append(funnel, map[string]any{
			"step":  step.Name,
			"label": step.Label,
			"count": counts[step.Name],
		})
	}

	screens := make([]map[string]any, 0)
	srows, err := s.pool.Query(ctx, `
		SELECT route, COUNT(*) FROM telemetry_events
		WHERE name = 'screen_view' AND created_at >= $1 AND route <> ''
		GROUP BY route
		ORDER BY COUNT(*) DESC, route ASC
		LIMIT 8`, start)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "Сводка недоступна")
		return
	}
	for srows.Next() {
		var route string
		var n int
		if err := srows.Scan(&route, &n); err != nil {
			srows.Close()
			apiutil.Error(w, http.StatusInternalServerError, "internal", "Сводка недоступна")
			return
		}
		screens = append(screens, map[string]any{"route": route, "count": n})
	}
	srows.Close()

	errorsOut := make([]map[string]any, 0)
	erows, err := s.pool.Query(ctx, `
		SELECT fingerprint, message, stack, route, source, app_version,
		       COALESCE(user_id::text, ''), count, last_seen
		FROM telemetry_errors
		ORDER BY last_seen DESC
		LIMIT 40`)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "Сводка недоступна")
		return
	}
	defer erows.Close()
	for erows.Next() {
		var fp, message, stack, route, source, version, userID string
		var n int
		var last time.Time
		if err := erows.Scan(&fp, &message, &stack, &route, &source, &version, &userID, &n, &last); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", "Сводка недоступна")
			return
		}
		item := map[string]any{
			"fingerprint": fp,
			"message":     message,
			"stack":       stack,
			"route":       route,
			"source":      source,
			"app_version": version,
			"count":       n,
			"last_seen":   last.UTC().Format(time.RFC3339),
		}
		if userID != "" {
			item["user_id"] = userID
		}
		errorsOut = append(errorsOut, item)
	}
	if err := erows.Err(); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "Сводка недоступна")
		return
	}

	apiutil.JSON(w, http.StatusOK, map[string]any{
		"online":              online,
		"dau":                 dau,
		"registrations_today": regs,
		"screens":             screens,
		"funnel":              funnel,
		"errors":              errorsOut,
	})
}

func (s *Service) isAdmin(ctx context.Context, uid string) (bool, error) {
	var admin bool
	err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(is_admin, false)
		FROM users WHERE id = $1::uuid AND deleted_at IS NULL`, uid).Scan(&admin)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	return admin, err
}

func moscowDayStart() time.Time {
	loc, err := time.LoadLocation("Europe/Moscow")
	if err != nil {
		loc = time.FixedZone("MSK", 3*60*60)
	}
	now := time.Now().In(loc)
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
}
