package services

import (
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
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

func AddSubscription(name, url string, useProxy bool, content string) (*models.Subscription, error) {
	store, err := LoadSubscriptions()
	if err != nil {
		return nil, err
	}
	sub := models.Subscription{
		ID:       fmt.Sprintf("sub_%d", time.Now().UnixMilli()),
		Name:     name,
		URL:      url,
		Kind:     models.KindURL,
		UseProxy: useProxy,
		Content:  content,
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

// fetchTransport 构造拉取用的 http.Transport；useProxy 时走 sing-box 本地代理
func fetchTransport(useProxy bool) *http.Transport {
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	if useProxy {
		tr.Proxy = http.ProxyURL(&url.URL{Scheme: "http", Host: "127.0.0.1:2080"})
	}
	return tr
}

// FetchRaw 拉取订阅原始数据（不依赖已有记录）
func FetchRaw(subURL string, useProxy bool) (string, error) {
	client := &http.Client{Transport: fetchTransport(useProxy), Timeout: 30 * time.Second}
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
	var useProxy bool
	var content string
	for _, s := range store.Subscriptions {
		if s.ID == id {
			subURL = s.URL
			useProxy = s.UseProxy
			content = s.Content
			break
		}
	}
	if subURL == "" && content == "" {
		return nil, fmt.Errorf("subscription not found: %s", id)
	}

	var raw string
	if content != "" {
		// 直接粘贴的订阅内容，无需网络拉取
		raw = content
	} else {
		// 拉取（跳过 SSL 验证，兼容各种订阅服务商；按订阅设置决定是否走代理）
		client := &http.Client{Transport: fetchTransport(useProxy), Timeout: 30 * time.Second}
		resp, err := client.Get(subURL)
		if err != nil {
			return nil, fmt.Errorf("拉取失败: %w", err)
		}
		defer resp.Body.Close()

		rawBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("读取失败: %w", err)
		}
		raw = string(rawBytes)
	}

	// Base64 解码
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		// 有些订阅返回未编码的纯文本
		decoded = []byte(raw)
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
func resolveSource(sourceID, sourceURL string, useProxy bool) (int, []models.ProxyNode, string, error) {
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
		raw, err := FetchRaw(sourceURL, useProxy)
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
func resolveSourceWithLabel(sourceID, sourceURL string, useProxy bool) (models.SubscriptionSource, []models.ProxyNode) {
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
		count, nodes, _, err := resolveSource(sourceID, "", useProxy)
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
		count, nodes, _, err := resolveSource("", sourceURL, useProxy)
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
func LoadMergedSubscriptions(sources []models.SubscriptionSource, useProxy bool) ([]models.ProxyNode, []models.SubscriptionSource) {
	allNodes := make(map[string]models.ProxyNode)
	var results []models.SubscriptionSource

	for _, src := range sources {
		srcResult, nodes := resolveSourceWithLabel(src.ID, src.URL, useProxy)
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
func CreateMergedSubscription(name string, sourceIDs []string, extraURLs []string, useProxy bool) (*models.Subscription, []models.ProxyNode, []models.SubscriptionSource, error) {
	// 构建子源列表
	var sources []models.SubscriptionSource
	for _, sid := range sourceIDs {
		sources = append(sources, models.SubscriptionSource{ID: sid})
	}
	for _, u := range extraURLs {
		sources = append(sources, models.SubscriptionSource{URL: u})
	}

	nodes, results := LoadMergedSubscriptions(sources, useProxy)

	// 创建订阅记录
	store, err := LoadSubscriptions()
	if err != nil {
		return nil, nil, nil, err
	}

	sub := models.Subscription{
		ID:       fmt.Sprintf("sub_%d", time.Now().UnixMilli()),
		Name:     name,
		Kind:     models.KindAggregated,
		UseProxy: useProxy,
		Sources:  results,
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

	nodes, results := LoadMergedSubscriptions(sub.Sources, sub.UseProxy)

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

// UpdateSubscriptionProxy 切换订阅的 use_proxy 设置
func UpdateSubscriptionProxy(id string, useProxy bool) error {
	store, err := LoadSubscriptions()
	if err != nil {
		return err
	}
	for i := range store.Subscriptions {
		if store.Subscriptions[i].ID == id {
			store.Subscriptions[i].UseProxy = useProxy
			return SaveSubscriptions(store)
		}
	}
	return fmt.Errorf("subscription not found: %s", id)
}

// UpdateSubscriptionContent 更新订阅的粘贴内容（非空时覆盖，空串不覆盖）
func UpdateSubscriptionContent(id, content string) error {
	store, err := LoadSubscriptions()
	if err != nil {
		return err
	}
	for i := range store.Subscriptions {
		if store.Subscriptions[i].ID == id {
			if content != "" {
				store.Subscriptions[i].Content = content
			}
			return SaveSubscriptions(store)
		}
	}
	return fmt.Errorf("subscription not found: %s", id)
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
		cachedNodes, _ = LoadMergedSubscriptions(sub.Sources, sub.UseProxy)
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
		newOutbounds = append(newOutbounds, nodeOutbound(n))
	}

	// 构建 selector（全部代理节点 + direct），同时按地区分组生成地区 urltest 出站
	var tags []string
	regionGroups := make(map[string][]string)
	for _, n := range cachedNodes {
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

	// selector 默认选中第一个非信息节点
	def := tags[0]
	for _, t := range tags {
		if !isInfoNode(t) {
			def = t
			break
		}
	}
	newOutbounds = append(newOutbounds, map[string]interface{}{
		"type": "selector", "tag": "proxy",
		"outbounds": tags,
		"default":   def,
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
	// 应用分组规则重建出站组
	ApplyGroupRules()
	// 持久化已应用的订阅 ID（重启后前端可恢复标识）
	return SaveAppliedSubscriptionID(id)
}

// ── 解析订阅链接（vmess / vless / trojan / hysteria2 / hysteria / tuic / ss）──

func parseSubscriptionLines(lines []string) []models.ProxyNode {
	var nodes []models.ProxyNode
	seen := make(map[string]bool) // dedup：按原始链接去重

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		node, ok := parseNodeLink(line)
		if !ok {
			continue
		}
		// 完全相同的原始行只保留第一条（如多行重复的"剩余流量"信息行）
		key := node.RawLink
		if key == "" {
			key = node.Tag
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		nodes = append(nodes, node)
	}

	// 信息节点排到最上面（剩余流量/套餐/到期/过滤等），真实节点随后
	var infoNodes, realNodes []models.ProxyNode
	for _, n := range nodes {
		if n.IsInfo {
			infoNodes = append(infoNodes, n)
		} else {
			realNodes = append(realNodes, n)
		}
	}
	return append(infoNodes, realNodes...)
}

// parseNodeLink 按协议前缀分发解析，返回节点（含完整 sing-box 出站配置）
func parseNodeLink(line string) (models.ProxyNode, bool) {
	switch {
	case strings.HasPrefix(line, "vmess://"):
		return parseVmessLink(line)
	case strings.HasPrefix(line, "vless://"):
		return parseVlessLink(line)
	case strings.HasPrefix(line, "trojan://"):
		return parseTrojanLink(line)
	case strings.HasPrefix(line, "hysteria2://"), strings.HasPrefix(line, "hy2://"):
		return parseHysteria2Link(line)
	case strings.HasPrefix(line, "hysteria://"):
		return parseHysteriaLink(line)
	case strings.HasPrefix(line, "tuic://"):
		return parseTuicLink(line)
	case strings.HasPrefix(line, "ss://"):
		return parseSSLink(line)
	}
	return models.ProxyNode{}, false
}

// ── vmess://base64(json) ──

func parseVmessLink(line string) (models.ProxyNode, bool) {
	payload := line[8:]
	if m := len(payload) % 4; m != 0 {
		payload += strings.Repeat("=", 4-m)
	}
	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return models.ProxyNode{}, false
	}
	var nd map[string]interface{}
	if err := json.Unmarshal(data, &nd); err != nil {
		return models.ProxyNode{}, false
	}

	tag, _ := nd["ps"].(string)
	server, _ := nd["add"].(string)
	port := toInt(nd["port"])
	if server == "" || port == 0 {
		return models.ProxyNode{}, false
	}

	ob := map[string]interface{}{
		"type":        "vmess",
		"tag":         tag,
		"server":      server,
		"server_port": port,
		"security":    "auto",
		"alter_id":    0,
	}
	if id, ok := nd["id"].(string); ok && id != "" {
		ob["uuid"] = id
	}
	if netType, _ := nd["net"].(string); netType != "" && netType != "tcp" {
		transport := map[string]interface{}{"type": netType}
		if netType == "ws" {
			if p, _ := nd["path"].(string); p != "" {
				transport["path"] = p
			}
			if host, _ := nd["host"].(string); host != "" {
				transport["headers"] = map[string]interface{}{"Host": host}
			}
		}
		ob["transport"] = transport
	}
	if tls, _ := nd["tls"].(string); tls == "tls" {
		t := map[string]interface{}{"enabled": true}
		if sni, _ := nd["sni"].(string); sni != "" {
			t["server_name"] = sni
		}
		ob["tls"] = t
	}

	node := mkNode(tag, "vmess", server, port, line)
	node.Config = ob
	return node, true
}

// ── vless://uuid@host:port?params#name ──

func parseVlessLink(line string) (models.ProxyNode, bool) {
	u, err := url.Parse(line)
	if err != nil || u.User == nil || u.Host == "" {
		return models.ProxyNode{}, false
	}
	host, port, ok := splitHostPort(u.Host)
	if !ok {
		return models.ProxyNode{}, false
	}
	q := queryMap(u.RawQuery)
	tag := unescapeFragment(u.Fragment)

	ob := map[string]interface{}{
		"type":        "vless",
		"tag":         tag,
		"server":      host,
		"server_port": port,
		"uuid":        u.User.Username(),
	}
	if f := q["flow"]; f != "" {
		ob["flow"] = f
	}
	if tls := buildTLS(q, q["security"], host); tls != nil {
		ob["tls"] = tls
	}
	if tr := buildTransport(q); tr != nil {
		ob["transport"] = tr
	}
	node := mkNode(tag, "vless", host, port, line)
	node.Config = ob
	return node, true
}

// ── trojan://password@host:port?params#name ──

func parseTrojanLink(line string) (models.ProxyNode, bool) {
	u, err := url.Parse(line)
	if err != nil || u.User == nil || u.Host == "" {
		return models.ProxyNode{}, false
	}
	host, port, ok := splitHostPort(u.Host)
	if !ok {
		return models.ProxyNode{}, false
	}
	q := queryMap(u.RawQuery)
	tag := unescapeFragment(u.Fragment)

	ob := map[string]interface{}{
		"type":        "trojan",
		"tag":         tag,
		"server":      host,
		"server_port": port,
		"password":    u.User.Username(),
	}
	security := q["security"]
	if security == "" {
		security = "tls" // trojan 默认启用 TLS
	}
	if tls := buildTLS(q, security, host); tls != nil {
		ob["tls"] = tls
	}
	if tr := buildTransport(q); tr != nil {
		ob["transport"] = tr
	}
	node := mkNode(tag, "trojan", host, port, line)
	node.Config = ob
	return node, true
}

// ── hysteria2://password@host:port?params#name ──

func parseHysteria2Link(line string) (models.ProxyNode, bool) {
	raw := line
	if strings.HasPrefix(raw, "hy2://") {
		raw = "hysteria2://" + raw[6:]
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return models.ProxyNode{}, false
	}
	host, port, ok := splitHostPort(u.Host)
	if !ok {
		return models.ProxyNode{}, false
	}
	q := queryMap(u.RawQuery)
	tag := unescapeFragment(u.Fragment)
	password := ""
	if u.User != nil {
		password = u.User.Username()
	}

	ob := map[string]interface{}{
		"type":        "hysteria2",
		"tag":         tag,
		"server":      host,
		"server_port": port,
	}
	if password != "" {
		ob["password"] = password
	}
	if tls := buildTLS(q, "tls", host); tls != nil {
		ob["tls"] = tls
	}
	if obfs := first(q, "obfs", "obfs-type"); obfs != "" {
		o := map[string]interface{}{"type": obfs}
		if pw := first(q, "obfs-password", "obfsPassword"); pw != "" {
			o["password"] = pw
		}
		ob["obfs"] = o
	}
	node := mkNode(tag, "hysteria2", host, port, line)
	node.Config = ob
	return node, true
}

// ── hysteria://host:port?params#name (v1) ──

func parseHysteriaLink(line string) (models.ProxyNode, bool) {
	u, err := url.Parse(line)
	if err != nil || u.Host == "" {
		return models.ProxyNode{}, false
	}
	host, port, ok := splitHostPort(u.Host)
	if !ok {
		return models.ProxyNode{}, false
	}
	q := queryMap(u.RawQuery)
	tag := unescapeFragment(u.Fragment)

	ob := map[string]interface{}{
		"type":        "hysteria",
		"tag":         tag,
		"server":      host,
		"server_port": port,
	}
	if up := q["up"]; up != "" {
		var n int
		if _, err := fmt.Sscanf(up, "%d", &n); err == nil {
			ob["up_mbps"] = n
		}
	}
	if down := q["down"]; down != "" {
		var n int
		if _, err := fmt.Sscanf(down, "%d", &n); err == nil {
			ob["down_mbps"] = n
		}
	}
	if auth := q["auth"]; auth != "" {
		ob["auth"] = auth // base64 密码
	} else if authStr := q["auth_str"]; authStr != "" {
		ob["auth_str"] = authStr
	}
	if obfs := q["obfs"]; obfs != "" {
		ob["obfs"] = obfs
	}
	if tls := buildTLS(q, "tls", host); tls != nil {
		ob["tls"] = tls
	}
	node := mkNode(tag, "hysteria", host, port, line)
	node.Config = ob
	return node, true
}

// ── tuic://uuid:password@host:port?params#name ──

func parseTuicLink(line string) (models.ProxyNode, bool) {
	u, err := url.Parse(line)
	if err != nil || u.User == nil || u.Host == "" {
		return models.ProxyNode{}, false
	}
	host, port, ok := splitHostPort(u.Host)
	if !ok {
		return models.ProxyNode{}, false
	}
	q := queryMap(u.RawQuery)
	tag := unescapeFragment(u.Fragment)

	ob := map[string]interface{}{
		"type":        "tuic",
		"tag":         tag,
		"server":      host,
		"server_port": port,
	}
	if pw, has := u.User.Password(); has {
		ob["uuid"] = u.User.Username()
		ob["password"] = pw
	} else {
		ob["password"] = u.User.Username() // 仅 token 形式
	}
	if cc := q["congestion_control"]; cc != "" {
		ob["congestion_control"] = cc
	}
	if ur := q["udp_relay_mode"]; ur != "" {
		ob["udp_relay_mode"] = ur
	}
	if tls := buildTLS(q, "tls", host); tls != nil {
		ob["tls"] = tls
	}
	node := mkNode(tag, "tuic", host, port, line)
	node.Config = ob
	return node, true
}

// ── ss:// (SIP002 与 legacy) ──

func parseSSLink(line string) (models.ProxyNode, bool) {
	raw := strings.TrimPrefix(line, "ss://")
	tag := ""
	if i := strings.IndexByte(raw, '#'); i >= 0 {
		tag = unescapeFragment(raw[i+1:])
		raw = raw[:i]
	}
	var q map[string]string
	if i := strings.IndexByte(raw, '?'); i >= 0 {
		q = queryMap(raw[i+1:])
		raw = raw[:i]
	}

	var method, password, host string
	var port int
	if at := strings.LastIndexByte(raw, '@'); at >= 0 {
		// SIP002: ss://base64(method:password)@host:port
		if data, err := decodeSS(raw[:at]); err != nil {
			return models.ProxyNode{}, false
		} else if m, p, ok := splitColon(string(data)); !ok {
			return models.ProxyNode{}, false
		} else {
			method, password = m, p
		}
		var hpOK bool
		host, port, hpOK = splitHostPort(raw[at+1:])
		if !hpOK {
			return models.ProxyNode{}, false
		}
	} else {
		// legacy: ss://base64(method:password@host:port)
		data, err := decodeSS(raw)
		if err != nil {
			return models.ProxyNode{}, false
		}
		text := string(data)
		at := strings.IndexByte(text, '@')
		if at < 0 {
			return models.ProxyNode{}, false
		}
		if m, p, ok := splitColon(text[:at]); !ok {
			return models.ProxyNode{}, false
		} else {
			method, password = m, p
		}
		var hpOK bool
		host, port, hpOK = splitHostPort(text[at+1:])
		if !hpOK {
			return models.ProxyNode{}, false
		}
	}

	ob := map[string]interface{}{
		"type":        "shadowsocks",
		"tag":         tag,
		"server":      host,
		"server_port": port,
		"method":      method,
		"password":    password,
	}
	if plugin := q["plugin"]; plugin != "" {
		ob["plugin"] = plugin
	}
	if opts := q["plugin_opts"]; opts != "" {
		ob["plugin_opts"] = opts
	}
	if tr := buildTransport(q); tr != nil {
		ob["transport"] = tr
	}
	node := mkNode(tag, "shadowsocks", host, port, line)
	node.Config = ob
	return node, true
}

// ── 通用辅助 ──

// mkNode 构造 ProxyNode：补充地区、信息节点标记，并为空 tag 生成兜底名
func mkNode(tag, typ, server string, port int, line string) models.ProxyNode {
	if tag == "" {
		tag = fmt.Sprintf("%s-%s:%d", typ, server, port)
	}
	return models.ProxyNode{
		Tag:     tag,
		Type:    typ,
		Server:  server,
		Port:    port,
		Region:  detectRegion(tag),
		RawLink: line,
		IsInfo:  isInfoNode(tag),
	}
}

// isInfoNode 信息节点：tag 含流量/套餐/到期/剩余/过滤等非代理关键字
func isInfoNode(tag string) bool {
	for _, kw := range []string{"流量", "套餐", "到期", "剩余", "过滤"} {
		if strings.Contains(tag, kw) {
			return true
		}
	}
	return false
}

// isProxyType 判断是否为可代理出站类型
func isProxyType(t string) bool {
	switch t {
	case "vmess", "vless", "trojan", "hysteria", "hysteria2", "tuic", "shadowsocks":
		return true
	}
	return false
}

// nodeOutbound 生成节点的 sing-box 出站配置；新缓存直接使用 Config，旧缓存回退到 vmess 重解析
func nodeOutbound(n models.ProxyNode) map[string]interface{} {
	if n.Config != nil {
		return n.Config
	}
	ob := map[string]interface{}{
		"type":        n.Type,
		"tag":         n.Tag,
		"server":      n.Server,
		"server_port": n.Port,
	}
	// 旧缓存兼容：vmess raw_link 重解析
	if n.RawLink != "" && strings.HasPrefix(n.RawLink, "vmess://") {
		if node, ok := parseVmessLink(n.RawLink); ok && node.Config != nil {
			node.Config["tag"] = n.Tag
			return node.Config
		}
	}
	return ob
}

// buildTLS 生成 sing-box tls 对象；security 为 none/空时返回 nil
func buildTLS(q map[string]string, security, server string) map[string]interface{} {
	if security == "" || security == "none" {
		return nil
	}
	tls := map[string]interface{}{"enabled": true}
	sni := first(q, "sni", "servername", "peer")
	if sni == "" {
		sni = server
	}
	if sni != "" {
		tls["server_name"] = sni
	}
	if alpn := q["alpn"]; alpn != "" {
		tls["alpn"] = strings.Split(alpn, ",")
	}
	if fp := q["fp"]; fp != "" {
		tls["utls"] = map[string]interface{}{"enabled": true, "fingerprint": fp}
	}
	if security == "reality" {
		reality := map[string]interface{}{"enabled": true}
		if pbk := q["pbk"]; pbk != "" {
			reality["public_key"] = pbk
		}
		if sid := q["sid"]; sid != "" {
			reality["short_id"] = sid
		}
		if spx := q["spx"]; spx != "" {
			// sing-box 1.13 不支持 spider_x 字段，跳过
		}
		tls["reality"] = reality
	}
	if v := first(q, "insecure", "allowInsecure"); v == "1" || strings.EqualFold(v, "true") {
		tls["insecure"] = true
	}
	return tls
}

// buildTransport 生成 sing-box transport 对象；tcp 或未知类型返回 nil
func buildTransport(q map[string]string) map[string]interface{} {
	switch q["type"] {
	case "ws":
		tr := map[string]interface{}{"type": "ws"}
		if p := q["path"]; p != "" {
			tr["path"] = p
		}
		if h := q["host"]; h != "" {
			tr["headers"] = map[string]interface{}{"Host": h}
		}
		return tr
	case "grpc":
		tr := map[string]interface{}{"type": "grpc"}
		if p := q["path"]; p != "" {
			tr["service_name"] = strings.TrimPrefix(p, "/")
		}
		if q["mode"] == "multi" {
			tr["multi_mode"] = true
		}
		return tr
	case "http":
		tr := map[string]interface{}{"type": "http"}
		if p := q["path"]; p != "" {
			tr["path"] = p
		}
		if h := q["host"]; h != "" {
			tr["host"] = strings.Split(h, ",")
		}
		return tr
	case "quic":
		return map[string]interface{}{"type": "quic"}
	case "httpupgrade", "h2":
		tr := map[string]interface{}{"type": "httpupgrade"}
		if p := q["path"]; p != "" {
			tr["path"] = p
		}
		return tr
	}
	return nil
}

// queryMap 解析 URL 查询参数，自动 URL 解码
func queryMap(rawQuery string) map[string]string {
	m := map[string]string{}
	for rawQuery != "" {
		var kv string
		if i := strings.IndexAny(rawQuery, "&;"); i >= 0 {
			kv, rawQuery = rawQuery[:i], rawQuery[i+1:]
		} else {
			kv, rawQuery = rawQuery, ""
		}
		if kv == "" {
			continue
		}
		if i := strings.IndexByte(kv, '='); i >= 0 {
			k := kv[:i]
			v, err := url.QueryUnescape(kv[i+1:])
			if err != nil {
				v = kv[i+1:]
			}
			if k != "" {
				m[k] = v
			}
		} else if k, err := url.QueryUnescape(kv); err == nil {
			m[k] = ""
		}
	}
	return m
}

func first(q map[string]string, keys ...string) string {
	for _, k := range keys {
		if v := q[k]; v != "" {
			return v
		}
	}
	return ""
}

// unescapeFragment 还原订阅链接 # 后的节点名（可能 URL 编码，+ 视为空格）
func unescapeFragment(s string) string {
	if s == "" {
		return ""
	}
	s = strings.ReplaceAll(s, "+", "%20")
	if d, err := url.PathUnescape(s); err == nil {
		return d
	}
	return s
}

func splitHostPort(hostport string) (string, int, bool) {
	host, portStr, err := net.SplitHostPort(hostport)
	if err != nil {
		return "", 0, false
	}
	var port int
	if _, err := fmt.Sscanf(portStr, "%d", &port); err != nil || port <= 0 || port > 65535 {
		return "", 0, false
	}
	return host, port, true
}

// splitColon 拆分 "method:password"
func splitColon(s string) (string, string, bool) {
	i := strings.IndexByte(s, ':')
	if i < 0 {
		return "", "", false
	}
	return s[:i], s[i+1:], true
}

// decodeSS 兼容 std 与 url-safe 两种 base64（自动补齐 padding）
func decodeSS(s string) ([]byte, error) {
	if data, err := base64.RawURLEncoding.DecodeString(s); err == nil {
		return data, nil
	}
	if m := len(s) % 4; m != 0 {
		s += strings.Repeat("=", 4-m)
	}
	return base64.StdEncoding.DecodeString(s)
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
