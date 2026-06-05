package services

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"singbox-dashboard/config"
	"time"
)

// ── Geo Rule-Set 自动更新 ──

type GeoUpdateConfig struct {
	Interval    string `json:"interval"`              // "off" / "1d" / "7d" / "30d"
	LastUpdated string `json:"last_updated,omitempty"` // ISO 时间戳
}

func geoUpdateConfigPath() string {
	return filepath.Join(config.DataDir, "geo-update-config.json")
}

func SaveGeoUpdateConfig(cfg GeoUpdateConfig) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(geoUpdateConfigPath(), append(data, '\n'), 0644)
}

func LoadGeoUpdateConfig() GeoUpdateConfig {
	data, err := os.ReadFile(geoUpdateConfigPath())
	if err != nil {
		return GeoUpdateConfig{Interval: "off"}
	}
	var cfg GeoUpdateConfig
	json.Unmarshal(data, &cfg)
	if cfg.Interval == "" {
		cfg.Interval = "off"
	}
	return cfg
}

// DownloadGeoRuleSets 下载 geoip/geosite 规则集文件到本地
// 多镜像回退，下载失败时不阻塞（保留旧文件）
func DownloadGeoRuleSets() error {
	entries := []struct {
		Tag  string
		Repo string
	}{
		{"geoip-cn", "SagerNet/sing-geoip"},
		{"geosite-cn", "SagerNet/sing-geosite"},
	}

	for _, e := range entries {
		filename := e.Tag + ".srs"
		path := filepath.Join(config.DataDir, "ruleset", filename)
		os.MkdirAll(filepath.Dir(path), 0755)

		urls := []string{
			fmt.Sprintf("https://raw.githubusercontent.com/%s/rule-set/%s", e.Repo, filename),
			fmt.Sprintf("https://github.com/%s/raw/rule-set/%s", e.Repo, filename),
		}

		var lastErr error
		for _, u := range urls {
			resp, err := http.Get(u)
			if err != nil {
				lastErr = fmt.Errorf("%s: %w", u, err)
				continue
			}
			if resp.StatusCode != http.StatusOK {
				resp.Body.Close()
				lastErr = fmt.Errorf("%s: HTTP %d", u, resp.StatusCode)
				continue
			}
			data, err := io.ReadAll(resp.Body)
			resp.Body.Close()
			if err != nil {
				lastErr = fmt.Errorf("%s: read: %w", u, err)
				continue
			}
			if err := os.WriteFile(path, data, 0644); err != nil {
				return fmt.Errorf("写入 %s: %w", path, err)
			}
			lastErr = nil
			log.Printf("✅ 已更新 rule-set: %s (%d bytes)", e.Tag, len(data))
			break
		}
		if lastErr != nil {
			log.Printf("⚠️ 更新 rule-set %s 失败（保留旧文件）: %v", e.Tag, lastErr)
		}
	}
	return nil
}

// parseInterval 将 "1d"/"7d"/"30d" 转为 time.Duration，空或非法返回 0
func parseInterval(s string) time.Duration {
	switch s {
	case "1d":
		return 24 * time.Hour
	case "7d":
		return 7 * 24 * time.Hour
	case "30d":
		return 30 * 24 * time.Hour
	default:
		return 0
	}
}

// StartGeoUpdateLoop 启动后台定时更新 geo 规则集的 goroutine
func StartGeoUpdateLoop() {
	go func() {
		// 启动时先检查是否需要立即更新
		cfg := LoadGeoUpdateConfig()
		if cfg.Interval != "off" {
			shouldUpdate := false
			if cfg.LastUpdated == "" {
				shouldUpdate = true
			} else {
				lastTime, err := time.Parse(time.RFC3339, cfg.LastUpdated)
				if err != nil || time.Since(lastTime) > parseInterval(cfg.Interval) {
					shouldUpdate = true
				}
			}
			if shouldUpdate {
				log.Println("🔄 geo 规则集需要更新，开始下载...")
				if err := DownloadGeoRuleSets(); err == nil {
					cfg.LastUpdated = time.Now().Format(time.RFC3339)
					SaveGeoUpdateConfig(cfg)
				}
			}
		}

		// 定期检查
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			cfg := LoadGeoUpdateConfig()
			if cfg.Interval == "off" {
				continue
			}
			interval := parseInterval(cfg.Interval)
			if interval == 0 {
				continue
			}
			if cfg.LastUpdated == "" {
				continue
			}
			lastTime, err := time.Parse(time.RFC3339, cfg.LastUpdated)
			if err != nil {
				continue
			}
			if time.Since(lastTime) >= interval {
				log.Printf("🔄 geo 规则集已过配置间隔(%s)，开始更新...", cfg.Interval)
				if err := DownloadGeoRuleSets(); err == nil {
					cfg.LastUpdated = time.Now().Format(time.RFC3339)
					SaveGeoUpdateConfig(cfg)
				}
			}
		}
	}()
}
