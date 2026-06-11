package config

import (
	"os"
	"path/filepath"
)

// GitCommit 由构建时注入（ldflags），运行时获取
var GitCommit = "unknown"

// Version 由构建时注入（ldflags），运行时获取
var Version = "unknown"

var (
	// SingBox paths
	SingBoxConfig = envOrDefault("SINGBOX_CONFIG", "/home/xfy/sing-box-config.json")
	SingBoxBin    = envOrDefault("SINGBOX_BIN", "/usr/local/bin/sing-box")
	SingBoxSvc    = envOrDefault("SINGBOX_SERVICE", "sing-box")
	ClashAPI      = envOrDefault("CLASH_API", "http://127.0.0.1:9090")
	ProxyPort     = envOrDefault("PROXY_PORT", "2080")

	// Dashboard data dir
	DataDir = envOrDefault("DASHBOARD_DATA_DIR", filepath.Join(homeDir(), ".hermes", "singbox-dashboard"))

	// Server
	ListenAddr = envOrDefault("LISTEN_ADDR", "0.0.0.0:9092")
)

func homeDir() string {
	h, _ := os.UserHomeDir()
	return h
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func LogPath() string           { return filepath.Join(DataDir, "sing-box.log") }
func SubscriptionsPath() string  { return filepath.Join(DataDir, "subscriptions.json") }
func RulesPath() string          { return filepath.Join(DataDir, "rules.json") }
