package models

// ── Subscription ──

type Subscription struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	URL         string `json:"url"`
	LastUpdated string `json:"last_updated,omitempty"`
	NodeCount   int    `json:"node_count,omitempty"`
}

type SubscriptionStore struct {
	Subscriptions []Subscription `json:"subscriptions"`
}

// ── Proxy Node (parsed from vmess:// etc) ──

type ProxyNode struct {
	Tag      string `json:"tag"`
	Type     string `json:"type"` // vmess, vless, ss, trojan
	Server   string `json:"server"`
	Port     int    `json:"port"`
	Region   string `json:"region,omitempty"`
	RawLink  string `json:"raw_link,omitempty"` // original vmess:// link
}

// ── Routing Rule ──

// RuleCondition 表示规则中的一个匹配条件（多个条件以 AND 逻辑组合）
type RuleCondition struct {
	Type   string   `json:"type"`   // sing-box 匹配字段名，如 domain, domain_suffix, port, geosite 等
	Values []string `json:"values"` // 匹配值列表（OR 逻辑）
}

// Rule 表示一条路由规则，对应 sing-box route.rules 数组的一项
type Rule struct {
	ID         string          `json:"id"`
	Enabled    bool            `json:"enabled"`
	Type       string          `json:"type"`             // 旧格式兼容：单一条件类型
	Value      string          `json:"value"`            // 旧格式兼容：单一条件值
	Action     string          `json:"action"`           // route(默认) / reject / hijack-dns / sniff
	Outbound   string          `json:"outbound"`         // action=route 时的目标出站
	Conditions []RuleCondition `json:"conditions"`       // 新格式：多条件 AND 组合
	Invert     bool            `json:"invert"`           // 反转匹配结果
	Priority   int             `json:"priority"`
	Comment    string          `json:"comment,omitempty"`
}

// MigrateConditions 将旧格式 (Type+Value) 迁移到新格式 (Conditions)，同时返回
// 旧格式数据依然有效以保证向后兼容。
func (r *Rule) MigrateConditions() []RuleCondition {
	if len(r.Conditions) > 0 {
		return r.Conditions
	}
	// 旧格式升级
	if r.Type != "" && r.Value != "" {
		return []RuleCondition{{Type: r.Type, Values: []string{r.Value}}}
	}
	return nil
}

// GetAction 返回 rule 的动作类型，默认 "route"
func (r *Rule) GetAction() string {
	if r.Action == "" {
		return "route"
	}
	return r.Action
}

type RuleStore struct {
	Rules []Rule `json:"rules"`
}

// ── Status ──

type StatusResponse struct {
	Running    bool   `json:"running"`
	Current    string `json:"current"`
	Uptime     string `json:"uptime,omitempty"`
	TotalNodes int    `json:"total_nodes"`
	Version    string `json:"version,omitempty"`
}

// ── API responses ──

type APIResponse struct {
	OK     bool        `json:"ok"`
	Data   interface{} `json:"data,omitempty"`
	Error  string      `json:"error,omitempty"`
	Msg    string      `json:"msg,omitempty"`
}
