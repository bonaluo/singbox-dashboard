package services

import (
	"strings"
	"testing"
)

// 真实 ktm 订阅行（剩余流量信息节点，vless Reality）
const lineVlessInfo = "vless://f89f28a6-eb61-4f96-8918-22c9a119247f@sg1.ktmhy.cc:16801?mode=multi&security=reality&encryption=none&type=tcp&flow=xtls-rprx-vision&pbk=gkMe-fYUGY0z2ubgC8ngRQnERWhc-Unskf2L_DT9Khs&sid=a659c9a2&sni=www.lamer.com.hk&spx=%2F&fp=ios#%E5%89%A9%E4%BD%99%E6%B5%81%E9%87%8F%EF%BC%9A947.88+GB"

// 真实 ktm 订阅行（vless Reality 真实节点）
const lineVlessSG = "vless://f89f28a6-eb61-4f96-8918-22c9a119247f@sg2.ktmhy.cc:16801?mode=multi&security=reality&encryption=none&type=tcp&flow=xtls-rprx-vision&pbk=gkMe-fYUGY0z2ubgC8ngRQnERWhc-Unskf2L_DT9Khs&sid=a659c9a2&sni=www.lamer.com.hk&spx=%2F&fp=safari#%E6%96%B0%E5%8A%A0%E5%9D%A102-VLESS"

// 真实 ktm 订阅行（vmess ws）
const lineVmess = "vmess://eyJ2IjoiMiIsInBzIjoiXHVkODNjXHVkZGY4XHVkODNjXHVkZGVjIFNHXHU2NWIwXHU1MmEwXHU1NzYxLTAxLVx1NTZmZFx1NTE4NVx1NWI5OFx1N2Y1MVx1ZmYxYWt0bS5vb28iLCJhZGQiOiJndG0xLmt0bXdhbi5uZXQiLCJwb3J0IjoiMTI5MDEiLCJpZCI6ImY4OWYyOGE2LWViNjEtNGY5Ni04OTE4LTIyYzlhMTE5MjQ3ZiIsImFpZCI6IjAiLCJuZXQiOiJ3cyIsInR5cGUiOiJub25lIiwiaG9zdCI6ImJhaWR1LmNvbSIsInBhdGgiOiJcLyIsInRscyI6IiJ9"

const (
	lineTrojan    = "trojan://example-password@123.45.67.89:443?security=tls&sni=example.com&type=ws&path=%2Fws&host=example.com#%F0%9F%87%AD%F0%9F%87%B0%20HK"
	lineHysteria2 = "hysteria2://pass123@5.6.7.8:8443?insecure=1&sni=h2.example.com&obfs=salamander&obfs-password=obfspw#JP"
	lineHysteria  = "hysteria://1.2.3.4:443?up=100&down=200&auth=aGVsbG8=&sni=hy.example.com#US"
	lineTuic      = "tuic://11111111-2222-3333-4444-555555555555:token123@9.9.9.9:7777?congestion_control=bbr&alpn=h3&sni=tuic.example.com#DE"
	lineSS        = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@4.4.4.4:8388#%E2%9A%A1SG"
	lineSSLegacy  = "ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpzZWNyZXRANS41LjUuNToxMjM0#legacy"
)

func cfgStr(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func cfgMap(m map[string]interface{}, key string) map[string]interface{} {
	if v, ok := m[key].(map[string]interface{}); ok {
		return v
	}
	return nil
}

func TestParseSubscriptionLines_allProtocols(t *testing.T) {
	lines := []string{
		lineVlessInfo,          // 信息节点（剩余流量）
		lineVlessInfo,          // 重复 → 去重
		lineVlessSG,            // vless 真实节点
		lineVmess,              // vmess
		lineTrojan,             // trojan
		lineHysteria2,          // hysteria2
		lineHysteria,           // hysteria
		lineTuic,               // tuic
		lineSS,                 // ss SIP002
		lineSSLegacy,           // ss legacy
		"unknown://not-a-node", // 不识别协议 → 丢弃
	}
	nodes := parseSubscriptionLines(lines)
	if len(nodes) != 9 {
		t.Fatalf("期望 9 个节点（去重后），实际 %d", len(nodes))
	}

	// 信息节点排在最上面
	if !nodes[0].IsInfo {
		t.Fatalf("第一个节点应是信息节点，实际 %q (IsInfo=%v)", nodes[0].Tag, nodes[0].IsInfo)
	}
	if nodes[0].Tag != "剩余流量：947.88 GB" {
		t.Fatalf("信息节点 tag 解析错误: %q", nodes[0].Tag)
	}

	types := map[string]int{}
	for _, n := range nodes {
		types[n.Type]++
	}
	want := map[string]int{"vless": 2, "vmess": 1, "trojan": 1, "hysteria2": 1, "hysteria": 1, "tuic": 1, "shadowsocks": 2}
	for k, v := range want {
		if types[k] != v {
			t.Errorf("类型 %s 节点数期望 %d，实际 %d (全部: %v)", k, v, types[k], types)
		}
	}
}

func TestParseNodeLink_vlessReality(t *testing.T) {
	n, ok := parseNodeLink(lineVlessSG)
	if !ok {
		t.Fatal("vless 解析失败")
	}
	if n.Tag != "新加坡02-VLESS" || n.Type != "vless" || n.Server != "sg2.ktmhy.cc" || n.Port != 16801 {
		t.Fatalf("vless 基础字段错误: %+v", n)
	}
	if n.IsInfo {
		t.Fatal("vless 真实节点不应标记为信息节点")
	}
	cfg := n.Config
	if cfgStr(cfg, "uuid") != "f89f28a6-eb61-4f96-8918-22c9a119247f" {
		t.Errorf("uuid 错误: %v", cfg["uuid"])
	}
	if cfgStr(cfg, "flow") != "xtls-rprx-vision" {
		t.Errorf("flow 错误: %v", cfg["flow"])
	}
	tls := cfgMap(cfg, "tls")
	if tls == nil {
		t.Fatal("reality 节点应有 tls")
	}
	if cfgStr(tls, "server_name") != "www.lamer.com.hk" {
		t.Errorf("server_name 错误: %v", tls["server_name"])
	}
	reality := cfgMap(tls, "reality")
	if reality == nil || reality["enabled"] != true {
		t.Fatal("tls.reality.enabled 应为 true")
	}
	if cfgStr(reality, "public_key") == "" || cfgStr(reality, "short_id") == "" {
		t.Errorf("reality pbk/sid 缺失: %v", reality)
	}
	utls := cfgMap(tls, "utls")
	if utls == nil || cfgStr(utls, "fingerprint") != "safari" {
		t.Errorf("utls fingerprint 错误: %v", utls)
	}
}

func TestParseNodeLink_vlessInfo(t *testing.T) {
	n, ok := parseNodeLink(lineVlessInfo)
	if !ok {
		t.Fatal("vless 信息行解析失败")
	}
	if !n.IsInfo {
		t.Fatal("剩余流量行应标记为信息节点")
	}
	if n.Region == "" {
		t.Fatal("信息节点也应有地区（其他）")
	}
}

func TestParseNodeLink_vmess(t *testing.T) {
	n, ok := parseNodeLink(lineVmess)
	if !ok {
		t.Fatal("vmess 解析失败")
	}
	if n.Server != "gtm1.ktmwan.net" || n.Port != 12901 {
		t.Fatalf("vmess server/port 错误: %+v", n)
	}
	cfg := n.Config
	if cfgStr(cfg, "uuid") == "" || cfgStr(cfg, "security") != "auto" {
		t.Errorf("vmess uuid/security 缺失: %v", cfg)
	}
	tr := cfgMap(cfg, "transport")
	if tr == nil || cfgStr(tr, "type") != "ws" || cfgStr(tr, "path") != "/" {
		t.Errorf("vmess transport 错误: %v", tr)
	}
}

func TestParseNodeLink_trojan(t *testing.T) {
	n, ok := parseNodeLink(lineTrojan)
	if !ok {
		t.Fatal("trojan 解析失败")
	}
	if n.Tag != "🇭🇰 HK" || n.Port != 443 {
		t.Fatalf("trojan 基础字段错误: %+v", n)
	}
	cfg := n.Config
	if cfgStr(cfg, "password") != "example-password" {
		t.Errorf("trojan password 错误: %v", cfg["password"])
	}
	tls := cfgMap(cfg, "tls")
	if tls == nil || tls["enabled"] != true || cfgStr(tls, "server_name") != "example.com" {
		t.Errorf("trojan tls 错误: %v", tls)
	}
	tr := cfgMap(cfg, "transport")
	if tr == nil || cfgStr(tr, "type") != "ws" || cfgStr(tr, "path") != "/ws" {
		t.Errorf("trojan transport 错误: %v", tr)
	}
}

func TestParseNodeLink_hysteria2(t *testing.T) {
	n, ok := parseNodeLink(lineHysteria2)
	if !ok {
		t.Fatal("hysteria2 解析失败")
	}
	if n.Type != "hysteria2" || n.Server != "5.6.7.8" || n.Port != 8443 {
		t.Fatalf("hysteria2 基础字段错误: %+v", n)
	}
	cfg := n.Config
	if cfgStr(cfg, "password") != "pass123" {
		t.Errorf("hysteria2 password 错误: %v", cfg["password"])
	}
	tls := cfgMap(cfg, "tls")
	if tls == nil || tls["insecure"] != true || cfgStr(tls, "server_name") != "h2.example.com" {
		t.Errorf("hysteria2 tls 错误: %v", tls)
	}
	obfs := cfgMap(cfg, "obfs")
	if obfs == nil || cfgStr(obfs, "type") != "salamander" || cfgStr(obfs, "password") != "obfspw" {
		t.Errorf("hysteria2 obfs 错误: %v", obfs)
	}
}

func TestParseNodeLink_hysteria(t *testing.T) {
	n, ok := parseNodeLink(lineHysteria)
	if !ok {
		t.Fatal("hysteria 解析失败")
	}
	cfg := n.Config
	if cfg["up_mbps"] != 100 || cfg["down_mbps"] != 200 {
		t.Errorf("hysteria up/down 错误: up=%v down=%v", cfg["up_mbps"], cfg["down_mbps"])
	}
	if cfgStr(cfg, "auth") != "aGVsbG8=" {
		t.Errorf("hysteria auth 错误: %v", cfg["auth"])
	}
}

func TestParseNodeLink_tuic(t *testing.T) {
	n, ok := parseNodeLink(lineTuic)
	if !ok {
		t.Fatal("tuic 解析失败")
	}
	cfg := n.Config
	if cfgStr(cfg, "uuid") != "11111111-2222-3333-4444-555555555555" || cfgStr(cfg, "password") != "token123" {
		t.Errorf("tuic uuid/password 错误: %v", cfg)
	}
	if cfgStr(cfg, "congestion_control") != "bbr" {
		t.Errorf("tuic congestion_control 错误: %v", cfg["congestion_control"])
	}
	tls := cfgMap(cfg, "tls")
	if tls == nil {
		t.Fatal("tuic 应有 tls")
	}
	if alpn, ok := tls["alpn"].([]string); !ok || len(alpn) != 1 || alpn[0] != "h3" {
		t.Errorf("tuic alpn 错误: %v", tls["alpn"])
	}
}

func TestParseNodeLink_ss(t *testing.T) {
	n, ok := parseNodeLink(lineSS)
	if !ok {
		t.Fatal("ss SIP002 解析失败")
	}
	if n.Server != "4.4.4.4" || n.Port != 8388 || n.Tag != "⚡SG" {
		t.Fatalf("ss 基础字段错误: %+v", n)
	}
	cfg := n.Config
	if cfgStr(cfg, "method") != "aes-256-gcm" || cfgStr(cfg, "password") != "password" {
		t.Errorf("ss method/password 错误: %v", cfg)
	}
}

func TestParseNodeLink_ssLegacy(t *testing.T) {
	n, ok := parseNodeLink(lineSSLegacy)
	if !ok {
		t.Fatal("ss legacy 解析失败")
	}
	if n.Server != "5.5.5.5" || n.Port != 1234 || n.Tag != "legacy" {
		t.Fatalf("ss legacy 基础字段错误: %+v", n)
	}
	cfg := n.Config
	if cfgStr(cfg, "method") != "chacha20-ietf-poly1305" || cfgStr(cfg, "password") != "secret" {
		t.Errorf("ss legacy method/password 错误: %v", cfg)
	}
}

func TestParseNodeLink_unknown(t *testing.T) {
	if _, ok := parseNodeLink("socks://abc"); ok {
		t.Fatal("未知协议不应解析成功")
	}
	if _, ok := parseNodeLink("vless://bad"); ok {
		t.Fatal("残缺 vless 不应解析成功")
	}
}

func TestParseSubscriptionLines_CRLF(t *testing.T) {
	// 订阅行可能带 \r\n
	nodes := parseSubscriptionLines([]string{lineVlessSG + "\r", lineVlessSG + "\r"})
	if len(nodes) != 1 {
		t.Fatalf("CRLF + 去重后期望 1 个节点，实际 %d", len(nodes))
	}
	if !strings.Contains(nodes[0].Server, "sg2") {
		t.Errorf("server 解析异常: %v", nodes[0].Server)
	}
}
