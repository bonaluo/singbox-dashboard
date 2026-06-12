package services

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"singbox-dashboard/config"
	"singbox-dashboard/models"
	"sort"
	"strings"
	"time"
)

// ═══════════════════════════════════════════════════════════
//  规则管理：CRUD + 生成 sing-box route.rules JSON
// ═══════════════════════════════════════════════════════════

func LoadRules() (*models.RuleStore, error) {
	store := &models.RuleStore{}
	data, err := os.ReadFile(config.RulesPath())
	if err != nil {
		if os.IsNotExist(err) {
			return store, nil
		}
		return nil, err
	}
	if err := json.Unmarshal(data, store); err != nil {
		return nil, err
	}
	if store.Rules == nil {
		store.Rules = []models.Rule{}
	}
	return store, nil
}

func SaveRules(store *models.RuleStore) error {
	os.MkdirAll(config.DataDir, 0755)
	// 按 priority 排序（priority 越小越靠前；相同 priority 按 ID 字典序）
	sort.SliceStable(store.Rules, func(i, j int) bool {
		if store.Rules[i].Priority != store.Rules[j].Priority {
			return store.Rules[i].Priority < store.Rules[j].Priority
		}
		return store.Rules[i].ID < store.Rules[j].ID
	})
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(config.RulesPath(), append(data, '\n'), 0644)
}

func AddRule(r *models.Rule) (*models.Rule, error) {
	store, err := LoadRules()
	if err != nil {
		return nil, err
	}
	r.ID = fmt.Sprintf("rule_%d", time.Now().UnixMilli())
	// 自动分配 priority：已有最大 priority + 1
	if r.Priority <= 0 {
		maxP := 0
		for _, rule := range store.Rules {
			if rule.Priority > maxP {
				maxP = rule.Priority
			}
		}
		r.Priority = maxP + 1
	}
	store.Rules = append(store.Rules, *r)
	if err := SaveRules(store); err != nil {
		return nil, err
	}
	// 自动应用到 sing-box
	go ApplyRules()
	return r, nil
}

func UpdateRule(r *models.Rule) error {
	store, err := LoadRules()
	if err != nil {
		return err
	}
	for i := range store.Rules {
		if store.Rules[i].ID == r.ID {
			// 保留原有 priority（如果请求未提供）
			if r.Priority <= 0 {
				r.Priority = store.Rules[i].Priority
			}
			store.Rules[i] = *r
		}
	}
	if err := SaveRules(store); err != nil {
		return err
	}
	go ApplyRules()
	return nil
}

func DeleteRule(id string) error {
	store, err := LoadRules()
	if err != nil {
		return err
	}
	var newRules []models.Rule
	for _, r := range store.Rules {
		if r.ID == id {
			continue
		}
		newRules = append(newRules, r)
	}
	if len(newRules) == len(store.Rules) {
		return fmt.Errorf("rule not found")
	}
	store.Rules = newRules
	if err := SaveRules(store); err != nil {
		return err
	}
	go ApplyRules()
	return nil
}

// ReorderRules 按给定的 ID 顺序重排规则优先级
// ids 的顺序即目标顺序，priority 从 1 开始递增
func ReorderRules(ids []string) error {
	store, err := LoadRules()
	if err != nil {
		return err
	}
	// 构建 ID → Rule 的索引
	index := make(map[string]*models.Rule)
	for i := range store.Rules {
		index[store.Rules[i].ID] = &store.Rules[i]
	}
	// 按 ids 顺序重新分配 priority
	for i, id := range ids {
		if r, ok := index[id]; ok {
			r.Priority = i + 1
		}
	}
	if err := SaveRules(store); err != nil {
		return err
	}
	go ApplyRules()
	return nil
}

// ── 将 rules 应用到 sing-box 配置 ──

// singBoxRuleKeys 定义 condition type → sing-box rule key 的映射
// 大多数字段名与 sing-box 配置 key 一致，此处列出需要特殊处理的
var singBoxRuleKeys = map[string]string{
	"domain":                  "domain",
	"domain_suffix":           "domain_suffix",
	"domain_keyword":          "domain_keyword",
	"domain_regex":            "domain_regex",
	"geosite":                 "geosite",
	"geoip":                   "geoip",
	"source_geoip":            "source_geoip",
	"ip_cidr":                 "ip_cidr",
	"source_ip_cidr":          "source_ip_cidr",
	"ip_is_private":           "ip_is_private",
	"source_ip_is_private":    "source_ip_is_private",
	"port":                    "port",
	"port_range":              "port_range",
	"source_port":             "source_port",
	"source_port_range":       "source_port_range",
	"process_name":            "process_name",
	"process_path":            "process_path",
	"process_path_regex":      "process_path_regex",
	"package_name":            "package_name",
	"package_name_regex":      "package_name_regex",
	"user":                    "user",
	"user_id":                 "user_id",
	"inbound":                 "inbound",
	"network":                 "network",
	"network_type":            "network_type",
	"network_is_expensive":    "network_is_expensive",
	"network_is_constrained":  "network_is_constrained",
	"protocol":                "protocol",
	"client":                  "client",
	"auth_user":               "auth_user",
	"ip_version":              "ip_version",
	"clash_mode":              "clash_mode",
	"wifi_ssid":               "wifi_ssid",
	"wifi_bssid":              "wifi_bssid",
	"rule_set":                "rule_set",
	"rule_set_ipcidr_match_source":  "rule_set_ipcidr_match_source",
	"rule_set_ip_cidr_match_source": "rule_set_ip_cidr_match_source",
	"source_mac_address":      "source_mac_address",
	"source_hostname":         "source_hostname",
	"preferred_by":            "preferred_by",
}

func ApplyRules() error {
	store, err := LoadRules()
	if err != nil {
		return err
	}
	cfg, err := loadSingBoxConfig()
	if err != nil {
		return err
	}

	var rules []map[string]interface{}
	for _, r := range store.Rules {
		if !r.Enabled {
			continue
		}

		rule := map[string]interface{}{}

		// 处理条件（新格式优先，兼容旧格式 Type+Value）
		conditions := r.MigrateConditions()
		for _, cond := range conditions {
			if cond.Type == "" || len(cond.Values) == 0 {
				continue
			}
			key, ok := singBoxRuleKeys[cond.Type]
			if !ok {
				key = cond.Type // 透传未知字段
			}

			// 特殊处理：geosite/geoip 在 sing-box 1.12+ 中已移除原生字段
			// 必须通过 rule_set 前缀引用，如 geosite-cn, geoip-cn
			if cond.Type == "geosite" {
				var prefixed []string
				for _, v := range cond.Values {
					prefixed = append(prefixed, "geosite-"+strings.TrimSpace(v))
				}
				rule["rule_set"] = prefixed
			} else if cond.Type == "geoip" {
				var prefixed []string
				for _, v := range cond.Values {
					prefixed = append(prefixed, "geoip-"+strings.TrimSpace(v))
				}
				rule["rule_set"] = prefixed
			} else if cond.Type == "port" || cond.Type == "source_port" || cond.Type == "user_id" || cond.Type == "ip_version" {
				// 数字类型字段：尝试解析为数字，失败则保留字符串
				var nums []interface{}
				for _, v := range cond.Values {
					var n int
					if _, err := fmt.Sscanf(v, "%d", &n); err == nil {
						nums = append(nums, n)
					} else {
						nums = append(nums, v)
					}
				}
				if len(nums) > 0 {
					rule[key] = nums
				}
			} else if cond.Type == "network_is_expensive" || cond.Type == "network_is_constrained" ||
				cond.Type == "ip_is_private" || cond.Type == "source_ip_is_private" ||
				cond.Type == "rule_set_ipcidr_match_source" || cond.Type == "rule_set_ip_cidr_match_source" {
				// 布尔类型字段
				v := strings.ToLower(cond.Values[0])
				rule[key] = v == "true" || v == "1"
			} else if cond.Type == "clash_mode" {
				// 字符串单值
				rule[key] = cond.Values[0]
			} else {
				// 默认：字符串数组
				rule[key] = cond.Values
			}
		}

		// action / outbound
		action := r.GetAction()
		rule["action"] = action
		if action == "route" && r.Outbound != "" {
			rule["outbound"] = r.Outbound
		}

		// invert
		if r.Invert {
			rule["invert"] = true
		}

		rules = append(rules, rule)
	}

	route, ok := cfg["route"].(map[string]interface{})
	if !ok {
		route = make(map[string]interface{})
		cfg["route"] = route
	}
	route["rules"] = rules
	route["final"] = "proxy"

	// 自动补全 rule_set 定义：收集所有引用的 rule_set tag
	ruleSetTags := make(map[string]bool)
	for _, r := range rules {
		if rs, ok := r["rule_set"]; ok {
			switch v := rs.(type) {
			case []string:
				for _, t := range v {
					ruleSetTags[t] = true
				}
			case string:
				ruleSetTags[v] = true
			case []interface{}:
				for _, t := range v {
					if s, ok := t.(string); ok {
						ruleSetTags[s] = true
					}
				}
			}
		}
	}

	// 重建 rule_set 定义：只保留当前规则引用的 + 已有的非 geosite/geoip 类型
	var ruleSetDefs []interface{}
	if existingRS, ok := route["rule_set"].([]interface{}); ok {
		for _, rs := range existingRS {
			if m, ok := rs.(map[string]interface{}); ok {
				if t, ok := m["tag"].(string); ok {
					// 保留被当前规则引用的
					if ruleSetTags[t] {
						// geosite/geoip 类型：统一转为 local（避免运行时下载被 WSL2 代理劫持）
						if strings.HasPrefix(t, "geosite-") || strings.HasPrefix(t, "geoip-") {
							m["type"] = "local"
							m["path"] = "/data/ruleset/" + t + ".srs"
							delete(m, "url")
							delete(m, "download_detour")
							delete(m, "format")
						}
						ruleSetDefs = append(ruleSetDefs, rs)
					} else if !strings.HasPrefix(t, "geosite-") && !strings.HasPrefix(t, "geoip-") {
						// 非 geosite/geoip 的用户自定义 rule_set 始终保留
						ruleSetDefs = append(ruleSetDefs, rs)
					}
				}
			}
		}
	}

	// 添加新的 rule_set 定义（当前规则引用但还没有定义的）
	missingTags := make(map[string]bool)
	for tag := range ruleSetTags {
		found := false
		for _, rs := range ruleSetDefs {
			if m, ok := rs.(map[string]interface{}); ok {
				if t, ok := m["tag"].(string); ok && t == tag {
					found = true
					break
				}
			}
		}
		if !found {
			tagLower := strings.ToLower(tag)
			isGeo := strings.HasPrefix(tagLower, "geosite-") || strings.HasPrefix(tagLower, "geoip-")
			if isGeo {
				srsPath := filepath.Join(config.DataDir, "ruleset", tag+".srs")
				if _, err := os.Stat(srsPath); os.IsNotExist(err) {
					log.Printf("⚠️ 跳过 rule_set %s: .srs 文件不存在 (%s)，请先在设置页开启 Geo 规则集自动更新下载", tag, srsPath)
					missingTags[tag] = true
					continue
				}
				ruleSetDefs = append(ruleSetDefs, map[string]interface{}{
					"tag":  tag,
					"type": "local",
					"path": "/data/ruleset/" + tag + ".srs",
				})
			}
		}
	}
	route["rule_set"] = ruleSetDefs

	// 过滤掉引用了不存在 rule_set 的规则（否则 sing-box 启动 FATAL）
	if len(missingTags) > 0 {
		var validRules []map[string]interface{}
		for _, r := range rules {
			refs := getRuleSetRefs(r)
			skip := false
			for _, ref := range refs {
				if missingTags[ref] {
					skip = true
					break
				}
			}
			if !skip {
				validRules = append(validRules, r)
			} else {
				log.Printf("⚠️ 跳过规则（rule_set .srs 缺失）: %v", refs)
			}
		}
		rules = validRules
	}
	route["rules"] = rules

	return WriteSingBoxConfig(cfg)
}

// ── 获取规则支持的出站选项 ──

func GetOutboundOptions() []string {
	proxies := GetProxies()
	options := []string{"direct", "proxy"}
	for _, p := range proxies {
		options = append(options, p.Tag)
	}
	return options
}

// getRuleSetRefs 提取规则中引用的所有 rule_set tag
func getRuleSetRefs(rule map[string]interface{}) []string {
	rs, ok := rule["rule_set"]
	if !ok {
		return nil
	}
	var refs []string
	switch v := rs.(type) {
	case string:
		refs = append(refs, v)
	case []string:
		refs = append(refs, v...)
	case []interface{}:
		for _, t := range v {
			if s, ok := t.(string); ok {
				refs = append(refs, s)
			}
		}
	}
	return refs
}

// GetEnrichedOutbounds 返回增强的出站选项列表（含类型、当前节点、延迟）
// 用于规则页面的出站下拉选择
func GetEnrichedOutbounds() []models.OutboundOption {
	all := GetAllOutbounds()
	if all == nil {
		return nil
	}
	var result []models.OutboundOption
	for _, ob := range all {
		enriched := ob
		if ob.Type == "selector" || ob.Type == "urltest" || ob.Type == "loadbalance" {
			now := GetGroupNow(ob.Tag)
			enriched.Now = now

			// urltest：取当前节点的延迟
			if ob.Type == "urltest" {
				delays := GetGroupDelays(ob.Tag)
				if now != "" {
					if d, ok := delays[now]; ok {
						enriched.Delay = d
					}
				}
				// 未取到当前节点延迟时，尝试取任意可用延迟
				if enriched.Delay == 0 && len(delays) > 0 {
					for _, d := range delays {
						if d > 0 {
							enriched.Delay = d
							break
						}
					}
				}
			}
		}
		result = append(result, enriched)
	}
	return result
}
