package services

import (
	"testing"
)

// 模拟机场对 sing-box UA 返回的配置 JSON（脱敏）：35 个 hysteria2 节点中的 4 个
const singBoxJSON = `{
  "dns": {
    "servers": [
      {"address": "https://1.1.1.1/dns-query", "detour": "节点选择", "tag": "remote"},
      {"address": "https://223.5.5.5/dns-query", "detour": "direct", "tag": "local"}
    ]
  },
  "outbounds": [
    {"type": "hysteria2", "tag": "剩余流量：955.3 GB", "server": "hk1.example.com", "server_port": "18385",
     "password": "00000000-0000-4000-8000-000000000000",
     "tls": {"enabled": true, "insecure": true, "server_name": null}},
    {"type": "hysteria2", "tag": "套餐到期：2026-09-06", "server": "hk1.example.com", "server_port": "18385",
     "password": "00000000-0000-4000-8000-000000000000",
     "tls": {"enabled": true, "insecure": true, "server_name": null}},
    {"type": "hysteria2", "tag": "🇭🇰 香港 01", "server": "hk1.example.com", "server_port": "18385",
     "password": "00000000-0000-4000-8000-000000000000",
     "tls": {"enabled": true, "insecure": false, "server_name": "hk1.example.com"}},
    {"type": "hysteria2", "tag": "🇯🇵 日本 01", "server": "jp1.example.com", "server_port": 443,
     "password": "00000000-0000-4000-8000-000000000000",
     "tls": {"enabled": true, "insecure": true, "server_name": null}},
    {"type": "selector", "tag": "节点选择", "outbounds": ["自动选择", "香港 01"]},
    {"type": "urltest", "tag": "自动选择", "outbounds": ["香港 01"]},
    {"type": "direct", "tag": "direct"}
  ]
}`

func TestParseSingBoxJSON(t *testing.T) {
	nodes := parseSingBoxJSON(singBoxJSON)
	// 4 个真实节点（selector/urltest/direct 被过滤）
	if len(nodes) != 4 {
		t.Fatalf("期望 4 个节点，实际 %d", len(nodes))
	}

	// 信息节点排最上面
	if !nodes[0].IsInfo {
		t.Fatalf("期望第一个是信息节点，实际 %q", nodes[0].Tag)
	}

	// 节点配置原样复用（含 tls 结构）
	for _, n := range nodes {
		if n.Tag == "🇭🇰 香港 01" {
			if n.Config == nil {
				t.Fatal("节点 Config 缺失")
			}
			if got := cfgStr(n.Config, "type"); got != "hysteria2" {
				t.Errorf("type = %q, 期望 hysteria2", got)
			}
			if got := cfgStr(n.Config, "password"); got == "" {
				t.Error("password 缺失")
			}
			tlsObj := cfgMap(n.Config, "tls")
			if tlsObj == nil {
				t.Fatal("tls 配置缺失")
			}
			if v, ok := tlsObj["insecure"].(bool); !ok || v {
				t.Errorf("insecure 未按原值保留: %v", tlsObj["insecure"])
			}
			// server_port 为字符串也应正确解析
			if got := toInt(n.Config["server_port"]); got != 18385 {
				t.Errorf("server_port = %d, 期望 18385", got)
			}
		}
		if n.Tag == "🇯🇵 日本 01" {
			if got := toInt(n.Config["server_port"]); got != 443 {
				t.Errorf("数字型 server_port = %d, 期望 443", got)
			}
		}
	}
}

// 链接/YAML 都解析不到时回退到 sing-box JSON（端到端）
func TestParseRaw_fallbackToSingBoxJSON(t *testing.T) {
	result := ParseRaw(singBoxJSON)
	if result.NodeCount == 0 {
		t.Fatal("sing-box JSON 回退失败：0 节点")
	}
	if result.NodeCount != 4 {
		t.Errorf("NodeCount = %d, 期望 4", result.NodeCount)
	}
}
