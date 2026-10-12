package auth

import "testing"

func TestExposeResetCodeOnlyInDevMode(t *testing.T) {
	t.Setenv("SMTP_HOST", "")
	t.Setenv("HUB_HIDE_RESET_CODE", "")

	if exposeResetCodeInResponse(false) {
		t.Fatal("reset code must never be exposed outside dev mode")
	}
	if !exposeResetCodeInResponse(true) {
		t.Fatal("dev mode without SMTP should expose the code")
	}

	t.Setenv("SMTP_HOST", "smtp.example.com")
	if exposeResetCodeInResponse(true) {
		t.Fatal("SMTP configured: code must be hidden")
	}

	t.Setenv("SMTP_HOST", "")
	t.Setenv("HUB_HIDE_RESET_CODE", "1")
	if exposeResetCodeInResponse(true) {
		t.Fatal("HUB_HIDE_RESET_CODE=1: code must be hidden")
	}
}
