package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/hub-socium/hub/backend/internal/apiutil"
)

var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

type wsClient struct {
	hub    *WSHub
	conn   *websocket.Conn
	userID string
	send   chan []byte
	subs   map[string]struct{} // conversation ids; "*" = all memberships
	mu     sync.Mutex
}

// WSHub fans out chat events to connected users.
type WSHub struct {
	mu         sync.RWMutex
	byUser     map[string]map[*wsClient]struct{}
	parseToken func(raw string) (userID, username string, err error)
}

// NewWSHub creates an empty hub.
func NewWSHub() *WSHub {
	return &WSHub{byUser: map[string]map[*wsClient]struct{}{}}
}

// SetTokenParser wires JWT validation for WS handshake.
func (h *WSHub) SetTokenParser(fn func(raw string) (userID, username string, err error)) {
	h.parseToken = fn
}

func (h *WSHub) register(c *wsClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	m := h.byUser[c.userID]
	if m == nil {
		m = map[*wsClient]struct{}{}
		h.byUser[c.userID] = m
	}
	m[c] = struct{}{}
}

func (h *WSHub) unregister(c *wsClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if m := h.byUser[c.userID]; m != nil {
		delete(m, c)
		if len(m) == 0 {
			delete(h.byUser, c.userID)
		}
	}
	close(c.send)
}

func (h *WSHub) deliverFiltered(userID, convID string, payload []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.byUser[userID] {
		c.mu.Lock()
		_, sub := c.subs[convID]
		_, all := c.subs["*"]
		c.mu.Unlock()
		if !sub && !all {
			continue
		}
		select {
		case c.send <- payload:
		default:
		}
	}
}

// BroadcastEvent pushes JSON to all online members of a conversation who subscribed.
func (s *Service) BroadcastEvent(convID string, event map[string]any) {
	if s == nil || s.ws == nil || s.pool == nil || convID == "" {
		return
	}
	payload, err := json.Marshal(event)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	rows, err := s.pool.Query(ctx, `
		SELECT user_id::text FROM conversation_members WHERE conversation_id=$1::uuid`, convID)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var uid string
		if rows.Scan(&uid) != nil {
			continue
		}
		s.ws.deliverFiltered(uid, convID, payload)
	}
}

// HandleWS upgrades GET /v1/ws (auth: Bearer or ?access_token=).
func (s *Service) HandleWS(w http.ResponseWriter, r *http.Request) {
	if s.ws == nil || s.ws.parseToken == nil {
		apiutil.Error(w, http.StatusServiceUnavailable, "unavailable", "ws not configured")
		return
	}
	token := ""
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		token = strings.TrimPrefix(h, "Bearer ")
	}
	if token == "" {
		token = strings.TrimSpace(r.URL.Query().Get("access_token"))
	}
	if token == "" {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing token")
		return
	}
	uid, _, err := s.ws.parseToken(token)
	if err != nil || uid == "" {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "invalid token")
		return
	}
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	client := &wsClient{
		hub:    s.ws,
		conn:   conn,
		userID: uid,
		send:   make(chan []byte, 64),
		subs:   map[string]struct{}{"*": {}},
	}
	s.ws.register(client)
	go client.writePump()
	client.readPump(s)
}

func (c *wsClient) writePump() {
	ticker := time.NewTicker(25 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *wsClient) readPump(s *Service) {
	defer func() {
		c.hub.unregister(c)
		c.conn.Close()
	}()
	c.conn.SetReadLimit(32 << 10)
	_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		var msg struct {
			Type           string `json:"type"`
			ConversationID string `json:"conversation_id"`
		}
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		switch strings.ToLower(msg.Type) {
		case "subscribe":
			cid := strings.TrimSpace(msg.ConversationID)
			if cid == "" {
				continue
			}
			var ok bool
			_ = s.pool.QueryRow(context.Background(), `
				SELECT EXISTS(
				  SELECT 1 FROM conversation_members
				  WHERE conversation_id=$1::uuid AND user_id=$2::uuid)`, cid, c.userID).Scan(&ok)
			if !ok {
				continue
			}
			c.mu.Lock()
			c.subs[cid] = struct{}{}
			c.mu.Unlock()
			ack, _ := json.Marshal(map[string]any{"type": "subscribed", "conversation_id": cid})
			select {
			case c.send <- ack:
			default:
			}
		case "unsubscribe":
			cid := strings.TrimSpace(msg.ConversationID)
			c.mu.Lock()
			delete(c.subs, cid)
			c.mu.Unlock()
		case "ping":
			pong, _ := json.Marshal(map[string]any{"type": "pong"})
			select {
			case c.send <- pong:
			default:
			}
		}
	}
}
