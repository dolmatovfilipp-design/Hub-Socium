package payments

import "testing"

func TestKeysSet(t *testing.T) {
	if KeysSet("", "") || KeysSet("shop", "") || KeysSet("", "secret") {
		t.Fatal("empty credentials must stay disabled")
	}
	if !KeysSet("shop", "secret") {
		t.Fatal("both keys enable payments")
	}
}

func TestRubString(t *testing.T) {
	if got := RubString(100); got != "1.00" {
		t.Fatalf("1 RUB: %s", got)
	}
	if got := RubString(1990); got != "19.90" {
		t.Fatalf("19.90: %s", got)
	}
}

func TestCreateRedirectWithoutKeys(t *testing.T) {
	_, err := CreateRedirect("", "", 100, "order", "https://gethub.online/app", nil)
	if err == nil {
		t.Fatal("expected error without keys")
	}
}
