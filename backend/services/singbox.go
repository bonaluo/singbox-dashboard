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
	// 方式1: 从 tag 提取国旗后的地区码 (如 "🇸🇬 SG新加坡-01" → SG)
	codeMap := map[string]string{
		"SG": "新加坡", "HK": "香港", "JP": "日本", "KR": "韩国",
		"US": "美国", "USA": "美国", "TW": "台湾",
		"IN": "印度", "AU": "澳大利亚", "UK": "英国",
		"CA": "加拿大", "DE": "德国", "FR": "法国",
		"RU": "俄罗斯", "BR": "巴西", "ID": "印尼", "TH": "泰国",
		"MY": "马来西亚", "PH": "菲律宾", "VN": "越南", "TR": "土耳其",
		"IT": "意大利", "ES": "西班牙", "NL": "荷兰", "SE": "瑞典",
		"CH": "瑞士", "PL": "波兰", "AR": "阿根廷", "MX": "墨西哥",
	}
	// 提取国旗 emoji 后的2-3位大写字母码
	runes := []rune(tag)
	for i := 0; i < len(runes); i++ {
		// 检测国旗 emoji (Regional Indicator, U+1F1E6-U+1F1FF)
		if runes[i] >= 0x1F1E6 && runes[i] <= 0x1F1FF && i+1 < len(runes) &&
			runes[i+1] >= 0x1F1E6 && runes[i+1] <= 0x1F1FF {
			// 跳过国旗和后面的空格
			j := i + 2
			for j < len(runes) && runes[j] == ' ' {
				j++
			}
			// 提取大写字码
			code := []rune{}
			for j < len(runes) && ((runes[j] >= 'A' && runes[j] <= 'Z') || (runes[j] >= 'a' && runes[j] <= 'z')) {
				code = append(code, runes[j])
				j++
			}
			codeStr := strings.ToUpper(string(code))
			if name, ok := codeMap[codeStr]; ok {
				return name
			}
			break // 已处理过国旗，不再重复
		}
	}

	// 方式2: 兜底关键词匹配
	mapping := map[string]string{
		"新加坡": "新加坡", "香港": "香港", "日本": "日本",
		"美国": "美国", "台湾": "台湾", "印度": "印度",
		"澳大利亚": "澳大利亚", "英国": "英国", "加拿大": "加拿大",
		"德国": "德国", "法国": "法国", "韩国": "韩国",
	}
	for key, region := range mapping {
		if strings.Contains(tag, key) {
			return region
		}
	}
	return "其他"
}

func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0644)
}
