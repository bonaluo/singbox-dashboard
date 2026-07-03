package services

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os/exec"
	"singbox-dashboard/config"
	"strings"
	"sync"
	"time"
)

// ═══════════════════════════════════════════════════════════
//  节点测试：延迟 + 下载速度，支持并发，SSE 推送进度
// ═══════════════════════════════════════════════════════════

// NodeTestRequest 前端发起测试的请求参数
type NodeTestRequest struct {
	Tags         []string `json:"tags"`
	Concurrency  int      `json:"concurrency"`
	Tests        []string `json:"tests"` // "latency", "download"
	LatencyURL   string   `json:"latency_url,omitempty"`
	DownloadURL  string   `json:"download_url,omitempty"`
	DownloadSize int64    `json:"download_size,omitempty"` // 下载文件字节数，默认 524288
}

// NodeTestEvent SSE 推送的测试事件
type NodeTestEvent struct {
	Type       string  `json:"type"`                 // "progress" | "result" | "complete" | "error"
	TestType   string  `json:"test_type,omitempty"`  // "latency" | "download"
	NodeTag    string  `json:"node_tag,omitempty"`
	Status     string  `json:"status,omitempty"`     // "pending" | "testing" | "done"
	Delay      int     `json:"delay,omitempty"`      // ms, -1=超时/失败
	Speed      float64 `json:"speed,omitempty"`      // MB/s, 下载速度
	Total      int     `json:"total,omitempty"`
	Completed  int     `json:"completed,omitempty"`
	Error      string  `json:"error,omitempty"`
}

// 默认测试 URL
const (
	defaultLatencyURL    = "http://www.gstatic.com/generate_204"
	defaultLatencyTimeout = 5000 // ms

	defaultDownloadURL    = "https://speed.cloudflare.com/__down?bytes=524288"
	defaultDownloadTimeout = 15000  // ms
	defaultDownloadBytes   = 524288 // 512KB
)

// probeConfig 单次测试的运行时配置
type probeConfig struct {
	latencyURL    string
	latencyTimeout int
	downloadURL   string
	downloadTimeout int
	downloadBytes   int64
}

// ProbeNodeLatency 测试单个节点的延迟
func ProbeNodeLatency(tag string, testURL string) int {
	if testURL == "" {
		testURL = defaultLatencyURL
	}
	delay := getProxyDelayViaAPI(tag, testURL, defaultLatencyTimeout)
	return delay
}

// ProbeNodeDownload 测试单个节点的下载速度，返回速度 MB/s
func ProbeNodeDownload(tag string, testURL string, fileBytes int64) float64 {
	if testURL == "" {
		testURL = defaultDownloadURL
	}
	if fileBytes <= 0 {
		fileBytes = defaultDownloadBytes
	}
	timeout := defaultDownloadTimeout
	if fileBytes > defaultDownloadBytes {
		// 文件越大超时越长
		timeout = defaultDownloadTimeout * int(fileBytes/defaultDownloadBytes)
	}

	start := time.Now()
	delay := getProxyDelayViaAPI(tag, testURL, timeout)
	elapsed := time.Since(start).Milliseconds()

	if delay <= 0 || delay >= timeout {
		return -1
	}

	// 使用实际耗时计算速度（含 API 开销）
	actualMs := delay
	if elapsed > int64(delay) {
		actualMs = int(elapsed)
	}

	// bytes / ms * 1000 / (1024*1024) = MB/s
	speedMBps := float64(fileBytes) / float64(actualMs) * 1000.0 / (1024.0 * 1024.0)
	return speedMBps
}

// getProxyDelayViaAPI 通过 Clash API 测试节点到指定 URL 的延迟
func getProxyDelayViaAPI(tag, testURL string, timeout int) int {
	apiURL := fmt.Sprintf("%s/proxies/%s/delay?url=%s&timeout=%d",
		config.ClashAPI, url.PathEscape(tag), url.QueryEscape(testURL), timeout)
	cmd := exec.Command("curl", "-s", "--noproxy", "*", "--max-time", fmt.Sprintf("%d", (timeout/1000)+2), apiURL)
	out, err := cmd.Output()
	if err != nil {
		return -1
	}
	var result struct {
		Delay int `json:"delay"`
	}
	if err := json.Unmarshal(out, &result); err != nil {
		return -1
	}
	return result.Delay
}

// TestNodesStream 并发测试节点，通过 SSE 推送进度事件
// callback 在每个事件发生时被调用（线程安全）
func TestNodesStream(req NodeTestRequest, callback func(NodeTestEvent)) {
	tags := req.Tags
	concurrency := req.Concurrency
	tests := req.Tests
	latencyURL := req.LatencyURL
	downloadURL := req.DownloadURL
	downloadBytes := req.DownloadSize
	if concurrency <= 0 {
		concurrency = 5
	}

	testLatency := false
	testDownload := false
	for _, t := range tests {
		switch t {
		case "latency":
			testLatency = true
		case "download":
			testDownload = true
		}
	}
	if !testLatency && !testDownload {
		testLatency = true // 默认只测延迟
	}

	// 按测试类型分别管理进度
	type testState struct {
		mu        sync.Mutex
		total     int
		completed int
		results   map[string]NodeTestEvent // tag → result
	}

	latencyState := &testState{results: make(map[string]NodeTestEvent)}
	downloadState := &testState{results: make(map[string]NodeTestEvent)}

	if testLatency {
		latencyState.total = len(tags)
	}
	if testDownload {
		downloadState.total = len(tags)
	}

	// 发送初始 pending 事件
	for _, tag := range tags {
		if testLatency {
			evt := NodeTestEvent{
				Type: "progress", TestType: "latency", NodeTag: tag,
				Status: "pending", Total: latencyState.total, Completed: 0,
			}
			latencyState.results[tag] = evt
			callback(evt)
		}
		if testDownload {
			evt := NodeTestEvent{
				Type: "progress", TestType: "download", NodeTag: tag,
				Status: "pending", Total: downloadState.total, Completed: 0,
			}
			downloadState.results[tag] = evt
			callback(evt)
		}
	}

	// 并发控制
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup

	for _, tag := range tags {
		wg.Add(1)
		go func(nodeTag string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			// 延迟测试
			if testLatency {
				// status → testing
				latencyState.mu.Lock()
				evt := latencyState.results[nodeTag]
				evt.Status = "testing"
				latencyState.results[nodeTag] = evt
				latencyState.mu.Unlock()
				callback(evt)

				// 执行测试
				delay := ProbeNodeLatency(nodeTag, latencyURL)

				// 更新结果
				latencyState.mu.Lock()
				evt = latencyState.results[nodeTag]
				evt.Status = "done"
				evt.Delay = delay
				latencyState.completed++
				evt.Completed = latencyState.completed
				latencyState.results[nodeTag] = evt
				latencyState.mu.Unlock()
				callback(evt)
			}

			// 下载测试
			if testDownload {
				// status → testing
				downloadState.mu.Lock()
				evt := downloadState.results[nodeTag]
				evt.Status = "testing"
				downloadState.results[nodeTag] = evt
				downloadState.mu.Unlock()
				callback(evt)

				// 执行测试
				speed := ProbeNodeDownload(nodeTag, downloadURL, downloadBytes)

				// 更新结果
				downloadState.mu.Lock()
				evt = downloadState.results[nodeTag]
				evt.Status = "done"
				evt.Speed = speed
				downloadState.completed++
				evt.Completed = downloadState.completed
				downloadState.results[nodeTag] = evt
				downloadState.mu.Unlock()
				callback(evt)
			}
		}(tag)
	}

	wg.Wait()

	// 发送完成事件，附带所有结果摘要
	callback(NodeTestEvent{
		Type: "complete",
		Total: len(tags),
		Completed: len(tags),
	})
}

// ── 辅助：获取节点列表的可测试项 ──

// GetTestableNodes 返回所有非组、非 direct 的节点 tag 列表
func GetTestableNodes() []string {
	cfg, err := loadSingBoxConfig()
	if err != nil {
		return nil
	}
	var tags []string
	outbounds, ok := cfg["outbounds"].([]interface{})
	if !ok {
		return nil
	}
	for _, ob := range outbounds {
		m, ok := ob.(map[string]interface{})
		if !ok {
			continue
		}
		t, _ := m["type"].(string)
		tag, _ := m["tag"].(string)
		if tag == "" {
			continue
		}
		// 排除组和 direct
		if t == "selector" || t == "urltest" || t == "loadbalance" || t == "direct" || t == "block" || t == "dns" {
			continue
		}
		// 排除元信息行
		if isMetaLine(tag) {
			continue
		}
		tags = append(tags, tag)
	}
	return tags
}

// DeduplicateTags 去重 + 过滤空值
func DeduplicateTags(tags []string) []string {
	seen := make(map[string]bool)
	var result []string
	for _, t := range tags {
		t = strings.TrimSpace(t)
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		result = append(result, t)
	}
	return result
}
