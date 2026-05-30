package services

import (
	"encoding/json"
	"fmt"
	"os"
	"singbox-dashboard/config"
	"singbox-dashboard/models"
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
	// 按 priority 排序
	sorted := make([]models.Rule, len(store.Rules))
	copy(sorted, store.Rules)
	store.Rules = sorted
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

// ── 将 rules 应用到 sing-box 配置 ──

func ApplyRules() error {
	store, err := LoadRules()
	if err != nil {
		return err
	}
	cfg, err := loadSingBoxConfig()
	if err != nil {
		return err
	}

	// 构建 route.rules
	var rules []map[string]interface{}
	for _, r := range store.Rules {
		if !r.Enabled {
			continue
		}
		rule := map[string]interface{}{
			"outbound": r.Outbound,
		}

		switch r.Type {
		case models.RuleDomain:
			rule["domain"] = []string{r.Value}
		case models.RuleDomainSuffix:
			rule["domain_suffix"] = []string{r.Value}
		case models.RuleDomainKeyword:
			rule["domain_keyword"] = []string{r.Value}
		case models.RuleIPCIDR:
			rule["ip_cidr"] = []string{r.Value}
		case models.RuleGeosite:
			rule["rule_set"] = fmt.Sprintf("geosite-%s", r.Value) // 简化
			rule["outbound"] = r.Outbound
		case models.RuleGeoIP:
			rule["rule_set"] = fmt.Sprintf("geoip-%s", r.Value)
			rule["outbound"] = r.Outbound
		case models.RuleProcessName:
			rule["process_name"] = []string{r.Value}
		}

		rules = append(rules, rule)
	}

	// 只更新 route.rules + final，保留 rule_set 等
	route, ok := cfg["route"].(map[string]interface{})
	if !ok {
		route = make(map[string]interface{})
		cfg["route"] = route
	}
	route["rules"] = rules
	route["final"] = "proxy"
	if _, has := route["default_domain_resolver"]; !has {
		route["default_domain_resolver"] = "dns-local"
	}

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
