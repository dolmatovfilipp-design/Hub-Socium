package chat

import (
	"strings"
	"testing"
)

func TestListConversationsQueryProjectsVerifiedPeer(t *testing.T) {
	query := strings.Join(strings.Fields(listConversationsQuery), " ")
	projection := "SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_verified FROM conversation_members om"
	if !strings.Contains(query, projection) {
		t.Fatalf("peer lateral query must project is_verified: %s", query)
	}
}
