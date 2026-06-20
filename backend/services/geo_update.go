package services

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
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

// RuleSetStatus 单个规则集文件状态
type RuleSetStatus struct {
	Tag  string `json:"tag"`
	Size int64  `json:"size"`  // 文件大小（字节），-1 表示不存在
	OK   bool   `json:"ok"`    // 文件存在且大于 0
}

// GetRuleSetStatuses 返回当前 sing-box 配置中所有 rule_set 的状态
// 从 route.rule_set 动态读取，不再写死 geoip-cn/geosite-cn
func GetRuleSetStatuses() []RuleSetStatus {
	var result []RuleSetStatus
	tags := getConfiguredRuleSetTags()
	for _, tag := range tags {
		path := filepath.Join(config.DataDir, "ruleset", tag+".srs")
		info, err := os.Stat(path)
		if err != nil {
			result = append(result, RuleSetStatus{Tag: tag, Size: -1, OK: false})
		} else {
			result = append(result, RuleSetStatus{Tag: tag, Size: info.Size(), OK: info.Size() > 0})
		}
	}
	return result
}

// getConfiguredRuleSetTags 从 sing-box 配置的 route.rule_set 提取所有 tag
// 按配置顺序去重返回
func getConfiguredRuleSetTags() []string {
	cfg, err := loadSingBoxConfig()
	if err != nil {
		return nil
	}
	route, ok := cfg["route"].(map[string]interface{})
	if !ok {
		return nil
	}
	rsList, ok := route["rule_set"].([]interface{})
	if !ok {
		return nil
	}
	seen := make(map[string]bool)
	var tags []string
	for _, rs := range rsList {
		m, ok := rs.(map[string]interface{})
		if !ok {
			continue
		}
		tag, _ := m["tag"].(string)
		if tag == "" || seen[tag] {
			continue
		}
		seen[tag] = true
		tags = append(tags, tag)
	}
	return tags
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

// DownloadGeoRuleSets 下载配置中引用的 geo 规则集文件到本地
// 只下载 route.rule_set 中实际定义的 tag，避免下载无关文件
// 优先走内部代理（sing-box mixed-in 端口 2080），代理不可用时直连
// 多镜像回退，下载失败时不阻塞（保留旧文件）
func DownloadGeoRuleSets() error {
	// 已知的 SagerNet 官方仓库映射（仅对 geosite-*/geoip-* 系列有效）
	defaultRepo := map[string]string{
		"geoip-cn":   "SagerNet/sing-geoip",
		"geosite-cn": "SagerNet/sing-geosite",
	}

	// 尝试通过内部代理下载（sing-box mixed-in 支持 HTTP 代理）
	proxyURL, _ := url.Parse("http://127.0.0.1:2080")
	proxyTransport := &http.Transport{Proxy: http.ProxyURL(proxyURL)}
	proxyClient := &http.Client{Transport: proxyTransport, Timeout: 60 * time.Second}

	// 回退直连客户端
	directClient := &http.Client{Timeout: 30 * time.Second}

	for _, tag := range getConfiguredRuleSetTags() {
		repo, ok := defaultRepo[tag]
		if !ok {
			// 自定义 rule_set 暂不自动下载
			continue
		}
		filename := tag + ".srs"
		path := filepath.Join(config.DataDir, "ruleset", filename)
		os.MkdirAll(filepath.Dir(path), 0755)

		urls := []string{
			fmt.Sprintf("https://raw.githubusercontent.com/%s/rule-set/%s", repo, filename),
			fmt.Sprintf("https://github.com/%s/raw/rule-set/%s", repo, filename),
		}

		var lastErr error
		for _, u := range urls {
			// 先走代理
			resp, err := proxyClient.Get(u)
			if err != nil {
				// 代理不可用，回退直连
				resp, err = directClient.Get(u)
			}
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
			log.Printf("✅ 已更新 rule-set: %s (%d bytes)", tag, len(data))
			// 单个 rule-set 下载完成就广播一次，前端能即时看到
			ForceBroadcastRuleSets()
			break
		}
		if lastErr != nil {
			log.Printf("⚠️ 更新 rule-set %s 失败（保留旧文件）: %v", tag, lastErr)
		}
	}
	// 兜底：所有下载完成后再广播一次
	ForceBroadcastRuleSets()
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
		// 检测占位 .srs 文件：ApplyRules 启动时若文件缺失会生成 17 字节的空占位
		// 占位文件过小时无论 interval 设置如何都强制下载一次
		hasPlaceholder := hasPlaceholderRuleSet()
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
			if shouldUpdate || hasPlaceholder {
				if hasPlaceholder {
					log.Println("🔄 检测到 .srs 占位文件，强制下载真实规则集...")
				} else {
					log.Println("🔄 geo 规则集需要更新，开始下载...")
				}
				if err := DownloadGeoRuleSets(); err == nil {
					cfg.LastUpdated = time.Now().Format(time.RFC3339)
					SaveGeoUpdateConfig(cfg)
				}
			}
		} else if hasPlaceholder {
			// interval 为 off 但检测到占位文件：仍然强制下载一次，
			// 避免新环境永远停留在占位文件
			log.Println("🔄 检测到 .srs 占位文件，强制下载真实规则集（interval=off）...")
			if err := DownloadGeoRuleSets(); err == nil {
				cfg.LastUpdated = time.Now().Format(time.RFC3339)
				SaveGeoUpdateConfig(cfg)
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

// placeholderMaxSize 占位 .srs 文件的最大字节数
// ApplyRules 启动时若 .srs 缺失会调用 sing-box rule-set compile 生成
// 17 字节的空 rule-set，1KB 阈值足以区分占位与真实规则集
const placeholderMaxSize = 1024

// hasPlaceholderRuleSet 检查配置中引用的 rule_set 是否存在占位 .srs 文件
// 真实规则集通常 30KB+，占位文件 < 1KB
func hasPlaceholderRuleSet() bool {
	tags := getConfiguredRuleSetTags()
	if len(tags) == 0 {
		return false
	}
	for _, tag := range tags {
		path := filepath.Join(config.DataDir, "ruleset", tag+".srs")
		info, err := os.Stat(path)
		if err != nil {
			return true // 文件不存在
		}
		if info.Size() < placeholderMaxSize {
			return true
		}
	}
	return false
}
