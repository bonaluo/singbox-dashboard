package services

import (
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"singbox-dashboard/config"
	"singbox-dashboard/models"
	"strings"
	"time"
)

// ═══════════════════════════════════════════════════════════
//  订阅管理：存储、拉取、解析
// ═══════════════════════════════════════════════════════════

// ── 加载订阅列表 ──

func LoadSubscriptions() (*models.SubscriptionStore, error) {
	store := &models.SubscriptionStore{}
	data, err := os.ReadFile(config.SubscriptionsPath())
	if err != nil {
		if os.IsNotExist(err) {
			return store, nil
		}
		return nil, err
	}
	if err := json.Unmarshal(data, store); err != nil {
		return nil, err
	}
	if store.Subscriptions == nil {
		store.Subscriptions = []models.Subscription{}
	}
	return store, nil
}

// ── 保存订阅列表 ──

func SaveSubscriptions(store *models.SubscriptionStore) error {
	os.MkdirAll(config.DataDir, 0755)
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(config.SubscriptionsPath(), append(data, '\n'), 0644)
}

// ── 添加订阅 ──

func AddSubscription(name, url string) (*models.Subscription, error) {
	store, err := LoadSubscriptions()
	if err != nil {
		return nil, err
	}
	sub := models.Subscription{
		ID:   fmt.Sprintf("sub_%d", time.Now().UnixMilli()),
		Name: name,
		URL:  url,
	}
	store.Subscriptions = append(store.Subscriptions, sub)
	if err := SaveSubscriptions(store); err != nil {
		return nil, err
	}
	return &sub, nil
}

// ── 删除订阅 ──

func DeleteSubscription(id string) error {
	store, err := LoadSubscriptions()
	if err != nil {
		return err
	}
	var found bool
	newSubs := make([]models.Subscription, 0, len(store.Subscriptions))
	for _, s := range store.Subscriptions {
		if s.ID != id {
			newSubs = append(newSubs, s)
		} else {
			found = true
		}
	}
	if !found {
		return fmt.Errorf("subscription not found: %s", id)
	}
	store.Subscriptions = newSubs
	return SaveSubscriptions(store)
}

// ── 拉取订阅原始数据 ──

type FetchResult struct {
	RawText    string            `json:"raw_text"`
	RawLines   []string          `json:"raw_lines"`
	NodeCount  int               `json:"node_count"`
	Nodes      []models.ProxyNode `json:"nodes"`
	UpdatedAt  string            `json:"updated_at"`
}

func FetchAndParseSubscription(id string) (*FetchResult, error) {
	store, err := LoadSubscriptions()
	if err != nil {
		return nil, err
	}
	var subURL string
	for _, s := range store.Subscriptions {
		if s.ID == id {
			subURL = s.URL
			break
		}
	}
	if subURL == "" {
		return nil, fmt.Errorf("subscription not found: %s", id)
	}

	// 拉取（跳过 SSL 验证，兼容各种订阅服务商）
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{Transport: tr, Timeout: 30 * time.Second}
	resp, err := client.Get(subURL)
	if err != nil {
		return nil, fmt.Errorf("拉取失败: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取失败: %w", err)
	}

	// Base64 解码
	decoded, err := base64.StdEncoding.DecodeString(string(raw))
	if err != nil {
		// 有些订阅返回未编码的纯文本
		decoded = raw
	}

	text := string(decoded)
	lines := strings.Split(strings.TrimSpace(text), "\n")

	// 解析出节点
	nodes := parseSubscriptionLines(lines)

	// 更新订阅
	result := &FetchResult{
		RawText:   text,
		RawLines:  lines,
		NodeCount: len(nodes),
		Nodes:     nodes,
		UpdatedAt: time.Now().Format("2006-01-02 15:04:05"),
	}

	// 保存更新时间到 store
	for i := range store.Subscriptions {
		if store.Subscriptions[i].ID == id {
			store.Subscriptions[i].LastUpdated = result.UpdatedAt
			store.Subscriptions[i].NodeCount = len(nodes)
		}
	}
	SaveSubscriptions(store)

	return result, nil
}

// ── 解析 vmess:// / ss:// 等链接 ──

func parseSubscriptionLines(lines []string) []models.ProxyNode {
	var nodes []models.ProxyNode
	seen := make(map[string]bool) // dedup

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		var tag, typ, server string
		var port int

		if strings.HasPrefix(line, "vmess://") {
			payload := line[8:]
			// 补齐 base64 padding
			if m := len(payload) % 4; m != 0 {
				payload += strings.Repeat("=", 4-m)
			}
			data, err := base64.StdEncoding.DecodeString(payload)
			if err != nil {
				continue
			}
			var nd map[string]interface{}
			if err := json.Unmarshal(data, &nd); err != nil {
				continue
			}

			tag, _ = nd["ps"].(string)
			typ = "vmess"
			server, _ = nd["add"].(string)
			if p, ok := nd["port"]; ok {
				port = toInt(p)
			}
		} else if strings.HasPrefix(line, "ss://") {
			// 简化 SS 解析
			tag = fmt.Sprintf("SS-%s", line[5:20])
			typ = "shadowsocks"
			server = "unknown"
		} else {
			continue
		}

		// 跳过信息行（套餐/流量等）
		infoKeywords := []string{"套餐", "流量", "重置", "到期", "剩余", "过滤"}
		skip := false
		for _, kw := range infoKeywords {
			if strings.Contains(tag, kw) {
				skip = true
				break
			}
		}
		if skip {
			continue
		}

		if seen[tag] {
			continue
		}
		seen[tag] = true

		nodes = append(nodes, models.ProxyNode{
			Tag:     tag,
			Type:    typ,
			Server:  server,
			Port:    port,
			Region:  detectRegion(tag),
			RawLink: line,
		})
	}

	return nodes
}

func toInt(v interface{}) int {
	switch val := v.(type) {
	case float64:
		return int(val)
	case string:
		var i int
		fmt.Sscanf(val, "%d", &i)
		return i
	case json.Number:
		i, _ := val.Int64()
		return int(i)
	}
	return 0
}
