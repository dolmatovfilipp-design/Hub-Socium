package chat

import "net/http"

const maxGroupMembers = 256

func staffRole(role string) bool {
	return role == "owner" || role == "admin"
}

// permAllows reports whether a member role satisfies a conversations.perm_* value.
// An empty value is treated as "all" so older rows still load.
func permAllows(perm, role string) bool {
	switch perm {
	case "", "all":
		return true
	case "admins":
		return staffRole(role)
	default:
		return false
	}
}

func validPerm(v string) bool {
	return v == "all" || v == "admins"
}

func (s *Service) roleOf(r *http.Request, uid, convID string) string {
	var role string
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(role,'member') FROM conversation_members
		WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, uid).Scan(&role)
	if err != nil {
		return ""
	}
	return role
}

func (s *Service) groupMemberCount(r *http.Request, convID string) int {
	var n int
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COUNT(*)::int FROM conversation_members WHERE conversation_id=$1::uuid`, convID).Scan(&n)
	return n
}

// mayAct reports whether uid may perform permKind (send, add, info, pin).
// Direct chats always allow the action. A missing membership returns false.
func (s *Service) mayAct(r *http.Request, uid, convID, permKind string) (allowed bool, isGroup bool) {
	var perm, role string
	var group bool
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(c.is_group,false),
		       CASE $3
		         WHEN 'send' THEN c.perm_send
		         WHEN 'add' THEN c.perm_add
		         WHEN 'info' THEN c.perm_info
		         WHEN 'pin' THEN c.perm_pin
		         ELSE 'all'
		       END,
		       COALESCE(cm.role,'member')
		FROM conversations c
		JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $2::uuid
		WHERE c.id = $1::uuid`, convID, uid, permKind).Scan(&group, &perm, &role)
	if err != nil {
		return false, false
	}
	if !group {
		return true, false
	}
	return permAllows(perm, role), true
}
