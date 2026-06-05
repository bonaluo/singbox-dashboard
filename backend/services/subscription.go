package services

import (
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
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
		Kind: models.KindURL,
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
	if err := SaveSubscriptions(store); err != nil {
		return err
	}
	// 清理缓存数据
	os.Remove(filepath.Join(config.DataDir, "subscription_data", id+".json"))
	// 清理配置文件中的节点，回退到空配置或直接删除
	os.Remove(config.SingBoxConfig)
	return nil
}

// ── 拉取订阅原始数据 ──

// GetCachedSubscriptionData 读取缓存的订阅解析数据
func GetCachedSubscriptionData(id string) (*FetchResult, error) {
	data, err := os.ReadFile(filepath.Join(config.DataDir, "subscription_data", id+".json"))
	if err != nil {
		return nil, fmt.Errorf("请先拉取解析: %w", err)
	}
	var cached FetchResult
	if err := json.Unmarshal(data, &cached); err != nil {
		return nil, fmt.Errorf("缓存数据损坏: %w", err)
	}
	return &cached, nil
}

type FetchResult struct {
	RawText    string            `json:"raw_text"`
	RawLines   []string          `json:"raw_lines"`
	NodeCount  int               `json:"node_count"`
	Nodes      []models.ProxyNode `json:"nodes"`
	UpdatedAt  string            `json:"updated_at"`
}

// FetchRaw 拉取订阅原始数据（不依赖已有记录）
func FetchRaw(subURL string) (string, error) {
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{Transport: tr, Timeout: 30 * time.Second}
	resp, err := client.Get(subURL)
	if err != nil {
		return "", fmt.Errorf("拉取失败: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("读取失败: %w", err)
	}
	return string(raw), nil
}

// ParseRaw 解析订阅原始数据
func ParseRaw(raw string) *FetchResult {
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		decoded = []byte(raw)
	}
	text := string(decoded)
	lines := strings.Split(strings.TrimSpace(text), "\n")
	nodes := parseSubscriptionLines(lines)
	result := &FetchResult{
		RawText:   text,
		RawLines:  lines,
		NodeCount: len(nodes),
		Nodes:     nodes,
		UpdatedAt: time.Now().Format("2006-01-02 15:04:05"),
	}
	return result
}

// SaveFetchResult 保存解析结果缓存
func SaveFetchResult(id string, result *FetchResult) error {
	dir := filepath.Join(config.DataDir, "subscription_data")
	os.MkdirAll(dir, 0755)
	data, _ := json.MarshalIndent(result, "", "  ")
	return os.WriteFile(filepath.Join(dir, id+".json"), data, 0644)
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

	// 持久化解析结果到文件
	os.MkdirAll(filepath.Join(config.DataDir, "subscription_data"), 0755)
	cacheData, _ := json.MarshalIndent(result, "", "  ")
	os.WriteFile(filepath.Join(config.DataDir, "subscription_data", id+".json"), cacheData, 0644)

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

// ── 聚合订阅 ──

// resolveSource 解析单个子源（已有订阅 ID 或临时 URL）并返回结果
func resolveSource(sourceID, sourceURL string) (int, []models.ProxyNode, string, error) {
	if sourceID != "" {
		// 已有订阅：读取缓存
		data, err := GetCachedSubscriptionData(sourceID)
		if err != nil {
			return 0, nil, "", fmt.Errorf("读取缓存失败: %w", err)
		}
		return data.NodeCount, data.Nodes, "", nil
	}

	if sourceURL != "" {
		// 临时链接：拉取并解析
		raw, err := FetchRaw(sourceURL)
		if err != nil {
			return 0, nil, "", fmt.Errorf("拉取失败: %w", err)
		}
		result := ParseRaw(raw)
		if result.NodeCount == 0 {
			return 0, nil, "", fmt.Errorf("未解析到有效节点")
		}
		return result.NodeCount, result.Nodes, "", nil
	}

	return 0, nil, "", fmt.Errorf("空源")
}

// resolveSourceWithLabel 解析单个子源并返回带名称的 SubscriptionSource 和节点数据
func resolveSourceWithLabel(sourceID, sourceURL string) (models.SubscriptionSource, []models.ProxyNode) {
	result := models.SubscriptionSource{
		ID:  sourceID,
		URL: sourceURL,
	}

	if sourceID != "" {
		// 从已知订阅中找到名称
		store, err := LoadSubscriptions()
		if err == nil {
			for _, s := range store.Subscriptions {
				if s.ID == sourceID {
					result.Name = s.Name
					break
				}
			}
		}
		count, nodes, _, err := resolveSource(sourceID, "")
		result.NodeCount = count
		if err != nil {
			result.Status = "error"
			result.Error = err.Error()
			return result, nil
		}
		result.Status = "ok"
		return result, nodes
	}

	if sourceURL != "" {
		result.Name = sourceURL
		count, nodes, _, err := resolveSource("", sourceURL)
		result.NodeCount = count
		if err != nil {
			result.Status = "error"
			result.Error = err.Error()
			return result, nil
		}
		result.Status = "ok"
		return result, nodes
	}

	result.Status = "error"
	result.Error = "空源"
	return result, nil
}

// LoadMergedSubscriptions 读取指定子源列表并合并去重
// 返回：合并后的节点 + 各子源状态
func LoadMergedSubscriptions(sources []models.SubscriptionSource) ([]models.ProxyNode, []models.SubscriptionSource) {
	allNodes := make(map[string]models.ProxyNode)
	var results []models.SubscriptionSource

	for _, src := range sources {
		srcResult, nodes := resolveSourceWithLabel(src.ID, src.URL)
		results = append(results, srcResult)

		if srcResult.Status != "ok" {
			continue
		}

		for _, n := range nodes {
			allNodes[n.Tag] = n
		}
	}

	var nodes []models.ProxyNode
	for _, n := range allNodes {
		nodes = append(nodes, n)
	}

	return nodes, results
}

// CreateMergedSubscription 创建聚合订阅
func CreateMergedSubscription(name string, sourceIDs []string, extraURLs []string) (*models.Subscription, []models.ProxyNode, []models.SubscriptionSource, error) {
	// 构建子源列表
	var sources []models.SubscriptionSource
	for _, sid := range sourceIDs {
		sources = append(sources, models.SubscriptionSource{ID: sid})
	}
	for _, u := range extraURLs {
		sources = append(sources, models.SubscriptionSource{URL: u})
	}

	nodes, results := LoadMergedSubscriptions(sources)

	// 创建订阅记录
	store, err := LoadSubscriptions()
	if err != nil {
		return nil, nil, nil, err
	}

	sub := models.Subscription{
		ID:      fmt.Sprintf("sub_%d", time.Now().UnixMilli()),
		Name:    name,
		Kind:    models.KindAggregated,
		Sources: results,
	}

	store.Subscriptions = append(store.Subscriptions, sub)
	if err := SaveSubscriptions(store); err != nil {
		return nil, nil, nil, err
	}

	// 更新 node_count 和 last_updated
	sub.NodeCount = len(nodes)
	sub.LastUpdated = time.Now().Format("2006-01-02 15:04:05")
	for i := range store.Subscriptions {
		if store.Subscriptions[i].ID == sub.ID {
			store.Subscriptions[i] = sub
		}
	}
	SaveSubscriptions(store)

	return &sub, nodes, results, nil
}

// UpdateAggregatedSubscription 更新聚合订阅（重新解析所有子源）
func UpdateAggregatedSubscription(subID string) ([]models.ProxyNode, []models.SubscriptionSource, error) {
	store, err := LoadSubscriptions()
	if err != nil {
		return nil, nil, fmt.Errorf("加载订阅失败: %w", err)
	}

	var sub *models.Subscription
	for i := range store.Subscriptions {
		if store.Subscriptions[i].ID == subID {
			sub = &store.Subscriptions[i]
			break
		}
	}
	if sub == nil {
		return nil, nil, fmt.Errorf("订阅未找到: %s", subID)
	}
	if sub.Kind != models.KindAggregated {
		return nil, nil, fmt.Errorf("非聚合订阅无法更新: %s", subID)
	}

	nodes, results := LoadMergedSubscriptions(sub.Sources)

	sub.Sources = results
	sub.NodeCount = len(nodes)
	sub.LastUpdated = time.Now().Format("2006-01-02 15:04:05")

	for i := range store.Subscriptions {
		if store.Subscriptions[i].ID == subID {
			store.Subscriptions[i] = *sub
		}
	}
	SaveSubscriptions(store)

	return nodes, results, nil
}

// ── 已应用订阅 ID 持久化 ──

func appliedSubIDPath() string {
	return filepath.Join(config.DataDir, "applied_sub_id")
}

func SaveAppliedSubscriptionID(id string) error {
	return os.WriteFile(appliedSubIDPath(), []byte(id+"\n"), 0644)
}

func LoadAppliedSubscriptionID() string {
	data, err := os.ReadFile(appliedSubIDPath())
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// ── 应用订阅到 sing-box（切换订阅） ──

func ApplySubscription(id string) error {
	// 查找订阅记录
	store, err := LoadSubscriptions()
	if err != nil {
		return err
	}
	var sub *models.Subscription
	for i := range store.Subscriptions {
		if store.Subscriptions[i].ID == id {
			sub = &store.Subscriptions[i]
			break
		}
	}
	if sub == nil {
		return fmt.Errorf("订阅未找到: %s", id)
	}

	// 读取节点数据
	var cachedNodes []models.ProxyNode
	if sub.Kind == models.KindAggregated {
		cachedNodes, _ = LoadMergedSubscriptions(sub.Sources)
	} else {
		data, e := os.ReadFile(filepath.Join(config.DataDir, "subscription_data", id+".json"))
		if e != nil {
			return fmt.Errorf("请先拉取解析订阅: %w", e)
		}
		var cached FetchResult
		if e := json.Unmarshal(data, &cached); e != nil {
			return fmt.Errorf("缓存数据损坏: %w", e)
		}
		cachedNodes = cached.Nodes
	}

	cfg, err := loadSingBoxConfig()
	if err != nil {
		// 无配置文件时生成最小模板
		cfg = map[string]interface{}{
			"log":      map[string]interface{}{"level": "info"},
			"inbounds": []interface{}{map[string]interface{}{
				"type": "mixed", "tag": "mixed-in",
				"listen": "0.0.0.0", "listen_port": 2080,
			}},
			"outbounds": []interface{}{},
			"route":     map[string]interface{}{"auto_detect_interface": true},
			"experimental": map[string]interface{}{
				"clash_api": map[string]interface{}{
					"external_controller": "0.0.0.0:9090",
				},
			},
		}
	}

	var newOutbounds []interface{}
	for _, n := range cachedNodes {
		ob := map[string]interface{}{
			"type":        n.Type,
			"tag":         n.Tag,
			"server":      n.Server,
			"server_port": n.Port,
		}
		// 从 raw_link 解析完整 vmess 配置
		if n.RawLink != "" && strings.HasPrefix(n.RawLink, "vmess://") {
			payload := n.RawLink[8:]
			if m := len(payload) % 4; m != 0 {
				payload += strings.Repeat("=", 4-m)
			}
			if data, e := base64.StdEncoding.DecodeString(payload); e == nil {
				var vm map[string]interface{}
				if json.Unmarshal(data, &vm) == nil {
					ob["uuid"] = vm["id"]
					ob["security"] = "auto"
					ob["alter_id"] = 0
					transport := map[string]interface{}{}
					if net, _ := vm["net"].(string); net == "ws" {
						transport["type"] = "ws"
						transport["path"] = vm["path"]
						if host, ok := vm["host"].(string); ok && host != "" {
							transport["headers"] = map[string]interface{}{"Host": host}
						}
					} else {
						transport["type"] = net
					}
					ob["transport"] = transport
					if tls, _ := vm["tls"].(string); tls == "tls" {
						ob["tls"] = map[string]interface{}{"enabled": true}
					}
				}
			}
		}
		newOutbounds = append(newOutbounds, ob)
	}

	// 构建 selector，排除非代理行（tag 含流量/套餐/到期/剩余/过滤等）
	// 同时按地区分组，用于后续生成地区 urltest 出站
	var tags []string
	regionGroups := make(map[string][]string)
	infoKws := []string{"流量", "套餐", "到期", "剩余", "过滤"}
	for _, n := range cachedNodes {
		if n.Type != "vmess" {
			continue
		}
		skip := false
		for _, kw := range infoKws {
			if strings.Contains(n.Tag, kw) {
				skip = true
				break
			}
		}
		if skip {
			continue
		}
		tags = append(tags, n.Tag)

		// 按地区归类
		region := detectRegion(n.Tag)
		if region == "其他" {
			continue
		}
		// detectRegion 返回 "🇺🇸 美国" 格式，取空格后的中文名
		name := region
		if idx := strings.Index(region, " "); idx > 0 {
			name = region[idx+1:]
		}
		regionGroups[name] = append(regionGroups[name], n.Tag)
	}
	tags = append(tags, "direct")
	newOutbounds = append(newOutbounds, map[string]interface{}{
		"type": "selector", "tag": "proxy",
		"outbounds": tags,
		"default":   tags[0],
	})
	newOutbounds = append(newOutbounds, map[string]interface{}{
		"type": "direct", "tag": "direct",
	})

	// 按地区生成 urltest 出站组（自动选延迟最低节点，支持按域名分流）
	for name, regionTags := range regionGroups {
		if len(regionTags) == 0 {
			continue
		}
		newOutbounds = append(newOutbounds, map[string]interface{}{
			"type":      "urltest",
			"tag":       name,
			"outbounds": regionTags,
		})
	}

	// 全节点 urltest 组，用于 rule_set 下载（download_detour），避免 selector 无选中节点的问题
	var autoTags []string
	for _, t := range tags {
		if t != "direct" {
			autoTags = append(autoTags, t)
		}
	}
	newOutbounds = append(newOutbounds, map[string]interface{}{
		"type":      "urltest",
		"tag":       "自动选择",
		"outbounds": autoTags,
	})

	cfg["outbounds"] = newOutbounds

	// 清理可能残留的无效 default_domain_resolver
	if route, ok := cfg["route"].(map[string]interface{}); ok {
		if route["default_domain_resolver"] == "dns-local" {
			delete(route, "default_domain_resolver")
		}
	}

	if err := WriteSingBoxConfig(cfg); err != nil {
		return err
	}
	// 写完后启动/重启 sing-box
	if err := RestartService(); err != nil {
		return err
	}
	// 持久化已应用的订阅 ID（重启后前端可恢复标识）
	return SaveAppliedSubscriptionID(id)
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

		// dedup — 相同 tag 只保留第一条
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
