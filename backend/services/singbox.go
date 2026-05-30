package services

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"singbox-dashboard/config"
	"singbox-dashboard/models"
	"strings"
	"sync"
	"time"
)

// ═══════════════════════════════════════════════════════════
//  sing-box 核心服务：读/写配置、服务管理、Clash API
// ═══════════════════════════════════════════════════════════

var mu sync.RWMutex

// ── 服务状态 ──

func GetStatus() models.StatusResponse {
	cfg, _ := loadSingBoxConfig()
	current := getClashCurrent()
	running := isRunning()
	uptime := ""
	if running {
		uptime = getUptime()
	}
	total := 0
	if cfg != nil {
		for _, ob := range cfg["outbounds"].([]interface{}) {
			m := ob.(map[string]interface{})
			t := m["type"].(string)
			if t != "selector" && t != "direct" && t != "block" && t != "dns" {
				total++
			}
		}
	}
	return models.StatusResponse{
		Running:    running,
		Current:    current,
		Uptime:     uptime,
		TotalNodes: total,
	}
}

// ── 获取所有代理节点 ──

func GetProxies() []models.ProxyNode {
	cfg, err := loadSingBoxConfig()
	if err != nil {
		return nil
	}
	var nodes []models.ProxyNode
	for _, ob := range cfg["outbounds"].([]interface{}) {
		m := ob.(map[string]interface{})
		t, _ := m["type"].(string)
		if t == "selector" || t == "direct" || t == "block" {
			continue
		}
		tag, _ := m["tag"].(string)
		server, _ := m["server"].(string)
		port := 0
		if p, ok := m["server_port"].(float64); ok {
			port = int(p)
		}
		nodes = append(nodes, models.ProxyNode{
			Tag:    tag,
			Type:   t,
			Server: server,
			Port:   port,
			Region: detectRegion(tag),
		})
	}
	return nodes
}

// ── 切换节点 ──

func SwitchProxy(tag string) error {
	body := fmt.Sprintf(`{"name":"%s"}`, tag)
	cmd := exec.Command("curl", "-s", "--noproxy", "*", "-X", "PUT",
		config.ClashAPI+"/proxies/proxy",
		"-H", "Content-Type: application/json",
		"-d", body)
	return cmd.Run()
}

// ── 获取节点延迟 ──

func GetProxyDelay(tag string, timeout int) int {
	cmd := exec.Command("curl", "-s", "--noproxy", "*",
		fmt.Sprintf("%s/proxies/%s/delay?url=https://www.google.com&timeout=%d",
			config.ClashAPI, tag, timeout))
	out, err := cmd.Output()
	if err != nil {
		return -1
	}
	var result struct {
		Delay int `json:"delay"`
	}
	json.Unmarshal(out, &result)
	return result.Delay
}

// ── 连接列表 ──

func GetConnections() []map[string]interface{} {
	cmd := exec.Command("curl", "-s", "--noproxy", "*", config.ClashAPI+"/connections")
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	var result struct {
		Connections []map[string]interface{} `json:"connections"`
	}
	json.Unmarshal(out, &result)
	return result.Connections
}

// ── 服务重启 ──

func RestartService() error {
	mu.Lock()
	defer mu.Unlock()
	cmd := exec.Command("systemctl", "--user", "restart", config.SingBoxSvc)
	if err := cmd.Run(); err != nil {
		return err
	}
	time.Sleep(2 * time.Second)
	return nil
}

// ── 读写 sing-box 配置 ──

func WriteSingBoxConfig(cfg map[string]interface{}) error {
	mu.Lock()
	defer mu.Unlock()
	// 备份
	backup := config.SingBoxConfig + ".bak"
	_ = copyFile(config.SingBoxConfig, backup)
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(config.SingBoxConfig, append(data, '\n'), 0644)
}

// ── Clash API 当前节点 ──

func getClashCurrent() string {
	cmd := exec.Command("curl", "-s", "--noproxy", "*", config.ClashAPI+"/proxies/proxy")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	var result struct {
		Now string `json:"now"`
	}
	json.Unmarshal(out, &result)
	return result.Now
}

// ── 内部辅助 ──

func loadSingBoxConfig() (map[string]interface{}, error) {
	data, err := os.ReadFile(config.SingBoxConfig)
	if err != nil {
		return nil, err
	}
	var cfg map[string]interface{}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func isRunning() bool {
	cmd := exec.Command("systemctl", "--user", "is-active", config.SingBoxSvc)
	out, _ := cmd.Output()
	return strings.TrimSpace(string(out)) == "active"
}

func getUptime() string {
	cmd := exec.Command("systemctl", "--user", "show", config.SingBoxSvc,
		"--property=ActiveEnterTimestamp")
	out, _ := cmd.Output()
	return strings.TrimSpace(strings.Replace(string(out), "ActiveEnterTimestamp=", "", 1))
}

func detectRegion(tag string) string {
	runes := []rune(tag)
	upper := strings.ToUpper(tag)

	// 方式1: 国旗 emoji 开头 → "🇸🇬 SG"
	for i := 0; i < len(runes)-1; i++ {
		if runes[i] >= 0x1F1E6 && runes[i] <= 0x1F1FF &&
			runes[i+1] >= 0x1F1E6 && runes[i+1] <= 0x1F1FF {
			code := string([]rune{
				rune(runes[i] - 0x1F1E6 + 'A'),
				rune(runes[i+1] - 0x1F1E6 + 'A'),
			})
			return string(runes[i:i+2]) + " " + code
		}
	}

	// 方式2: [HK] 方括号开头 → "HK"
	if len(runes) >= 4 && runes[0] == '[' {
		end := -1
		for j := 1; j < len(runes) && j <= 6; j++ {
			if runes[j] == ']' {
				end = j
				break
			}
		}
		if end >= 2 {
			code := string(runes[1:end])
			if isCapsCode(code) {
				return strings.ToUpper(code)
			}
		}
	}

	// 方式3: 纯大写字码开头 (如 "SG新加坡-01" → "SG")
	parts := strings.Fields(upper)
	if len(parts) > 0 {
		first := strings.Trim(parts[0], "_-[]")
		if isCapsCode(first) {
			return first
		}
	}

	return "其他"
}

func isCapsCode(s string) bool {
	if len(s) < 2 || len(s) > 3 {
		return false
	}
	for _, r := range s {
		if r < 'A' || r > 'Z' {
			return false
		}
	}
	return true
}

func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0644)
}
