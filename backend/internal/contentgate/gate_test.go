package contentgate

import "testing"

func TestNormalizeAge(t *testing.T) {
	cases := []struct {
		in   string
		want string
		ok   bool
	}{
		{"", "all", true},
		{"Обычный", "all", true},
		{"12+", "12", true},
		{"18", "18", true},
		{"21", "", false},
	}
	for _, c := range cases {
		got, ok := NormalizeAge(c.in)
		if ok != c.ok || got != c.want {
			t.Fatalf("%q: got %q %v", c.in, got, ok)
		}
	}
}

func TestVisible(t *testing.T) {
	if !Visible("all", false, false) || !Visible("12", false, false) {
		t.Fatal("default viewer sees ordinary and 12+")
	}
	if Visible("18", false, false) {
		t.Fatal("18 hidden until show_adult")
	}
	if !Visible("18", true, false) {
		t.Fatal("show_adult sees 18")
	}
	if Visible("18", true, true) || Visible("12", false, true) {
		t.Fatal("parental hides 12 and 18")
	}
	if !Visible("all", false, true) {
		t.Fatal("parental still sees ordinary")
	}
}
