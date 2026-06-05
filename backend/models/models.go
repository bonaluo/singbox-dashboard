package models

// ── Subscription ──

type Subscription struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	URL         string   `json:"url"`
	LastUpdated string   `json:"last_updated,omitempty"`
	NodeCount   int      `json:"node_count,omitempty"`
	Aggregated  bool     `json:"aggregated,omitempty"`   // 是否是聚合订阅
	Sources     []string `json:"sources,omitempty"`      // 子订阅 ID 列表
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

// OutboundOption 出站选项，含类型和实时状态（供规则页下拉选择）
type OutboundOption struct {
	Tag   string `json:"tag"`             // 出站标签名
	Type  string `json:"type"`            // direct / selector / urltest / vmess / vless / shadowsocks ...
	Now   string `json:"now,omitempty"`   // 当前选中节点（selector/urltest 组）
	Delay int    `json:"delay,omitempty"` // 当前节点延迟(ms)，-1 表示不可达
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

// ── Group (outbound selector group) ──

type GroupRequest struct {
	Name  string   `json:"name"`
	Nodes []string `json:"nodes"`
}

type GroupInfo struct {
	Name  string   `json:"name"`
	Type  string   `json:"type"`
	Nodes []string `json:"nodes"`
	Now   string   `json:"now,omitempty"`
}

// ── Status ──

type StatusResponse struct {
	Running    bool   `json:"running"`
	Current    string `json:"current"`
	Uptime     string `json:"uptime,omitempty"`
	TotalNodes int    `json:"total_nodes"`
	Version    string `json:"version,omitempty"`
	GitCommit  string `json:"git_commit,omitempty"`
}

// ── API responses ──

type MergeRequest struct {
	Name     string   `json:"name"`
	Sources  []string `json:"sources"`
	ExtraURL string   `json:"extra_url,omitempty"`
}

type APIResponse struct {
	OK     bool        `json:"ok"`
	Data   interface{} `json:"data,omitempty"`
	Error  string      `json:"error,omitempty"`
	Msg    string      `json:"msg,omitempty"`
}
