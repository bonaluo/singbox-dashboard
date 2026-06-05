package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"singbox-dashboard/models"
	"singbox-dashboard/services"
	"strings"
)

// ═══════════════════════════════════════════════════════════
//  HTTP Handler 注册（Go 1.22 ServeMux 模式匹配）
// ═══════════════════════════════════════════════════════════

func Register(mux *http.ServeMux) {
	// ── 状态 ──
	mux.HandleFunc("GET /api/status", handleStatus)

	// ── 节点 ──
	mux.HandleFunc("GET /api/proxies", handleGetProxies)
	mux.HandleFunc("POST /api/proxies/switch", handleSwitchProxy)

	// ── 订阅 ──
	mux.HandleFunc("GET /api/subscriptions", handleListSubscriptions)
	mux.HandleFunc("POST /api/subscriptions", handleAddSubscription)
	mux.HandleFunc("DELETE /api/subscriptions/{id}", handleDeleteSubscription)
	mux.HandleFunc("POST /api/subscriptions/{id}/fetch", handleFetchSubscription)
	mux.HandleFunc("POST /api/subscriptions/{id}/apply", handleApplySubscription)
	mux.HandleFunc("GET /api/subscriptions/{id}/data", handleGetSubscriptionData)
	mux.HandleFunc("POST /api/subscriptions/merge", handleMergeSubscriptions)

	// ── 规则 ──
	mux.HandleFunc("GET /api/rules", handleListRules)
	mux.HandleFunc("POST /api/rules", handleAddRule)
	mux.HandleFunc("PUT /api/rules/{id}", handleUpdateRule)
	mux.HandleFunc("DELETE /api/rules/{id}", handleDeleteRule)
	mux.HandleFunc("POST /api/rules/apply", handleApplyRules)
	mux.HandleFunc("GET /api/rules/options", handleRuleOptions)

	// ── 出站组 ──
	mux.HandleFunc("GET /api/groups", handleListGroups)
	mux.HandleFunc("POST /api/groups", handleCreateGroup)
	mux.HandleFunc("DELETE /api/groups/{name}", handleDeleteGroup)
	mux.HandleFunc("GET /api/groups/members", handleGroupMembers)

	// ── 配置 ──
	mux.HandleFunc("GET /api/config", handleGetConfig)

	// ── SSE 事件推送 ──
	mux.HandleFunc("GET /api/events", handleSSE)

	// ── 日志 ──
	mux.HandleFunc("GET /api/logs", handleGetLogs)

	// ── 连接 ──
	mux.HandleFunc("GET /api/connections", handleConnections)

	log.Println("[handlers] routes registered")
}

// ═════════ helpers ═════════

func corsHeaders(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}

func sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	corsHeaders(w)
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func sendOK(w http.ResponseWriter, data interface{}) {
	sendJSON(w, 200, models.APIResponse{OK: true, Data: data})
}

func sendError(w http.ResponseWriter, code int, msg string) {
	sendJSON(w, code, models.APIResponse{OK: false, Error: msg})
}

func readBody(r *http.Request) map[string]interface{} {
	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return make(map[string]interface{})
	}
	return body
}

// ═════════ handlers ═════════

func handleStatus(w http.ResponseWriter, r *http.Request) {
	status := services.GetStatus()
	sendOK(w, status)
}

func handleGetProxies(w http.ResponseWriter, r *http.Request) {
	proxies := services.GetProxies()
	sendOK(w, map[string]interface{}{
		"proxies": proxies,
		"count":   len(proxies),
	})
}

func handleSwitchProxy(w http.ResponseWriter, r *http.Request) {
	body := readBody(r)
	tag, _ := body["tag"].(string)
	if tag == "" {
		sendError(w, 400, "tag is required")
		return
	}
	if err := services.SwitchProxy(tag); err != nil {
		sendError(w, 500, "切换失败: "+err.Error())
		return
	}
	sendOK(w, map[string]string{"switched": tag})
}

func handleListSubscriptions(w http.ResponseWriter, r *http.Request) {
	store, err := services.LoadSubscriptions()
	if err != nil {
		sendError(w, 500, err.Error())
		return
	}
	sendOK(w, store)
}

func handleAddSubscription(w http.ResponseWriter, r *http.Request) {
	body := readBody(r)
	name, _ := body["name"].(string)
	url, _ := body["url"].(string)
	if name == "" || url == "" {
		sendError(w, 400, "name and url required")
		return
	}
	// 先尝试拉取验证
	raw, err := services.FetchRaw(url)
	if err != nil {
		sendError(w, 400, "订阅地址不可达: "+err.Error())
		return
	}
	// 解析验证
	result := services.ParseRaw(raw)
	if result.NodeCount == 0 {
		sendError(w, 400, "未解析到有效节点")
		return
	}
	// 保存订阅
	sub, err := services.AddSubscription(name, url)
	if err != nil {
		sendError(w, 500, err.Error())
		return
	}
	// 保存缓存数据
	services.SaveFetchResult(sub.ID, result)
	sendOK(w, map[string]interface{}{
		"subscription": sub,
		"result":       result,
	})
}

func handleDeleteSubscription(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := services.DeleteSubscription(id); err != nil {
		sendError(w, 404, err.Error())
		return
	}
	sendOK(w, map[string]string{"deleted": id})
}

func handleFetchSubscription(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	// 检查是否是聚合订阅
	store, err := services.LoadSubscriptions()
	if err == nil {
		for _, s := range store.Subscriptions {
			if s.ID == id && s.Kind == models.KindAggregated {
				nodes, sources, err := services.UpdateAggregatedSubscription(id)
				if err != nil {
					sendError(w, 500, "更新聚合订阅失败: "+err.Error())
					return
				}
				sendOK(w, map[string]interface{}{
					"node_count": len(nodes),
					"nodes":      nodes,
					"sources":    sources,
				})
				return
			}
		}
	}

	// 普通订阅
	result, err := services.FetchAndParseSubscription(id)
	if err != nil {
		sendError(w, 500, err.Error())
		return
	}
	sendOK(w, result)
}

func handleApplySubscription(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := services.ApplySubscription(id); err != nil {
		sendError(w, 500, err.Error())
		return
	}
	_ = services.RestartService()
	sendOK(w, map[string]string{"msg": "订阅已应用，服务已重启"})
}

func handleGetSubscriptionData(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	data, err := services.GetCachedSubscriptionData(id)
	if err != nil {
		sendError(w, 404, err.Error())
		return
	}
	sendOK(w, data)
}

func handleMergeSubscriptions(w http.ResponseWriter, r *http.Request) {
	var req models.MergeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, 400, "invalid JSON")
		return
	}
	if req.Name == "" {
		sendError(w, 400, "name is required")
		return
	}
	if len(req.Sources) == 0 && len(req.ExtraURLs) == 0 {
		sendError(w, 400, "至少选择一个订阅或填写订阅链接")
		return
	}

	sub, nodes, sources, err := services.CreateMergedSubscription(req.Name, req.Sources, req.ExtraURLs)
	if err != nil {
		sendError(w, 500, "创建聚合订阅失败: "+err.Error())
		return
	}
	sendOK(w, map[string]interface{}{
		"subscription": sub,
		"nodes":        nodes,
		"sources":      sources,
	})
}

func handleListRules(w http.ResponseWriter, r *http.Request) {
	store, err := services.LoadRules()
	if err != nil {
		sendError(w, 500, err.Error())
		return
	}
	sendOK(w, store)
}

func handleAddRule(w http.ResponseWriter, r *http.Request) {
	var rule models.Rule
	if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
		sendError(w, 400, "invalid JSON")
		return
	}
	result, err := services.AddRule(&rule)
	if err != nil {
		sendError(w, 500, err.Error())
		return
	}
	sendOK(w, result)
}

func handleUpdateRule(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var rule models.Rule
	if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
		sendError(w, 400, "invalid JSON")
		return
	}
	rule.ID = id
	if err := services.UpdateRule(&rule); err != nil {
		sendError(w, 500, err.Error())
		return
	}
	sendOK(w, map[string]string{"updated": id})
}

func handleDeleteRule(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := services.DeleteRule(id); err != nil {
		sendError(w, 500, err.Error())
		return
	}
	sendOK(w, map[string]string{"deleted": id})
}

func handleApplyRules(w http.ResponseWriter, r *http.Request) {
	if err := services.ApplyRules(); err != nil {
		sendError(w, 500, "规则应用失败: "+err.Error())
		return
	}
	// 重启服务使规则生效
	_ = services.RestartService()
	sendOK(w, map[string]string{"msg": "规则已应用并重启服务"})
}

func handleRuleOptions(w http.ResponseWriter, r *http.Request) {
	options := services.GetEnrichedOutbounds()
	types := []string{"domain", "domain-suffix", "domain-keyword", "ip-cidr", "geosite", "geoip", "process-name"}
	sendOK(w, map[string]interface{}{
		"rule_types": types,
		"outbounds":  options,
	})
}

func handleSSE(w http.ResponseWriter, r *http.Request) {
	// 解析订阅类型
	typesStr := r.URL.Query().Get("types")
	if typesStr == "" {
		typesStr = "status"
	}
	types := strings.Split(typesStr, ",")

	client := services.SubscribeSSE(types)
	if client == nil {
		sendError(w, 500, "SSE hub not initialized")
		return
	}
	defer services.UnsubscribeSSE(client)

	// SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(200)

	flusher, ok := w.(http.Flusher)
	if !ok {
		return
	}

	// 发送初始连接确认
	fmt.Fprintf(w, "event: connected\ndata: {}\n\n")
	flusher.Flush()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case evt, ok := <-client.Ch:
			if !ok {
				return
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", evt.Type, evt.Data)
			flusher.Flush()
		}
	}
}

func handleGetLogs(w http.ResponseWriter, r *http.Request) {
	lines := 500
	if n, err := fmt.Sscanf(r.URL.Query().Get("tail"), "%d", &lines); n != 1 || err != nil {
		lines = 500
	}
	content, logPath, err := services.GetLogs(lines)
	if err != nil {
		sendError(w, 500, "读取日志失败: "+err.Error())
		return
	}
	sendOK(w, map[string]interface{}{
		"content": content,
		"path":    logPath,
		"tail":    lines,
	})
}

func handleGetConfig(w http.ResponseWriter, r *http.Request) {
	raw, err := services.GetRawConfig()
	if err != nil {
		sendError(w, 500, "读取配置失败: "+err.Error())
		return
	}
	sendJSON(w, 200, models.APIResponse{OK: true, Data: raw})
}

func handleConnections(w http.ResponseWriter, r *http.Request) {
	conns := services.GetConnections()
	sendOK(w, map[string]interface{}{
		"connections": conns,
		"count":       len(conns),
	})
}

// ── 出站组 handlers ──

func handleListGroups(w http.ResponseWriter, r *http.Request) {
	groups := services.ListGroups()
	sendOK(w, map[string]interface{}{
		"groups": groups,
		"count":  len(groups),
	})
}

func handleCreateGroup(w http.ResponseWriter, r *http.Request) {
	var req models.GroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, 400, "invalid JSON")
		return
	}
	if req.Name == "" {
		sendError(w, 400, "name is required")
		return
	}
	if len(req.Nodes) == 0 {
		sendError(w, 400, "至少选择一个节点")
		return
	}
	if err := services.CreateGroup(req.Name, req.Nodes); err != nil {
		sendError(w, 500, "创建组失败: "+err.Error())
		return
	}
	sendOK(w, map[string]string{"created": req.Name})
}

func handleDeleteGroup(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if err := services.DeleteGroup(name); err != nil {
		sendError(w, 500, err.Error())
		return
	}
	sendOK(w, map[string]string{"deleted": name})
}

func handleGroupMembers(w http.ResponseWriter, r *http.Request) {
	proxies, groups := services.GetGroupMembers()
	sendOK(w, map[string]interface{}{
		"proxies": proxies,
		"groups":  groups,
	})
}
