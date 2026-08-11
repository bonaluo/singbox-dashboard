package services

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"singbox-dashboard/config"
	"singbox-dashboard/models"
	"time"
)

// ═══════════════════════════════════════════════════════════
//  推荐配置生成：完整 DNS 分流 / Clash API secret / 原生缓存
//  （移植自 GUI.for.SingBox 的配置模型，去掉繁琐可选项）
// ═══════════════════════════════════════════════════════════

// 内置出站组 tag（与 Clash 系客户端习惯一致）
const (
	OutboundProxy      = "🚀 节点选择" // 节点选择（原 proxy，GUI.for.SingBox 同款命名）
	OutboundDirect     = "direct"     // 直连
	OutboundBlock      = "block"      // 拦截
	OutboundAutoSel    = "自动选择"     // 全节点 urltest
	OutboundDirectGrp  = "🎯 全球直连" // 直连组（direct/block 可选）
	OutboundBlockGrp   = "🛑 全球拦截" // 拦截组（block/direct 可选）
	OutboundFallback   = "🐟 漏网之鱼" // 兜底组（节点/直连可选）
	OutboundGlobal     = "GLOBAL"     // 全局组（所有组聚合）
)

// DNS server tag
const (
	DNSLocal   = "Local-DNS"   // 国内 DNS（223.5.5.5 https）
	DNSRemote  = "Remote-DNS"  // 远程 DNS（8.8.8.8 tls，走代理）
	DNSFakeIP  = "Fake-IP"     // Fake-IP 服务器（预留，默认不启用）
)

// buildDNSConfig 生成完整 DNS 分流配置：
//   - 国内域名 → 本地 DNS（223.5.5.5，直连）
//   - 国外域名 → 远程 DNS（8.8.8.8，走代理）
//   - clash_mode=direct → 本地 DNS
//   - 其余（final）→ 远程 DNS
// 相比 GUI.for.SingBox：去掉 Fake-IP（服务器形态 mixed 入站不适用），
// 保留其核心分流模型。
func buildDNSConfig() map[string]interface{} {
	return map[string]interface{}{
		"servers": []interface{}{
			map[string]interface{}{
				"tag":    DNSLocal,
				"type":   "https",
				"server": "223.5.5.5",
				"detour": OutboundDirectGrp, // selector 组（默认直连），sing-box 禁止 detour 指向 direct 本身
			},
			map[string]interface{}{
				"tag":         DNSLocal + "-Resolver",
				"type":        "udp",
				"server":      "223.5.5.5",
				"server_port": 53,
				"detour":      OutboundDirectGrp,
			},
			map[string]interface{}{
				"tag":    DNSRemote,
				"type":   "tls",
				"server": "8.8.8.8",
				"detour": OutboundProxy,
			},
			map[string]interface{}{
				"tag":         DNSRemote + "-Resolver",
				"type":        "udp",
				"server":      "8.8.8.8",
				"server_port": 53,
				"detour":      OutboundProxy,
			},
			// Fake-IP 服务器定义（预留：后续可通过界面开关启用）
			map[string]interface{}{
				"tag":         DNSFakeIP,
				"type":        "fakeip",
				"inet4_range": "198.18.0.0/15",
				"inet6_range": "fc00::/18",
			},
		},
		"rules": []interface{}{
			map[string]interface{}{"clash_mode": "direct", "server": DNSLocal},
			map[string]interface{}{"rule_set": []string{"geosite-cn"}, "server": DNSLocal},
			map[string]interface{}{"rule_set": []string{"geosite-geolocation-!cn"}, "server": DNSRemote},
		},
		"final":              DNSRemote,
		"disable_cache":      false,
		"disable_expire":     false,
		"independent_cache":  false,
	}
}

// EnsureClashSecret 读取或生成 Clash API secret（持久化到数据目录，
// 重启后不变，避免每次启动重新生成导致前端/外部客户端失联）。
func EnsureClashSecret() string {
	path := filepath.Join(config.DataDir, "clash-secret")
	if data, err := os.ReadFile(path); err == nil {
		if s := string(data); len(s) >= 16 {
			return s
		}
	}
	secret := randomSecret(32)
	os.MkdirAll(config.DataDir, 0755)
	os.WriteFile(path, []byte(secret), 0600)
	return secret
}

func randomSecret(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("dash-%x", os.Getpid())
	}
	return hex.EncodeToString(b)
}

// buildExperimentalBlock 生成 experimental 配置块：Clash API（带 secret）
// + sing-box 原生缓存（cache.db，重启保留连接统计/fake-ip 记录）。
func buildExperimentalBlock(cacheID string) map[string]interface{} {
	return map[string]interface{}{
		"clash_api": map[string]interface{}{
			"external_controller": "0.0.0.0:9090",
			"secret":              EnsureClashSecret(),
			"default_mode":        "rule",
			"access_control_allow_origin": []string{"*"},
		},
		"cache_file": map[string]interface{}{
			"enabled":       true,
			"path":          filepath.Join(config.DataDir, "cache.db"),
			"cache_id":      cacheID,
			"store_fakeip":  true,
			"store_rdrc":    true,
			"rdrc_timeout":  "7d",
		},
	}
}

// buildDefaultGroupOutbounds 追加内置出站组模板（移植自 GUI.for.SingBox）：
//   block / 🎯 全球直连 / 🛑 全球拦截 / 🐟 漏网之鱼 / GLOBAL
//   tags 为当前所有代理节点 tag（含 direct），def 为 selector 默认选中节点。
func buildDefaultGroupOutbounds(newOutbounds []interface{}, tags []string, def string) []interface{} {
	// has 基于完整 outbounds 检查，避免自修复时重复添加已存在的组
	has := func(tag string) bool {
		for _, ob := range newOutbounds {
			if m, ok := ob.(map[string]interface{}); ok {
				if t, _ := m["tag"].(string); t == tag {
					return true
				}
			}
		}
		return false
	}
	// 拦截出站（sing-box 1.11+ 内置 block 类型）
	if !has(OutboundBlock) {
		newOutbounds = append(newOutbounds, map[string]interface{}{
			"type": OutboundBlock, "tag": OutboundBlock,
		})
	}
	// 全球直连组（可切 block 实现全局拦截，GUI.for.SingBox 模板）
	if !has(OutboundDirectGrp) {
		newOutbounds = append(newOutbounds, map[string]interface{}{
			"type": "selector", "tag": OutboundDirectGrp,
			"outbounds": []string{OutboundDirect, OutboundBlock},
			"default":   OutboundDirect,
		})
	}
	// 全球拦截组
	if !has(OutboundBlockGrp) {
		newOutbounds = append(newOutbounds, map[string]interface{}{
			"type": "selector", "tag": OutboundBlockGrp,
			"outbounds": []string{OutboundBlock, OutboundDirect},
			"default":   OutboundBlock,
		})
	}
	// 漏网之鱼（route.final 指向；可选 🚀 节点选择 或 🎯 全球直连，
	// 切到直连组即实现"白名单模式"）
	if !has(OutboundFallback) {
		newOutbounds = append(newOutbounds, map[string]interface{}{
			"type": "selector", "tag": OutboundFallback,
			"outbounds": []string{OutboundProxy, OutboundDirectGrp},
			"default":   OutboundProxy,
		})
	} else {
		// 已存在：修正成员为 [🚀 节点选择, 🎯 全球直连]
		for _, ob := range newOutbounds {
			if m, ok := ob.(map[string]interface{}); ok {
				if t, _ := m["tag"].(string); t == OutboundFallback {
					refs, _ := m["outbounds"].([]interface{})
					hasP, hasD := false, false
					for _, r := range refs {
						if s, ok := r.(string); ok {
							if s == OutboundProxy { hasP = true }
							if s == OutboundDirectGrp { hasD = true }
						}
					}
					var fixed []interface{}
					if hasP { fixed = append(fixed, OutboundProxy) }
					if hasD { fixed = append(fixed, OutboundDirectGrp) }
					if !hasP || !hasD {
						if !hasP { fixed = append([]interface{}{OutboundProxy}, fixed...) }
						m["outbounds"] = fixed
					}
				}
			}
		}
	}
	// GLOBAL（clash_mode=global 时全量走此组）
	if !has(OutboundGlobal) {
		newOutbounds = append(newOutbounds, map[string]interface{}{
			"type": "selector", "tag": OutboundGlobal,
			"outbounds": []string{OutboundProxy, OutboundAutoSel, OutboundDirectGrp, OutboundBlockGrp, OutboundFallback},
			"default":   OutboundProxy,
		})
	} else {
		// GLOBAL 已存在：修正其引用（指向现存的组，避免引用悬挂启动失败）
		for _, ob := range newOutbounds {
			if m, ok := ob.(map[string]interface{}); ok {
				if t, _ := m["tag"].(string); t == OutboundGlobal {
					var refs []string
					for _, r := range []string{OutboundProxy, OutboundAutoSel, OutboundDirectGrp, OutboundBlockGrp, OutboundFallback} {
						if has(r) {
							refs = append(refs, r)
						}
					}
					m["outbounds"] = refs
				}
			}
		}
	}
	return newOutbounds
}

// migrateLegacyProxyGroup 将旧版配置中的 proxy 出站组迁移为 🚀 节点选择，
// 同步更新所有引用：出站组嵌套/DNS detour/路由规则/rules.json。
func migrateLegacyProxyGroup(cfg map[string]interface{}) error {
	changed := false
	// 1. 出站组 tag 重命名 + 组内引用/default 替换
	outbounds, _ := cfg["outbounds"].([]interface{})
	for _, ob := range outbounds {
		m, ok := ob.(map[string]interface{})
		if !ok {
			continue
		}
		if t, _ := m["tag"].(string); t == "proxy" {
			m["tag"] = OutboundProxy
			changed = true
		}
		if refs, ok := m["outbounds"].([]interface{}); ok {
			for i, r := range refs {
				if s, ok := r.(string); ok && s == "proxy" {
					refs[i] = OutboundProxy
					changed = true
				}
			}
		}
		if d, _ := m["default"].(string); d == "proxy" {
			m["default"] = OutboundProxy
			changed = true
		}
	}
	// 1b. 自动选择组：成员移除 🚀 节点选择（urltest 应为纯节点），
	// 并清除 urltest 的 default 残留（sing-box 1.13 urltest 不支持该字段）
	for _, ob := range outbounds {
		m, ok := ob.(map[string]interface{})
		if !ok {
			continue
		}
		if t, _ := m["tag"].(string); t != OutboundAutoSel {
			continue
		}
		refs, _ := m["outbounds"].([]interface{})
		var filtered []interface{}
		for _, r := range refs {
			if s, ok := r.(string); ok && s == OutboundProxy {
				changed = true
				continue // 移除节点选择成员
			}
			filtered = append(filtered, r)
		}
		if len(filtered) != len(refs) {
			m["outbounds"] = filtered
		}
		if _, hasDef := m["default"]; hasDef {
			delete(m, "default")
			changed = true
		}
	}
	// 1c. 🚀 节点选择 组：成员补入"自动选择"（旧配置无此成员）
	for _, ob := range outbounds {
		m, ok := ob.(map[string]interface{})
		if !ok {
			continue
		}
		if t, _ := m["tag"].(string); t != OutboundProxy {
			continue
		}
		refs, _ := m["outbounds"].([]interface{})
		hasAuto := false
		for _, r := range refs {
			if s, ok := r.(string); ok && s == OutboundAutoSel {
				hasAuto = true
				break
			}
		}
		if !hasAuto {
			m["outbounds"] = append([]interface{}{OutboundAutoSel}, refs...)
			changed = true
		}
	}
	// 2. DNS detour 引用替换
	if dnsCfg, ok := cfg["dns"].(map[string]interface{}); ok {
		if servers, ok := dnsCfg["servers"].([]interface{}); ok {
			for _, s := range servers {
				if sm, ok := s.(map[string]interface{}); ok {
					if d, _ := sm["detour"].(string); d == "proxy" {
						sm["detour"] = OutboundProxy
						changed = true
					}
				}
			}
		}
	}
	// 3. 路由规则 outbound 引用替换
	if route, ok := cfg["route"].(map[string]interface{}); ok {
		if rules, ok := route["rules"].([]interface{}); ok {
			for _, r := range rules {
				if rm, ok := r.(map[string]interface{}); ok {
					if ob, _ := rm["outbound"].(string); ob == "proxy" {
						rm["outbound"] = OutboundProxy
						changed = true
					}
				}
			}
		}
		if final, _ := route["final"].(string); final == "proxy" {
			route["final"] = OutboundFallback
			changed = true
		}
	}
	if changed {
		log.Printf("🔧 迁移旧版 proxy 引用为 %s ...", OutboundProxy)
		if err := WriteSingBoxConfig(cfg); err != nil {
			return err
		}
	} else {
		return nil // 无残留引用，无需写盘
	}
	// 4. 规则库（rules.json）中引用 proxy 的规则更新
	store, err := LoadRules()
	if err != nil {
		return nil // 规则库不存在不阻塞
	}
	rulesChanged := 0
	for i := range store.Rules {
		if store.Rules[i].Outbound == "proxy" {
			store.Rules[i].Outbound = OutboundProxy
			rulesChanged++
		}
	}
	if rulesChanged > 0 {
		if err := SaveRules(store); err != nil {
			return err
		}
		log.Printf("🔧 已更新 %d 条规则的 outbound 引用", rulesChanged)
	}
	return nil
}

// EnsureBuiltinGroups 自修复内置出站组：检查代理节点/内置组是否完整，
// 缺失时补建并修正 GLOBAL 引用。防止用户删除内置组后 route.final 或
// GLOBAL 引用悬挂导致 sing-box 启动失败（删除内置组后重启即自动恢复）。
func EnsureBuiltinGroups() error {
	cfg, err := loadSingBoxConfig()
	if err != nil {
		return nil // 无配置文件（未应用订阅）无需处理
	}
	outbounds, _ := cfg["outbounds"].([]interface{})
	if len(outbounds) == 0 {
		return nil
	}
	// 旧版本残留迁移：proxy 组/default/detour 引用 → 🚀 节点选择（幂等，
	// 无论配置状态如何都执行，保证 default 等残留字段被清理）
	if err := migrateLegacyProxyGroup(cfg); err != nil {
		return err
	}
	cfg, err = loadSingBoxConfig()
	if err != nil {
		return err
	}
	outbounds, _ = cfg["outbounds"].([]interface{})
	if len(outbounds) == 0 {
		return nil
	}
	// 提取现有代理节点 tags 与 proxy 组默认选中
	var tags []string
	def := ""
	for _, ob := range outbounds {
		m, _ := ob.(map[string]interface{})
		if m == nil {
			continue
		}
		t, _ := m["type"].(string)
		tag, _ := m["tag"].(string)
		if t != "selector" && t != "direct" && t != "block" && t != "urltest" && t != "loadbalance" && tag != "" {
			tags = append(tags, tag)
		}
		if t == "selector" && tag == OutboundProxy {
			if d, ok := m["default"].(string); ok {
				def = d
			}
		}
	}
	// 完整性检查
	existing := make(map[string]bool)
	for _, ob := range outbounds {
		if m, ok := ob.(map[string]interface{}); ok {
			if t, _ := m["tag"].(string); t != "" {
				existing[t] = true
			}
		}
	}
	complete := existing[OutboundProxy] && existing[OutboundDirect] &&
		existing[OutboundAutoSel] && existing[OutboundDirectGrp] &&
		existing[OutboundBlockGrp] && existing[OutboundFallback] && existing[OutboundGlobal]
	if complete {
		return nil
	}
	if def == "" {
		def = OutboundProxy
	}
	log.Printf("🔧 检测到内置出站组缺失，自动补建...")
	cfg["outbounds"] = buildDefaultGroupOutbounds(outbounds, append(tags, OutboundDirect), def)
	if err := WriteSingBoxConfig(cfg); err != nil {
		return err
	}
	// final 重新指向漏网之鱼（组已补齐）
	if route, ok := cfg["route"].(map[string]interface{}); ok {
		applyFinalOutbound(route, cfg)
	}
	return WriteSingBoxConfig(cfg)
}

// EnsureDNSAndCache 补建 DNS 分流 / Clash API secret / cache.db（旧数据升级场景：
// 这些只在 ApplySubscription 时生成，旧配置直接升级镜像不会触发，此处幂等补建）。
func EnsureDNSAndCache() error {
	cfg, err := loadSingBoxConfig()
	if err != nil {
		return nil // 无配置不处理
	}
	changed := false

	// DNS 分流缺失时补建
	if _, ok := cfg["dns"]; !ok {
		cfg["dns"] = buildDNSConfig()
		log.Printf("🔧 补建 DNS 分流配置...")
		changed = true
	}
	// route.default_domain_resolver
	if route, ok := cfg["route"].(map[string]interface{}); ok {
		if _, ok := route["default_domain_resolver"]; !ok {
			route["default_domain_resolver"] = DNSLocal
			changed = true
		}
	}

	// experimental：cache_file + secret
	if exp, ok := cfg["experimental"].(map[string]interface{}); ok {
		if _, ok := exp["cache_file"]; !ok {
			cacheID := "dashboard"
			if id := LoadAppliedSubscriptionID(); id != "" {
				cacheID = "dashboard-" + id
			}
			exp["cache_file"] = map[string]interface{}{
				"enabled":      true,
				"path":         filepath.Join(config.DataDir, "cache.db"),
				"cache_id":     cacheID,
				"store_fakeip": true,
				"store_rdrc":   true,
				"rdrc_timeout": "7d",
			}
			log.Printf("🔧 补建 sing-box 原生缓存（cache.db）...")
			changed = true
		}
		if api, ok := exp["clash_api"].(map[string]interface{}); ok {
			if _, ok := api["secret"]; !ok {
				api["secret"] = EnsureClashSecret()
				log.Printf("🔧 补建 Clash API secret...")
				changed = true
			}
		}
	} else {
		cfg["experimental"] = buildExperimentalBlock("dashboard")
		log.Printf("🔧 补建 experimental（secret + cache.db）...")
		changed = true
	}

	if !changed {
		return nil
	}
	return WriteSingBoxConfig(cfg)
}

// builtinGroupTags 内置出站组（应用订阅自动生成，禁止删除，避免配置损坏后无法恢复）
var builtinGroupTags = []string{
	OutboundProxy, OutboundAutoSel, OutboundDirectGrp,
	OutboundBlockGrp, OutboundFallback, OutboundGlobal,
}

// IsBuiltinGroup 判断出站组是否为内置组
func IsBuiltinGroup(name string) bool {
	for _, t := range builtinGroupTags {
		if t == name {
			return true
		}
	}
	return false
}

// applyFinalOutbound 将 route.final 指向漏网之鱼组。
// 仅当配置中已存在该出站组（ApplySubscription 已生成模板）时升级，
// 否则保持旧值，避免老配置因引用不存在出站而启动 FATAL。
func applyFinalOutbound(route map[string]interface{}, cfg map[string]interface{}) {
	hasFallback := false
	if obs, ok := cfg["outbounds"].([]interface{}); ok {
		for _, ob := range obs {
			if m, ok := ob.(map[string]interface{}); ok {
				if t, _ := m["tag"].(string); t == OutboundFallback {
					hasFallback = true
					break
				}
			}
		}
	}
	if !hasFallback {
		// 组不存在：若 final 已指向漏网之鱼（损坏的旧配置持久化值），回退 proxy 防止启动 FATAL
		if final, ok := route["final"].(string); ok && final == OutboundFallback {
			route["final"] = OutboundProxy
		}
		return
	}
	if _, ok := route["final"]; !ok {
		route["final"] = OutboundFallback
		return
	}
	if final, ok := route["final"].(string); ok {
		switch final {
		case "proxy", "direct", "block":
			// 旧兜底值升级为漏网之鱼组
			route["final"] = OutboundFallback
		default:
			_ = final // 用户自定义 final 保留
		}
	}
}

// ═══════════════════════════════════════════════════════════
//  推荐路由规则（首次应用订阅时自动导入，用户已有规则时不覆盖）
// ═══════════════════════════════════════════════════════════

// SeedRecommendedRules 在规则库为空时导入基础分流规则（移植 GUI.for.SingBox
// 默认模板，去掉繁琐的可选项）。已有规则时不做任何事（尊重用户配置）。
func SeedRecommendedRules() error {
	store, err := LoadRules()
	if err != nil {
		return err
	}
	if len(store.Rules) > 0 {
		return nil
	}
	now := time.Now().UnixMilli()
	mk := func(idx int, comment string, priority int, conds ...models.RuleCondition) models.Rule {
		return models.Rule{
			ID:         fmt.Sprintf("rec_%d_%d", now, idx),
			Enabled:    true,
			Action:     "route",
			Comment:    comment,
			Priority:   priority,
			Conditions: conds,
		}
	}
	seed := []models.Rule{
		withOutbound(mk(1, "clash 直连模式全走直连组", 10, models.RuleCondition{Type: "clash_mode", Values: []string{"direct"}}), OutboundDirectGrp),
		withOutbound(mk(2, "clash 全局模式全走 GLOBAL 组", 11, models.RuleCondition{Type: "clash_mode", Values: []string{"global"}}), OutboundGlobal),
		withOutbound(mk(3, "ICMP 请求直连（ping 测试走真实网络）", 20, models.RuleCondition{Type: "network", Values: []string{"icmp"}}), OutboundDirectGrp),
		withOutbound(mk(4, "广告域名拦截", 30, models.RuleCondition{Type: "geosite", Values: []string{"category-ads-all"}}), OutboundBlockGrp),
		withOutbound(mk(5, "私有域名直连", 40, models.RuleCondition{Type: "geosite", Values: []string{"private"}}), OutboundDirectGrp),
		withOutbound(mk(6, "私有 IP 直连", 41, models.RuleCondition{Type: "geoip", Values: []string{"private"}}), OutboundDirectGrp),
		withOutbound(mk(7, "国内域名直连", 50, models.RuleCondition{Type: "geosite", Values: []string{"cn"}}), OutboundDirectGrp),
		withOutbound(mk(8, "国内 IP 直连", 51, models.RuleCondition{Type: "geoip", Values: []string{"cn"}}), OutboundDirectGrp),
		withOutbound(mk(9, "国外域名走节点选择", 60, models.RuleCondition{Type: "geosite", Values: []string{"geolocation-!cn"}}), OutboundProxy),
	}
	store.Rules = append(store.Rules, seed...)
	return SaveRules(store)
}

// withOutbound 设置规则的目标出站（供推荐规则 seed 使用）
func withOutbound(r models.Rule, tag string) models.Rule {
	r.Outbound = tag
	return r
}
