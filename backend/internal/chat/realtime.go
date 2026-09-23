package chat

import (
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/hub-socium/hub/backend/internal/apiutil"
)

type typingEntry struct {
	userID string
	until  time.Time
}

var (
	typingMu  sync.Mutex
	typingMap = map[string]typingEntry{}
)

func (s *Service) Typing(w http.ResponseWriter, r *http.Request) {
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
	typingMu.Lock()
	typingMap[convID] = typingEntry{userID: uid, until: time.Now().Add(4 * time.Second)}
	typingMu.Unlock()
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func typingPeer(convID, viewerID string) (string, bool) {
	typingMu.Lock()
	defer typingMu.Unlock()
	e, ok := typingMap[convID]
	if !ok || time.Now().After(e.until) || e.userID == viewerID {
		return "", false
	}
	return e.userID, true
}

func (s *Service) MuteConversation(w http.ResponseWriter, r *http.Request) {
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
		INSERT INTO conversation_mutes (user_id, conversation_id)
		VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, uid, convID)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "muted": true})
}

func (s *Service) UnmuteConversation(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	convID := chi.URLParam(r, "id")
	_, _ = s.pool.Exec(r.Context(), `
		DELETE FROM conversation_mutes WHERE user_id=$1::uuid AND conversation_id=$2::uuid`, uid, convID)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "muted": false})
}
