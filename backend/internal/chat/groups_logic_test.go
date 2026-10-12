package chat

import "testing"

func TestPermAllows(t *testing.T) {
	if !permAllows("all", "member") || !permAllows("", "member") {
		t.Fatal("all/empty must allow members")
	}
	if permAllows("admins", "member") {
		t.Fatal("admins must block members")
	}
	if !permAllows("admins", "admin") || !permAllows("admins", "owner") {
		t.Fatal("admins must allow owner and admin")
	}
	if permAllows("nope", "owner") {
		t.Fatal("unknown perm must deny")
	}
}

func TestStaffRole(t *testing.T) {
	if staffRole("member") || !staffRole("owner") || !staffRole("admin") {
		t.Fatal("staff is owner or admin")
	}
}

func TestMaxGroupMembers(t *testing.T) {
	if maxGroupMembers != 256 {
		t.Fatalf("cap = %d", maxGroupMembers)
	}
}

func TestValidPerm(t *testing.T) {
	if !validPerm("all") || !validPerm("admins") || validPerm("owner") {
		t.Fatal("perm values")
	}
}

func TestParsePollOptions(t *testing.T) {
	labels := parsePollOptions([]byte(`["Да","Нет"]`))
	if len(labels) != 2 || labels[0] != "Да" || labels[1] != "Нет" {
		t.Fatalf("strings: %#v", labels)
	}
	labels = parsePollOptions([]byte(`[{"label":"А"},{"text":"Б"}]`))
	if len(labels) != 2 || labels[0] != "А" || labels[1] != "Б" {
		t.Fatalf("objects: %#v", labels)
	}
	if parsePollOptions([]byte(`{}`)) != nil {
		t.Fatal("object must not parse as options")
	}
}

func TestInviteTokenUnique(t *testing.T) {
	a, err := newInviteToken()
	if err != nil {
		t.Fatal(err)
	}
	b, err := newInviteToken()
	if err != nil {
		t.Fatal(err)
	}
	if a == "" || a == b || len(a) < 16 {
		t.Fatalf("tokens %q %q", a, b)
	}
}
