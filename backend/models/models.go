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

type RuleType string

const (
	RuleDomain        RuleType = "domain"
	RuleDomainSuffix  RuleType = "domain-suffix"
	RuleDomainKeyword RuleType = "domain-keyword"
	RuleIPCIDR        RuleType = "ip-cidr"
	RuleGeosite       RuleType = "geosite"
	RuleGeoIP         RuleType = "geoip"
	RuleProcessName   RuleType = "process-name"
	RuleFinal         RuleType = "final"
)

type Rule struct {
	ID       string   `json:"id"`
	Enabled  bool     `json:"enabled"`
	Type     RuleType `json:"type"`
	Value    string   `json:"value"`    // domain, ip, geosite tag, etc.
	Outbound string   `json:"outbound"` // direct, proxy, or specific node tag
	Priority int      `json:"priority"`
	Comment  string   `json:"comment,omitempty"`
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
