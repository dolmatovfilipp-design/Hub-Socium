package media

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
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

// SignedGetTTL is how long a presigned download stays valid.
// A fresh URL is issued on each GET /v1/media/{id} when no public CDN is set.
const SignedGetTTL = 12 * time.Hour

// RequiredEnv is the set that turns Selectel (or any S3) on. Empty values keep local disk.
func RequiredEnv() []string {
	return []string{"S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"}
}

// MissingEnv lists required variables that are unset. S3_REGION and S3_PUBLIC_BASE are optional.
func MissingEnv() []string {
	var missing []string
	for _, name := range RequiredEnv() {
		if strings.TrimSpace(os.Getenv(name)) == "" {
			missing = append(missing, name)
		}
	}
	return missing
}

// AccessURL is the URL a browser should open.
// S3_PUBLIC_BASE (bucket website or CDN) wins. Otherwise the URL is a presigned GET.
func (c *S3Config) AccessURL(key string) (string, error) {
	if !c.Enabled() {
		return "", fmt.Errorf("s3 not configured")
	}
	key = strings.TrimPrefix(key, "/")
	if key == "" {
		return "", fmt.Errorf("empty object key")
	}
	if c.PublicBase != "" {
		return c.PublicBase + "/" + key, nil
	}
	return c.PresignGet(key, SignedGetTTL)
}

// PresignGet returns a path-style GET URL. The signature covers host only, so
// a player can still send Range after the redirect.
func (c *S3Config) PresignGet(key string, exp time.Duration) (string, error) {
	if !c.Enabled() {
		return "", fmt.Errorf("s3 not configured")
	}
	if exp <= 0 {
		exp = SignedGetTTL
	}
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	host := strings.TrimPrefix(strings.TrimPrefix(c.Endpoint, "https://"), "http://")
	canonicalURI := "/" + c.Bucket + "/" + strings.TrimPrefix(key, "/")
	credential := fmt.Sprintf("%s/%s/%s/s3/aws4_request", c.AccessKey, dateStamp, c.Region)
	q := url.Values{}
	q.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	q.Set("X-Amz-Credential", credential)
	q.Set("X-Amz-Date", amzDate)
	q.Set("X-Amz-Expires", fmt.Sprintf("%d", int(exp.Seconds())))
	q.Set("X-Amz-SignedHeaders", "host")
	canonicalQuery := q.Encode()
	canonicalHeaders := fmt.Sprintf("host:%s\n", host)
	canonicalRequest := strings.Join([]string{
		"GET",
		canonicalURI,
		canonicalQuery,
		canonicalHeaders,
		"host",
		"UNSIGNED-PAYLOAD",
	}, "\n")
	scope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, c.Region)
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")
	signature := hex.EncodeToString(hmacSHA256(getSignatureKey(c.SecretKey, dateStamp, c.Region, "s3"), stringToSign))
	q.Set("X-Amz-Signature", signature)
	return strings.TrimRight(c.Endpoint, "/") + canonicalURI + "?" + q.Encode(), nil
}

// PresignPut returns a path-style PUT URL valid for exp, plus the public URL.
func (c *S3Config) PresignPut(key, contentType string, exp time.Duration) (uploadURL, publicURL string, err error) {
	if !c.Enabled() {
		return "", "", fmt.Errorf("s3 not configured")
	}
	if exp <= 0 {
		exp = 15 * time.Minute
	}
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	host := strings.TrimPrefix(strings.TrimPrefix(c.Endpoint, "https://"), "http://")
	canonicalURI := "/" + c.Bucket + "/" + strings.TrimPrefix(key, "/")
	credential := fmt.Sprintf("%s/%s/%s/s3/aws4_request", c.AccessKey, dateStamp, c.Region)
	q := url.Values{}
	q.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	q.Set("X-Amz-Credential", credential)
	q.Set("X-Amz-Date", amzDate)
	q.Set("X-Amz-Expires", fmt.Sprintf("%d", int(exp.Seconds())))
	q.Set("X-Amz-SignedHeaders", "content-type;host")
	canonicalQuery := q.Encode()
	canonicalHeaders := fmt.Sprintf("content-type:%s\nhost:%s\n", contentType, host)
	canonicalRequest := strings.Join([]string{
		"PUT",
		canonicalURI,
		canonicalQuery,
		canonicalHeaders,
		"content-type;host",
		"UNSIGNED-PAYLOAD",
	}, "\n")
	scope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, c.Region)
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")
	signature := hex.EncodeToString(hmacSHA256(getSignatureKey(c.SecretKey, dateStamp, c.Region, "s3"), stringToSign))
	q.Set("X-Amz-Signature", signature)
	uploadURL = strings.TrimRight(c.Endpoint, "/") + canonicalURI + "?" + q.Encode()
	if c.PublicBase != "" {
		publicURL = c.PublicBase + "/" + strings.TrimPrefix(key, "/")
	} else {
		publicURL = strings.TrimRight(c.Endpoint, "/") + canonicalURI
	}
	return uploadURL, publicURL, nil
}

func (c *S3Config) DeleteObject(key string) error {
	if !c.Enabled() {
		return fmt.Errorf("s3 not configured")
	}
	host := strings.TrimPrefix(strings.TrimPrefix(c.Endpoint, "https://"), "http://")
	url := fmt.Sprintf("%s/%s/%s", c.Endpoint, c.Bucket, strings.TrimPrefix(key, "/"))
	req, err := http.NewRequest(http.MethodDelete, url, nil)
	if err != nil {
		return err
	}
	if err := signV4(req, nil, c.AccessKey, c.SecretKey, c.Region, host); err != nil {
		return err
	}
	client := &http.Client{Timeout: 30 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return nil
	}
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return fmt.Errorf("s3 delete %d: %s", res.StatusCode, string(b))
	}
	return nil
}

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

// GetObject downloads an object so the API can stream it to the browser.
//
// Bucket CORS is only required when a client still requests the public URL directly.
// Rule: AllowedOrigins = the site origin (https://gethub.online), AllowedMethods = GET, HEAD,
// AllowedHeaders = Range, ExposeHeaders = Content-Range, Accept-Ranges, Content-Length.
func (c *S3Config) GetObject(key string) ([]byte, string, error) {
	if !c.Enabled() {
		return nil, "", fmt.Errorf("s3 not configured")
	}
	host := strings.TrimPrefix(strings.TrimPrefix(c.Endpoint, "https://"), "http://")
	url := fmt.Sprintf("%s/%s/%s", c.Endpoint, c.Bucket, key)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, "", err
	}
	if err := signV4(req, nil, c.AccessKey, c.SecretKey, c.Region, host); err != nil {
		return nil, "", err
	}
	client := &http.Client{Timeout: 60 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer res.Body.Close()
	b, err := io.ReadAll(io.LimitReader(res.Body, 42<<20))
	if err != nil {
		return nil, "", err
	}
	if res.StatusCode >= 300 {
		return nil, "", fmt.Errorf("s3 get %d: %s", res.StatusCode, string(b))
	}
	return b, res.Header.Get("Content-Type"), nil
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
