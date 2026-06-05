package models

// ── Subscription ──

// SubscriptionKind 订阅的类型
//  - \"url\": 普通订阅链接
//  - \"aggregated\": 聚合订阅组（由多个 sources 组成）
//  - \"ad_hoc\": 临时链接（被聚合到聚合组中，不独立显示）
type SubscriptionKind string

const (
	KindURL        SubscriptionKind = "url"
	KindAggregated SubscriptionKind = "aggregated"
	KindAdHoc      SubscriptionKind = "ad_hoc"
)

// SubscriptionSource 聚合订阅中的一个子源
type SubscriptionSource struct {
	ID       string `json:"id"`                 // 如果是已有订阅，填订阅 ID
	URL      string `json:"url,omitempty"`      // 如果是临时链接，填 URL
	Name     string `json:"name,omitempty"`     // 源名称（解析时从已知订阅获取）
	Status   string `json:"status"`             // \"ok\" / \"error\"
	Error    string `json:"error,omitempty"`    // 错误信息
	NodeCount int   `json:"node_count"`          // 此源贡献的节点数
}

type Subscription struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	URL         string             `json:"url"`                    // kind=url 时的订阅地址；kind=aggregated 可为空
	Kind        SubscriptionKind   `json:"kind"`                   // 订阅类型
	LastUpdated string             `json:"last_updated,omitempty"`
	NodeCount   int                `json:"node_count,omitempty"`
	Sources     []SubscriptionSource `json:"sources,omitempty"`   // kind=aggregated 时的子源列表
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
	Type  string   `json:"type"` // "selector" / "urltest"
	Nodes []string `json:"nodes"`
}

type GroupInfo struct {
	Name  string   `json:"name"`
	Type  string   `json:"type"`
	Nodes []string `json:"nodes"`
	Now   string   `json:"now,omitempty"`
}

// GroupMember 组可用的成员项（单个节点或已有组）
type GroupMember struct {
	Tag      string `json:"tag"`
	Type     string `json:"type"`       // proxy / selector / urltest
	Region   string `json:"region,omitempty"` // 仅 proxy 时有
	IsGroup  bool   `json:"is_group"`   // true=已有组，false=单个节点
	MemberCount int  `json:"member_count,omitempty"` // 组内节点数
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
	Name       string              `json:"name"`
	Sources    []string            `json:"sources"`       // 要合并的已有订阅 ID
	ExtraURLs  []string            `json:"extra_urls,omitempty"` // 额外临时链接
}

// MergeResult 聚合/更新结果，包含每个子源的解析状态
type MergeResult struct {
	Subscription *Subscription       `json:"subscription"`
	TotalNodes   int                 `json:"total_nodes"`
	Nodes        []ProxyNode         `json:"nodes"`
	Sources      []SubscriptionSource `json:"sources"` // 含解析状态
}

type APIResponse struct {
	OK     bool        `json:"ok"`
	Data   interface{} `json:"data,omitempty"`
	Error  string      `json:"error,omitempty"`
	Msg    string      `json:"msg,omitempty"`
}
