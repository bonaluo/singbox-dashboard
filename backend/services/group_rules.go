package services

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"singbox-dashboard/config"
	"singbox-dashboard/models"
	"sort"
	"strings"
)

// ── 分组规则持久化 ──

func groupRulesPath() string {
	return filepath.Join(config.DataDir, "group-rules.json")
}

func LoadGroupRules() ([]models.GroupRule, error) {
	data, err := os.ReadFile(groupRulesPath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var store models.GroupRuleStore
	if err := json.Unmarshal(data, &store); err != nil {
		return nil, err
	}
	// 按 sort_order 排序
	sort.Slice(store.Rules, func(i, j int) bool {
		return store.Rules[i].SortOrder < store.Rules[j].SortOrder
	})
	return store.Rules, nil
}

func SaveGroupRules(rules []models.GroupRule) error {
	store := models.GroupRuleStore{Rules: rules}
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(groupRulesPath(), append(data, '\n'), 0644)
}

// ── 自动应用分组规则到 sing-box 配置 ──

func ApplyGroupRules() error {
	cfg, err := loadSingBoxConfig()
	if err != nil {
		return fmt.Errorf("加载配置失败: %w", err)
	}

	rules, err := LoadGroupRules()
	if err != nil {
		return fmt.Errorf("加载分组规则失败: %w", err)
	}
	if len(rules) == 0 {
		return nil // 无规则时不操作
	}

	// 收集当前所有代理节点 tag（vmess 类型，排除 meta 行）
	outbounds, _ := cfg["outbounds"].([]interface{})
	infoKws := []string{"流量", "套餐", "到期", "剩余", "过滤"}
	var allTags []string
	proxyTags := make(map[string]bool)
	for _, ob := range outbounds {
		m, ok := ob.(map[string]interface{})
		if !ok {
			continue
		}
		t, _ := m["type"].(string)
		if t != "vmess" {
			continue
		}
		tag, _ := m["tag"].(string)
		if tag == "" {
			continue
		}
		skip := false
		for _, kw := range infoKws {
			if strings.Contains(tag, kw) {
				skip = true
				break
			}
		}
		if skip {
			continue
		}
		allTags = append(allTags, tag)
		proxyTags[tag] = true
	}

	// 收集已存在的出站组名称（用于引用检查）
	existingGroupNames := make(map[string]bool)
	for _, ob := range outbounds {
		m, ok := ob.(map[string]interface{})
		if !ok {
			continue
		}
		t, _ := m["type"].(string)
		if t == "selector" || t == "urltest" || t == "loadbalance" {
			if tag, _ := m["tag"].(string); tag != "" {
				existingGroupNames[tag] = true
			}
		}
	}

	// 构建新出站组
	type groupEntry struct {
		name     string
		typ      string
		outbound []string
	}
	var newGroups []groupEntry
	// 记录本次规则创建的所有组名，用于后续覆盖已有组
	createdGroupNames := make(map[string]bool)

	for _, rule := range rules {
		// Proxies 模式：显式指定出站列表
		if rule.Pattern == "" && len(rule.Proxies) > 0 {
			newGroups = append(newGroups, groupEntry{
				name:     rule.Name,
				typ:      rule.Type,
				outbound: rule.Proxies,
			})
			createdGroupNames[rule.Name] = true
			continue
		}

		// Pattern 模式：正则匹配节点 tag
		if rule.Pattern == "" {
			continue
		}
		re, err := regexp.Compile(rule.Pattern)
		if err != nil {
			continue // 跳过无效正则
		}
		var matched []string
		for _, tag := range allTags {
			if re.MatchString(tag) {
				matched = append(matched, tag)
			}
		}
		// 追加 defaults
		matched = append(matched, rule.Defaults...)
		if len(matched) == 0 {
			continue
		}
		newGroups = append(newGroups, groupEntry{
			name:     rule.Name,
			typ:      rule.Type,
			outbound: matched,
		})
		createdGroupNames[rule.Name] = true
	}

	// 重建 outbounds：保留非组出站，替换已有组，追加新组
	var newOutbounds []interface{}
	replacedTags := make(map[string]bool)
	for _, ob := range outbounds {
		m, ok := ob.(map[string]interface{})
		if !ok {
			newOutbounds = append(newOutbounds, ob)
			continue
		}
		t, _ := m["type"].(string)
		tag, _ := m["tag"].(string)

		// 如果是本次规则创建的组 → 跳过（后面重建）
		if createdGroupNames[tag] {
			replacedTags[tag] = true
			continue
		}
		// 保留非组出站
		if t != "selector" && t != "urltest" {
			newOutbounds = append(newOutbounds, ob)
			continue
		}
		// 保留未被规则覆盖的已有组
		if !createdGroupNames[tag] {
			newOutbounds = append(newOutbounds, ob)
		}
	}

	// 追加新组
	for _, g := range newGroups {
		newOutbounds = append(newOutbounds, map[string]interface{}{
			"tag":       g.name,
			"type":      g.typ,
			"outbounds": g.outbound,
		})
	}

	cfg["outbounds"] = newOutbounds

	if err := WriteSingBoxConfig(cfg); err != nil {
		return fmt.Errorf("写入配置失败: %w", err)
	}
	return RestartService()
}
