package services

import (
	"strings"
	"testing"
)

// 模拟真实 Clash YAML 订阅（脱敏）：vless reality + ws 节点 + trojan + 信息节点
const clashYAML = `mixed-port: 7890
allow-lan: false
mode: rule
dns:
  enable: true
  ipv6: false
  enhanced-mode: fake-ip
  nameserver:
    - 223.5.5.5
proxies:
  - name: "剩余流量：1002.15 GB" # 信息节点
    type: vless
    server: us1.example.com
    port: 443
    uuid: 11111111-2222-3333-4444-555555555555
    network: tcp
    tls: true
    flow: xtls-rprx-vision
    servername: example.com
    client-fingerprint: chrome
    reality-opts:
      public-key: REDACTED_PUBLIC_KEY
      short-id: aabbccddee
  - name: "新加坡 01"
    type: vless
    server: sg1.example.com
    port: 443
    uuid: 11111111-2222-3333-4444-555555555555
    network: ws
    tls: true
    servername: sg1.example.com
    ws-opts:
      path: /ws
      headers:
        Host: sg1.example.com
  - name: "日本 01"
    type: trojan
    server: jp1.example.com
    port: 8443
    password: "pass#123" # 含 # 的密码不应被截断
    tls: true
    sni: jp1.example.com
    skip-cert-verify: true
    network: grpc
    grpc-opts:
      grpc-service-name: /grpc
      grpc-mode: multi
  - name: "香港 02"
    type: hysteria2
    server: hk2.example.com
    port: 8443
    password: hy2pass
    obfs: salamander
    obfs-password: obfspw
    skip-cert-verify: true
  - name: "美国 01"
    type: ss
    server: us5.example.com
    port: 8388
    cipher: aes-256-gcm
    password: sspass
proxy-groups:
  - name: PROXY
    type: select
    proxies:
      - 新加坡 01
rules:
  - DOMAIN-SUFFIX,google.com,PROXY
`

func TestParseClashSubscription(t *testing.T) {
	nodes := parseClashSubscription(clashYAML)
	if len(nodes) != 5 {
		t.Fatalf("期望 5 个节点，实际 %d", len(nodes))
	}

	// 信息节点（剩余流量）排在最上面
	if !nodes[0].IsInfo {
		t.Fatalf("期望第一个是信息节点，实际 %q", nodes[0].Tag)
	}

	// 找到信息节点（vless reality）验证 Config
	var reality *map[string]interface{}
	for i := range nodes {
		if nodes[i].Tag == "剩余流量：1002.15 GB" {
			reality = &nodes[i].Config
		}
	}
	if reality == nil {
		t.Fatal("未找到信息节点（vless reality）")
	}
	if got := cfgStr(*reality, "type"); got != "vless" {
		t.Errorf("type = %q, 期望 vless", got)
	}
	if got := cfgStr(*reality, "flow"); got != "xtls-rprx-vision" {
		t.Errorf("flow = %q, 期望 xtls-rprx-vision", got)
	}
	tlsObj := cfgMap(*reality, "tls")
	if tlsObj == nil {
		t.Fatal("缺少 tls 配置")
	}
	if got := cfgStr(tlsObj, "server_name"); got != "example.com" {
		t.Errorf("server_name = %q", got)
	}
	realityObj := cfgMap(tlsObj, "reality")
	if realityObj == nil {
		t.Fatal("缺少 reality 配置")
	}
	if got := cfgStr(realityObj, "public_key"); got == "" {
		t.Error("reality public_key 缺失")
	}
	if got := cfgStr(realityObj, "short_id"); got != "aabbccddee" {
		t.Errorf("short_id = %q", got)
	}
}

func TestParseClashSubscription_wsTransport(t *testing.T) {
	nodes := parseClashSubscription(clashYAML)
	for i := range nodes {
		if nodes[i].Tag != "新加坡 01" {
			continue
		}
		tr := cfgMap(nodes[i].Config, "transport")
		if tr == nil {
			t.Fatal("缺少 ws transport")
		}
		if got := cfgStr(tr, "type"); got != "ws" {
			t.Errorf("transport type = %q", got)
		}
		if got := cfgStr(tr, "path"); got != "/ws" {
			t.Errorf("ws path = %q", got)
		}
		hd := cfgMap(tr, "headers")
		if hd == nil || cfgStr(hd, "Host") != "sg1.example.com" {
			t.Errorf("ws Host header 缺失, headers=%v", hd)
		}
	}
}

func TestParseClashSubscription_trojan(t *testing.T) {
	nodes := parseClashSubscription(clashYAML)
	var n *map[string]interface{}
	for i := range nodes {
		if nodes[i].Tag == "日本 01" {
			n = &nodes[i].Config
		}
	}
	if n == nil {
		t.Fatal("未找到 日本 01")
	}
	// 密码含 #：行内注释不应截断引号内内容
	if got := cfgStr(*n, "password"); got != "pass#123" {
		t.Errorf("password = %q, 期望 pass#123", got)
	}
	tlsObj := cfgMap(*n, "tls")
	if tlsObj == nil {
		t.Fatal("trojan 缺少 tls")
	}
	if v, _ := tlsObj["insecure"].(bool); !v {
		t.Error("skip-cert-verify 未映射为 insecure")
	}
	tr := cfgMap(*n, "transport")
	if tr == nil || cfgStr(tr, "type") != "grpc" {
		t.Fatalf("trojan grpc transport 缺失: %v", tr)
	}
	if got := cfgStr(tr, "service_name"); got != "grpc" {
		t.Errorf("grpc service_name = %q, 期望 grpc（去掉前导 /）", got)
	}
	if v, _ := tr["multi_mode"].(bool); !v {
		t.Error("grpc multi_mode 未映射")
	}
}

func TestParseClashSubscription_hysteria2(t *testing.T) {
	nodes := parseClashSubscription(clashYAML)
	var n *map[string]interface{}
	for i := range nodes {
		if nodes[i].Tag == "香港 02" {
			n = &nodes[i].Config
		}
	}
	if n == nil {
		t.Fatal("未找到 香港 02")
	}
	if got := cfgStr(*n, "password"); got != "hy2pass" {
		t.Errorf("password = %q", got)
	}
	obfs := cfgMap(*n, "obfs")
	if obfs == nil || cfgStr(obfs, "type") != "salamander" || cfgStr(obfs, "password") != "obfspw" {
		t.Errorf("hysteria2 obfs 缺失: %v", obfs)
	}
}

func TestParseClashSubscription_ss(t *testing.T) {
	nodes := parseClashSubscription(clashYAML)
	var n *map[string]interface{}
	for i := range nodes {
		if nodes[i].Tag == "美国 01" {
			n = &nodes[i].Config
		}
	}
	if n == nil {
		t.Fatal("未找到 美国 01")
	}
	if got := cfgStr(*n, "type"); got != "shadowsocks" {
		t.Errorf("type = %q, 期望 shadowsocks", got)
	}
	if got := cfgStr(*n, "method"); got != "aes-256-gcm" {
		t.Errorf("method = %q", got)
	}
}

// 链接格式解析不到时回退到 YAML：用真实抓取结构（脱敏）做端到端验证
func TestParseRaw_fallbackToClashYAML(t *testing.T) {
	raw := strings.ReplaceAll(clashYAML, "剩余流量：1002.15 GB", "剩余流量：102.15 GB")
	// 链接格式解析应得到 0 节点，触发 YAML 回退
	result := ParseRaw(raw)
	if result.NodeCount == 0 {
		t.Fatalf("YAML 回退失败：0 节点")
	}
	if !result.Nodes[0].IsInfo {
		t.Errorf("信息节点应排最上面，实际 %q", result.Nodes[0].Tag)
	}
}

func TestParseClashSubscription_plainLinkFallsBack(t *testing.T) {
	// 链接格式的订阅不应受影响（不触发回退）
	lines := []string{lineVlessSG, lineVmess}
	nodes := parseSubscriptionLines(lines)
	if len(nodes) != 2 {
		t.Fatalf("链接格式应解析出 2 个节点，实际 %d", len(nodes))
	}
	// YAML 回退入口对链接文本应返回空
	if y := parseClashSubscription(strings.Join(lines, "\n")); len(y) != 0 {
		t.Errorf("链接文本不应被 YAML 解析出节点，实际 %d", len(y))
	}
}
