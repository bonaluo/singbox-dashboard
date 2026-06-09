package services

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"
)

// ═══════════════════════════════════════════════════════════
//  SSE Hub — 服务端事件推送，替代前端轮询
// ═══════════════════════════════════════════════════════════

type SSEClient struct {
	Ch    chan SSEEvent
	types map[string]bool
}

type SSEEvent struct {
	Type string
	Data string
}

type SSEHub struct {
	mu        sync.RWMutex
	clients   map[*SSEClient]bool
	lastHash  map[string]string // 变更检测：每种事件类型的上一次 hash
	lastLogSz int64             // 日志文件已发送的字节数
}

var sseHub *SSEHub

// InitSSE 初始化并启动 SSE Hub（在 main.go 中调用）
func InitSSE() {
	sseHub = &SSEHub{
		clients:  make(map[*SSEClient]bool),
		lastHash: make(map[string]string),
	}
	go sseHub.run()
	log.Println("[sse] hub started")
}

// Subscribe 注册 SSE 客户端，返回其事件 channel；立即发送当前快照
func (h *SSEHub) Subscribe(types []string) *SSEClient {
	c := &SSEClient{
		Ch:    make(chan SSEEvent, 32),
		types: make(map[string]bool),
	}
	for _, t := range types {
		c.types[t] = true
	}

	// 立即给新客户端发送当前状态
	h.mu.RLock()
	for _, t := range types {
		switch t {
		case "status":
			status := GetStatus()
			data, _ := json.Marshal(status)
			h.lastHash["status"] = fmt.Sprintf("%x", sha256.Sum256(data))
			select {
			case c.Ch <- SSEEvent{Type: "status", Data: string(data)}:
			default:
			}
		case "connections":
			conns := GetConnections()
			data, _ := json.Marshal(map[string]interface{}{
				"connections": conns,
				"count":       len(conns),
			})
			h.lastHash["connections"] = fmt.Sprintf("%x", sha256.Sum256(data))
			select {
			case c.Ch <- SSEEvent{Type: "connections", Data: string(data)}:
			default:
			}
		case "logs":
			// 日志不发初始快照，只推送增量
		}
	}
	h.mu.RUnlock()

	h.mu.Lock()
	h.clients[c] = true
	h.mu.Unlock()
	return c
}

// Unsubscribe 注销 SSE 客户端
func (h *SSEHub) Unsubscribe(c *SSEClient) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
	close(c.Ch)
}

// SubscribeSSE 全局便捷函数（供 handler 调用）
func SubscribeSSE(types []string) *SSEClient {
	if sseHub == nil {
		return nil
	}
	return sseHub.Subscribe(types)
}

// UnsubscribeSSE 全局便捷函数
func UnsubscribeSSE(c *SSEClient) {
	if sseHub != nil {
		sseHub.Unsubscribe(c)
	}
}

// ForceBroadcastStatus 立即广播当前状态（切换节点后调用，跳过 3s 轮询等待）
func ForceBroadcastStatus() {
	if sseHub != nil {
		sseHub.forceBroadcastStatus()
	}
}

// ── 内部轮询 & 广播 ──

func (h *SSEHub) run() {
	statusTicker := time.NewTicker(3 * time.Second)
	connTicker := time.NewTicker(2 * time.Second)
	logTicker := time.NewTicker(2 * time.Second)
	defer statusTicker.Stop()
	defer connTicker.Stop()
	defer logTicker.Stop()

	for {
		select {
		case <-statusTicker.C:
			h.checkAndBroadcastStatus()
		case <-connTicker.C:
			h.checkAndBroadcastConnections()
		case <-logTicker.C:
			h.checkAndBroadcastLogs()
		}
	}
}

// ── 变更检测 & 广播 ──

func (h *SSEHub) checkAndBroadcastStatus() {
	status := GetStatus()
	data, _ := json.Marshal(status)
	hash := fmt.Sprintf("%x", sha256.Sum256(data))
	if h.lastHash["status"] == hash {
		return
	}
	h.lastHash["status"] = hash
	h.broadcast("status", string(data))
}

// forceBroadcastStatus 跳过 hash 变更检测，立即广播当前状态
func (h *SSEHub) forceBroadcastStatus() {
	status := GetStatus()
	data, _ := json.Marshal(status)
	h.lastHash["status"] = fmt.Sprintf("%x", sha256.Sum256(data))
	h.broadcast("status", string(data))
}

func (h *SSEHub) checkAndBroadcastConnections() {
	conns := GetConnections()
	data, _ := json.Marshal(map[string]interface{}{
		"connections": conns,
		"count":       len(conns),
	})
	hash := fmt.Sprintf("%x", sha256.Sum256(data))
	if h.lastHash["connections"] == hash {
		return
	}
	h.lastHash["connections"] = hash
	h.broadcast("connections", string(data))
}

func (h *SSEHub) checkAndBroadcastLogs() {
	// 只推送新增的日志行
	content, _, err := GetLogs(0) // 读取全部
	if err != nil {
		return
	}
	// 按已发送字节数截取增量
	if len(content) <= int(h.lastLogSz) {
		return
	}
	delta := content[h.lastLogSz:]
	h.lastLogSz = int64(len(content))
	if delta == "" {
		return
	}
	data, _ := json.Marshal(map[string]interface{}{
		"content": delta,
	})
	h.broadcast("logs", string(data))
}

// ── 广播到所有订阅客户端 ──

func (h *SSEHub) broadcast(eventType string, data string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	evt := SSEEvent{Type: eventType, Data: data}
	for c := range h.clients {
		if c.types[eventType] {
			select {
			case c.Ch <- evt:
			default:
				// channel 满了，跳过此次推送
			}
		}
	}
}
