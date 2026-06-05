package services

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"singbox-dashboard/config"
	"singbox-dashboard/models"
	"strings"
	"sync"
	"time"
)

// ═══════════════════════════════════════════════════════════
//  sing-box 核心服务：读/写配置、服务管理、Clash API
// ═══════════════════════════════════════════════════════════

var mu sync.RWMutex
var singBoxCmd *exec.Cmd

// timestampWriter 给每行写入添加时间戳前缀，解决 sing-box 日志无实际时间的问题
type timestampWriter struct {
	w   io.Writer
	buf []byte // 缓存未完整的行
}

func (tw *timestampWriter) Write(p []byte) (int, error) {
	tw.buf = append(tw.buf, p...)
	total := len(p)

	// 查找完整行并写出（带时间戳前缀）
	for {
		idx := indexByte(tw.buf, '\n')
		if idx < 0 {
			break
		}
		line := tw.buf[:idx+1]
		tw.buf = tw.buf[idx+1:]

		// 跳过空行
		if len(strings.TrimSpace(string(line))) == 0 {
			continue
		}

		// 写入时间戳 + 行内容
		ts := time.Now().Format("2006-01-02 15:04:05 ")
		tw.w.Write([]byte(ts))
		tw.w.Write(line)
	}
	return total, nil
}

func indexByte(s []byte, c byte) int {
	for i := range s {
		if s[i] == c {
			return i
		}
	}
	return -1
}

// ── 启动 sing-box 进程 ──

func StartSingBox() error {
	// 打开日志文件（追加模式）
	logPath := config.LogPath()
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return fmt.Errorf("无法打开日志文件 %s: %w", logPath, err)
	}

	// 时间戳 writer：写入文件时自动添加时间戳
	tsLogFile := &timestampWriter{w: logFile}
	// 终端输出也加时间戳
	tsStdout := &timestampWriter{w: os.Stdout}
	tsStderr := &timestampWriter{w: os.Stderr}

	singBoxCmd = exec.Command(config.SingBoxBin, "run", "-c", config.SingBoxConfig)
	singBoxCmd.Stdout = io.MultiWriter(tsStdout, tsLogFile)
	singBoxCmd.Stderr = io.MultiWriter(tsStderr, tsLogFile)
	return singBoxCmd.Start()
}

// ── 服务状态 ──

func GetStatus() models.StatusResponse {
	// 配置文件不存在时快速返回
	if _, err := os.Stat(config.SingBoxConfig); os.IsNotExist(err) {
		return models.StatusResponse{Running: false}
	}
	cfg, _ := loadSingBoxConfig()
	current := getClashCurrent()
	running := isRunning()
	uptime := ""
	if running {
		uptime = getUptime()
	}
	total := 0
	if cfg != nil {
		for _, ob := range cfg["outbounds"].([]interface{}) {
			m := ob.(map[string]interface{})
			t := m["type"].(string)
			if t != "selector" && t != "direct" && t != "block" && t != "dns" && t != "urltest" {
				total++
			}
		}
	}
	return models.StatusResponse{
		Running:    running,
		Current:    current,
		Uptime:     uptime,
		TotalNodes: total,
		GitCommit:  config.GitCommit,
	}
}

// ── 获取所有代理节点 ──

func GetProxies() []models.ProxyNode {
	cfg, err := loadSingBoxConfig()
	if err != nil {
		return nil
	}
	var nodes []models.ProxyNode
	for _, ob := range cfg["outbounds"].([]interface{}) {
		m := ob.(map[string]interface{})
		t, _ := m["type"].(string)
		if t == "selector" || t == "direct" || t == "block" || t == "urltest" {
			continue
		}
		tag, _ := m["tag"].(string)
		if isMetaLine(tag) {
			continue
		}
		server, _ := m["server"].(string)
		port := 0
		if p, ok := m["server_port"].(float64); ok {
			port = int(p)
		}
		nodes = append(nodes, models.ProxyNode{
			Tag:    tag,
			Type:   t,
			Server: server,
			Port:   port,
			Region: detectRegion(tag),
		})
	}
	return nodes
}

// ── 获取可选作组成员的节点和已有组 ──

// GetGroupMembers 返回单个节点（按地区分组）和已有组
func GetGroupMembers() ([]models.GroupMember, []models.GroupMember) {
	cfg, err := loadSingBoxConfig()
	if err != nil {
		return nil, nil
	}
	var proxyMembers []models.GroupMember
	var groupMembers []models.GroupMember

	for _, ob := range cfg["outbounds"].([]interface{}) {
		m := ob.(map[string]interface{})
		t, _ := m["type"].(string)
		tag, _ := m["tag"].(string)
		if tag == "" {
			continue
		}

		// 过滤无用行
		if isMetaLine(tag) {
			continue
		}

		if t == "selector" || t == "urltest" {
			nodes, _ := m["outbounds"].([]interface{})
			groupMembers = append(groupMembers, models.GroupMember{
				Tag:         tag,
				Type:        t,
				IsGroup:     true,
				MemberCount: len(nodes),
			})
			continue
		}
		if t == "direct" || t == "block" || t == "dns" {
			continue
		}

		// 单个代理节点
		proxyMembers = append(proxyMembers, models.GroupMember{
			Tag:    tag,
			Type:   t,
			Region: detectRegion(tag),
		})
	}
	return proxyMembers, groupMembers
}

// isMetaLine 判断是否是无用信息行（非真实节点）
func isMetaLine(tag string) bool {
	metaKeywords := []string{"剩余流量", "距离下次重置", "套餐到期", "过滤掉"}
	for _, kw := range metaKeywords {
		if strings.Contains(tag, kw) {
			return true
		}
	}
	return false
}

// ── 获取全部出站（含组和节点）──

// GetAllOutbounds 从 sing-box 配置读取全部出站（不过滤类型），返回 tag+type
func GetAllOutbounds() []models.OutboundOption {
	cfg, err := loadSingBoxConfig()
	if err != nil {
		return nil
	}
	var outbounds []models.OutboundOption
	for _, ob := range cfg["outbounds"].([]interface{}) {
		m := ob.(map[string]interface{})
		tag, _ := m["tag"].(string)
		t, _ := m["type"].(string)
		if tag == "" || isMetaLine(tag) {
			continue
		}
		outbounds = append(outbounds, models.OutboundOption{
			Tag:  tag,
			Type: t,
		})
	}
	return outbounds
}

// GetGroupNow 通过 Clash API 获取 selector/urltest 组当前选中的节点
func GetGroupNow(tag string) string {
	cmd := exec.Command("curl", "-s", "--noproxy", "*", "--max-time", "5",
		config.ClashAPI+"/proxies/"+tag)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	var result struct {
		Now string `json:"now"`
	}
	json.Unmarshal(out, &result)
	return result.Now
}

// GetGroupDelays 通过 Clash API 获取 urltest 组中每个节点的最新延迟
func GetGroupDelays(tag string) map[string]int {
	cmd := exec.Command("curl", "-s", "--noproxy", "*", "--max-time", "5",
		config.ClashAPI+"/proxies/"+tag)
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	var result struct {
		All []json.RawMessage `json:"all"`
	}
	if err := json.Unmarshal(out, &result); err != nil {
		return nil
	}
	delays := make(map[string]int)
	for _, item := range result.All {
		// "all" 数组元素可能是纯字符串（Selector）或对象（URLTest，含 history）
		var nameOnly string
		if json.Unmarshal(item, &nameOnly) == nil {
			continue
		}
		var nodeObj struct {
			Name    string `json:"name"`
			History []struct {
				Delay int `json:"delay"`
			} `json:"history"`
		}
		if json.Unmarshal(item, &nodeObj) != nil {
			continue
		}
		if len(nodeObj.History) > 0 {
			delays[nodeObj.Name] = nodeObj.History[len(nodeObj.History)-1].Delay
		}
	}
	return delays
}

// ── 切换节点 ──

func SwitchProxy(tag string) error {
	body := fmt.Sprintf(`{"name":"%s"}`, tag)
	cmd := exec.Command("curl", "-s", "--noproxy", "*", "-X", "PUT",
		config.ClashAPI+"/proxies/proxy",
		"-H", "Content-Type: application/json",
		"-d", body)
	return cmd.Run()
}

// ── 获取节点延迟 ──

func GetProxyDelay(tag string, timeout int) int {
	cmd := exec.Command("curl", "-s", "--noproxy", "*",
		fmt.Sprintf("%s/proxies/%s/delay?url=https://www.google.com&timeout=%d",
			config.ClashAPI, tag, timeout))
	out, err := cmd.Output()
	if err != nil {
		return -1
	}
	var result struct {
		Delay int `json:"delay"`
	}
	json.Unmarshal(out, &result)
	return result.Delay
}

// ── 出站组管理 ──

func CreateGroup(name, groupType string, nodes []string) error {
	cfg, err := loadSingBoxConfig()
	if err != nil {
		return fmt.Errorf("加载配置失败: %w", err)
	}

	// 检查是否已存在同名出站
	for _, ob := range cfg["outbounds"].([]interface{}) {
		m := ob.(map[string]interface{})
		if tag, _ := m["tag"].(string); tag == name {
			return fmt.Errorf("出站组 '%s' 已存在", name)
		}
	}

	// 默认 selector
	if groupType == "" {
		groupType = "selector"
	}

	// 创建出站组
	group := map[string]interface{}{
		"tag":       name,
		"type":      groupType,
		"outbounds": nodes,
	}

	outbounds, _ := cfg["outbounds"].([]interface{})
	cfg["outbounds"] = append(outbounds, group)

	if err := WriteSingBoxConfig(cfg); err != nil {
		return err
	}
	return RestartService()
}

func DeleteGroup(name string) error {
	cfg, err := loadSingBoxConfig()
	if err != nil {
		return fmt.Errorf("加载配置失败: %w", err)
	}

	outbounds, _ := cfg["outbounds"].([]interface{})
	var filtered []interface{}
	found := false
	for _, ob := range outbounds {
		m := ob.(map[string]interface{})
		t, _ := m["tag"].(string)
		tp, _ := m["type"].(string)
		if t == name && (tp == "selector" || tp == "urltest") {
			found = true
			continue
		}
		filtered = append(filtered, ob)
	}
	if !found {
		return fmt.Errorf("出站组 '%s' 未找到", name)
	}
	cfg["outbounds"] = filtered

	if err := WriteSingBoxConfig(cfg); err != nil {
		return err
	}
	return RestartService()
}

func ListGroups() []models.GroupInfo {
	cfg, err := loadSingBoxConfig()
	if err != nil {
		return nil
	}
	running := isRunning()
	var groups []models.GroupInfo
	for _, ob := range cfg["outbounds"].([]interface{}) {
		m := ob.(map[string]interface{})
		t, _ := m["type"].(string)
		if t != "selector" && t != "urltest" {
			continue
		}
		tag, _ := m["tag"].(string)
		now := ""
		if running {
			now = GetGroupNow(tag)
		}
		nodes, _ := m["outbounds"].([]interface{})
		var nodeTags []string
		for _, n := range nodes {
			if s, ok := n.(string); ok {
				nodeTags = append(nodeTags, s)
			}
		}
		groups = append(groups, models.GroupInfo{
			Name:  tag,
			Type:  t,
			Nodes: nodeTags,
			Now:   now,
		})
	}
	return groups
}

// ── 连接列表 ──

func GetConnections() []map[string]interface{} {
	cmd := exec.Command("curl", "-s", "--noproxy", "*", config.ClashAPI+"/connections")
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	var result struct {
		Connections []map[string]interface{} `json:"connections"`
	}
	json.Unmarshal(out, &result)
	return result.Connections
}

// ── 服务重启 ──

func RestartService() error {
	mu.Lock()
	defer mu.Unlock()
	if singBoxCmd == nil || singBoxCmd.Process == nil {
		return StartSingBox()
	}
	singBoxCmd.Process.Kill()
	singBoxCmd.Wait()
	time.Sleep(1 * time.Second)
	return StartSingBox()
}

// ── 读写 sing-box 配置 ──

func WriteSingBoxConfig(cfg map[string]interface{}) error {
	mu.Lock()
	defer mu.Unlock()
	// 备份
	backup := config.SingBoxConfig + ".bak"
	_ = copyFile(config.SingBoxConfig, backup)
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(config.SingBoxConfig, append(data, '\n'), 0644)
}

// ── Clash API 当前节点 ──

func getClashCurrent() string {
	cmd := exec.Command("curl", "-s", "--noproxy", "*", config.ClashAPI+"/proxies/proxy")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	var result struct {
		Now string `json:"now"`
	}
	json.Unmarshal(out, &result)
	return result.Now
}

// ── 内部辅助 ──

// GetRawConfig 返回原始 sing-box 配置 JSON
func GetRawConfig() (json.RawMessage, error) {
	data, err := os.ReadFile(config.SingBoxConfig)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(data), nil
}

func loadSingBoxConfig() (map[string]interface{}, error) {
	data, err := os.ReadFile(config.SingBoxConfig)
	if err != nil {
		return nil, err
	}
	var cfg map[string]interface{}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func isRunning() bool {
	cmd := exec.Command("curl", "-s", "--noproxy", "*", "--max-time", "2", config.ClashAPI+"/version")
	return cmd.Run() == nil
}

func getUptime() string {
	return ""
}

func detectRegion(tag string) string {
	runes := []rune(tag)
	upper := strings.ToUpper(tag)
	var code string

	// 提取地区码
	// 方式1: 国旗 emoji 开头
	for i := 0; i < len(runes)-1; i++ {
		if runes[i] >= 0x1F1E6 && runes[i] <= 0x1F1FF &&
			runes[i+1] >= 0x1F1E6 && runes[i+1] <= 0x1F1FF {
			code = string([]rune{
				rune(runes[i] - 0x1F1E6 + 'A'),
				rune(runes[i+1] - 0x1F1E6 + 'A'),
			})
			break
		}
	}

	// 方式2: [HK] 方括号开头
	if code == "" && len(runes) >= 4 && runes[0] == '[' {
		for j := 1; j < len(runes) && j <= 6; j++ {
			if runes[j] == ']' {
				s := string(runes[1:j])
				if isCapsCode(s) {
					code = strings.ToUpper(s)
				}
				break
			}
		}
	}

	// 方式3: 纯大写字码开头
	if code == "" {
		parts := strings.Fields(upper)
		if len(parts) > 0 {
			first := strings.Trim(parts[0], "_-[]")
			if isCapsCode(first) {
				code = first
			}
		}
	}

	if code == "" {
		return "其他"
	}

	// 码→中文名
	nameMap := map[string]string{
		"SG": "新加坡", "HK": "香港", "JP": "日本", "KR": "韩国",
		"US": "美国", "USA": "美国", "TW": "台湾", "CN": "台湾",
		"IN": "印度", "AU": "澳大利亚", "UK": "英国",
		"CA": "加拿大", "DE": "德国", "FR": "法国",
		"RU": "俄罗斯", "BR": "巴西", "ID": "印尼", "TH": "泰国",
		"MY": "马来西亚", "PH": "菲律宾", "VN": "越南", "TR": "土耳其",
		"IT": "意大利", "ES": "西班牙", "NL": "荷兰", "SE": "瑞典",
		"CH": "瑞士", "PL": "波兰", "AR": "阿根廷", "MX": "墨西哥",
		"GB": "英国",
	}
	name, ok := nameMap[code]
	if !ok {
		return code
	}

	// 码→国旗 emoji
	flag := codeToFlag(code)
	return flag + " " + name
}

func codeToFlag(code string) string {
	if len(code) < 2 {
		return code
	}
	return string([]rune{
		rune(code[0]-'A') + 0x1F1E6,
		rune(code[1]-'A') + 0x1F1E6,
	})
}

func isCapsCode(s string) bool {
	if len(s) < 2 || len(s) > 3 {
		return false
	}
	for _, r := range s {
		if r < 'A' || r > 'Z' {
			return false
		}
	}
	return true
}

func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0644)
}

// ── 日志读取 ──

// GetLogs 从日志文件读取最后 lines 行（0 或负数则读取全部），同时返回日志文件路径
func GetLogs(lines int) (string, string, error) {
	logPath := config.LogPath()
	f, err := os.Open(logPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", logPath, nil
		}
		return "", logPath, err
	}
	defer f.Close()

	var allLines []string
	scanner := bufio.NewScanner(f)
	// 增大 buffer 以处理长日志行
	scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024)
	for scanner.Scan() {
		allLines = append(allLines, scanner.Text())
	}

	if lines > 0 && len(allLines) > lines {
		allLines = allLines[len(allLines)-lines:]
	}

	return strings.Join(allLines, "\n"), logPath, nil
}
