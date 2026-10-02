package media

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// S3Config is filled from env (Yandex / Selectel / R2 compatible).
type S3Config struct {
	Endpoint   string
	Region     string
	Bucket     string
	AccessKey  string
	SecretKey  string
	PublicBase string
}

func S3FromEnv() *S3Config {
	ep := strings.TrimSpace(os.Getenv("S3_ENDPOINT"))
	bucket := strings.TrimSpace(os.Getenv("S3_BUCKET"))
	ak := strings.TrimSpace(os.Getenv("S3_ACCESS_KEY"))
	sk := strings.TrimSpace(os.Getenv("S3_SECRET_KEY"))
	if ep == "" || bucket == "" || ak == "" || sk == "" {
		return nil
	}
	region := strings.TrimSpace(os.Getenv("S3_REGION"))
	if region == "" {
		region = "ru-central1"
	}
	return &S3Config{
		Endpoint:   strings.TrimRight(ep, "/"),
		Region:     region,
		Bucket:     bucket,
		AccessKey:  ak,
		SecretKey:  sk,
		PublicBase: strings.TrimRight(strings.TrimSpace(os.Getenv("S3_PUBLIC_BASE")), "/"),
	}
}

func (c *S3Config) Enabled() bool { return c != nil && c.Bucket != "" && c.AccessKey != "" }

func (c *S3Config) PutObject(key, contentType string, body []byte) (publicURL string, err error) {
	if !c.Enabled() {
		return "", fmt.Errorf("s3 not configured")
	}
	host := strings.TrimPrefix(strings.TrimPrefix(c.Endpoint, "https://"), "http://")
	// path-style: https://endpoint/bucket/key
	url := fmt.Sprintf("%s/%s/%s", c.Endpoint, c.Bucket, key)
	req, err := http.NewRequest(http.MethodPut, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Content-Length", fmt.Sprintf("%d", len(body)))
	if err := signV4(req, body, c.AccessKey, c.SecretKey, c.Region, host); err != nil {
		return "", err
	}
	client := &http.Client{Timeout: 60 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return "", fmt.Errorf("s3 put %d: %s", res.StatusCode, string(b))
	}
	if c.PublicBase != "" {
		return c.PublicBase + "/" + key, nil
	}
	return url, nil
}

func signV4(req *http.Request, payload []byte, accessKey, secretKey, region, host string) error {
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	payloadHash := sha256Hex(payload)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("Host", host)

	canonicalHeaders := fmt.Sprintf("host:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n",
		host, payloadHash, amzDate)
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalRequest := strings.Join([]string{
		req.Method,
		req.URL.EscapedPath(),
		"", // no query
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	}, "\n")
	credentialScope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, region)
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		credentialScope,
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")
	signingKey := getSignatureKey(secretKey, dateStamp, region, "s3")
	signature := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))
	auth := fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		accessKey, credentialScope, signedHeaders, signature)
	req.Header.Set("Authorization", auth)
	return nil
}

func sha256Hex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func hmacSHA256(key []byte, data string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(data))
	return m.Sum(nil)
}

func getSignatureKey(secret, dateStamp, region, service string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secret), dateStamp)
	kRegion := hmacSHA256(kDate, region)
	kService := hmacSHA256(kRegion, service)
	return hmacSHA256(kService, "aws4_request")
}
