package services

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"singbox-dashboard/config"
	"strconv"
	"strings"
	"time"
)

// BackupDataVersion 数据格式版本号（与应用版本/构建号分离）。
// 规则：
//   - 无版本号（空）= 最早期格式（v1），导入时按 v1 兼容处理
//   - 仅在数据结构变更（新增/改名/删除字段）时递增版本号；
//     应用每次构建版本变化但结构不变时，升级零迁移
//   - 跨多版本升级逐步执行迁移链（v1→v2→v3...），每步只做该版本需要的转换
const BackupDataVersion = "2.0"

// backupMigration 单步数据迁移：from 版本 → to 版本
type backupMigration struct {
	from string
	to   string
	desc string
	fn   func(b *BackupData) error
}

// backupMigrations 迁移链（按版本顺序注册）。ImportBackup 时从备份版本
// 逐步执行到当前版本，保证跨多个版本升级的兼容性。
var backupMigrations = []backupMigration{
	// v1（无版本号时代）→ v2：订阅新增流量字段（upload/download/total/expire）。
	// 旧数据缺失这些字段时读取缺省为 0（JSON 解析自动处理），无需实际转换，
	// 仅推进版本标记，保证后续版本有明确的迁移起点。
	{from: "1.0", to: "2.0", desc: "订阅流量字段（旧数据缺省为 0）",
		fn: func(b *BackupData) error { return nil }},
}

// findMigration 查找从指定版本出发的迁移步骤；无步骤返回 nil
func findMigration(from string) *backupMigration {
	for i := range backupMigrations {
		if backupMigrations[i].from == from {
			return &backupMigrations[i]
		}
	}
	return nil
}

// compareVersions 比较点分版本号（如 "2.0"、"10.1"），返回 a>b:1 / a==b:0 / a<b:-1
func compareVersions(a, b string) int {
	as := strings.Split(a, ".")
	bs := strings.Split(b, ".")
	for i := 0; i < len(as) || i < len(bs); i++ {
		var ai, bi int
		if i < len(as) {
			ai, _ = strconv.Atoi(as[i])
		}
		if i < len(bs) {
			bi, _ = strconv.Atoi(bs[i])
		}
		if ai != bi {
			if ai > bi {
				return 1
			}
			return -1
		}
	}
	return 0
}

// BackupData 备份数据结构，包含所有 dashboard 管理的配置
type BackupData struct {
	Version        string             `json:"version"`
	ExportedAt     string             `json:"exported_at"`
	SingBoxConfig  json.RawMessage    `json:"singbox_config,omitempty"`
	Subscriptions  json.RawMessage    `json:"subscriptions,omitempty"`
	Rules          json.RawMessage    `json:"rules,omitempty"`
	GroupRules     json.RawMessage    `json:"group_rules,omitempty"`
	GeoUpdateCfg   json.RawMessage    `json:"geo_update_config,omitempty"`
	AppliedSubID   string             `json:"applied_sub_id,omitempty"`
	SubDataFiles   map[string]json.RawMessage `json:"sub_data_files,omitempty"`
}

// ExportBackup 收集所有配置数据，打包为 JSON 备份
func ExportBackup() (*BackupData, error) {
	b := &BackupData{
		Version:       BackupDataVersion, // 导出必须携带当前数据格式版本号
		ExportedAt:    time.Now().Format(time.RFC3339),
		SubDataFiles:  make(map[string]json.RawMessage),
	}

	// sing-box 配置
	if data, err := os.ReadFile(config.SingBoxConfig); err == nil {
		b.SingBoxConfig = json.RawMessage(data)
	}

	// 订阅列表
	if data, err := os.ReadFile(config.SubscriptionsPath()); err == nil {
		b.Subscriptions = json.RawMessage(data)
	}

	// 规则
	if data, err := os.ReadFile(config.RulesPath()); err == nil {
		b.Rules = json.RawMessage(data)
	}

	// 分组规则
	grPath := filepath.Join(config.DataDir, "group-rules.json")
	if data, err := os.ReadFile(grPath); err == nil {
		b.GroupRules = json.RawMessage(data)
	}

	// Geo 更新配置
	geoPath := filepath.Join(config.DataDir, "geo-update-config.json")
	if data, err := os.ReadFile(geoPath); err == nil {
		b.GeoUpdateCfg = json.RawMessage(data)
	}

	// 已应用订阅 ID
	if data, err := os.ReadFile(filepath.Join(config.DataDir, "applied_sub_id")); err == nil {
		b.AppliedSubID = strings.TrimSpace(string(data))
	}

	// 订阅缓存数据
	subDataDir := filepath.Join(config.DataDir, "subscription_data")
	if entries, err := os.ReadDir(subDataDir); err == nil {
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			if data, err := os.ReadFile(filepath.Join(subDataDir, e.Name())); err == nil {
				b.SubDataFiles[e.Name()] = json.RawMessage(data)
			}
		}
	}

	return b, nil
}

// ImportBackup 从备份 JSON 恢复所有配置数据
// 返回恢复的文件列表摘要
func ImportBackup(data []byte) (string, error) {
	var b BackupData
	if err := json.Unmarshal(data, &b); err != nil {
		return "", fmt.Errorf("备份文件格式无效: %w", err)
	}

	// 版本兼容：无版本号 = 最早期格式（v1）；
	// 更高版本（未来导出）无法回滚导入，直接拒绝
	if b.Version == "" {
		log.Printf("⚠️ [ImportBackup] 旧版备份（无版本号），视为 v1 兼容导入")
		b.Version = "1.0"
	}
	if compareVersions(b.Version, BackupDataVersion) > 0 {
		return "", fmt.Errorf("备份版本 %s 高于当前支持版本 %s，请先升级程序", b.Version, BackupDataVersion)
	}
	// 逐步执行迁移链：v3 备份升到 v5 时，先执行 v3→v4 再 v4→v5，
	// 每步迁移独立可测试，避免跨版本一次性转换出错
	for compareVersions(b.Version, BackupDataVersion) < 0 {
		step := findMigration(b.Version)
		if step == nil {
			return "", fmt.Errorf("备份版本 %s 缺少到 %s 的迁移路径，请先升级到中间版本后再导入",
				b.Version, BackupDataVersion)
		}
		if err := step.fn(&b); err != nil {
			return "", fmt.Errorf("数据迁移 %s→%s 失败: %w", step.from, step.to, err)
		}
		log.Printf("[ImportBackup] 数据迁移 %s → %s（%s）", step.from, step.to, step.desc)
		b.Version = step.to
	}

	var restored []string

	// 恢复 sing-box 配置
	if len(b.SingBoxConfig) > 0 {
		// 先备份当前配置
		backup := config.SingBoxConfig + ".pre-restore.bak"
		_ = copyFile(config.SingBoxConfig, backup)

		if err := os.WriteFile(config.SingBoxConfig, append(b.SingBoxConfig, '\n'), 0644); err != nil {
			return "", fmt.Errorf("写入 sing-box 配置失败: %w", err)
		}
		restored = append(restored, "sing-box 配置")
	}

	// 恢复订阅列表
	if len(b.Subscriptions) > 0 {
		if err := os.WriteFile(config.SubscriptionsPath(), append(b.Subscriptions, '\n'), 0644); err != nil {
			return "", fmt.Errorf("写入订阅列表失败: %w", err)
		}
		restored = append(restored, "订阅列表")
	}

	// 恢复规则
	if len(b.Rules) > 0 {
		if err := os.WriteFile(config.RulesPath(), append(b.Rules, '\n'), 0644); err != nil {
			return "", fmt.Errorf("写入规则失败: %w", err)
		}
		restored = append(restored, "路由规则")
	}

	// 恢复分组规则
	if len(b.GroupRules) > 0 {
		grPath := filepath.Join(config.DataDir, "group-rules.json")
		if err := os.WriteFile(grPath, append(b.GroupRules, '\n'), 0644); err != nil {
			return "", fmt.Errorf("写入分组规则失败: %w", err)
		}
		restored = append(restored, "分组规则")
	}

	// 恢复 Geo 更新配置
	if len(b.GeoUpdateCfg) > 0 {
		geoPath := filepath.Join(config.DataDir, "geo-update-config.json")
		if err := os.WriteFile(geoPath, append(b.GeoUpdateCfg, '\n'), 0644); err != nil {
			return "", fmt.Errorf("写入 Geo 更新配置失败: %w", err)
		}
		restored = append(restored, "Geo 更新设置")
	}

	// 恢复已应用订阅 ID
	if b.AppliedSubID != "" {
		aidPath := filepath.Join(config.DataDir, "applied_sub_id")
		if err := os.WriteFile(aidPath, []byte(b.AppliedSubID+"\n"), 0644); err != nil {
			return "", fmt.Errorf("写入已应用订阅 ID 失败: %w", err)
		}
		restored = append(restored, "已应用订阅标记")
	}

	// 恢复订阅缓存数据
	if len(b.SubDataFiles) > 0 {
		subDataDir := filepath.Join(config.DataDir, "subscription_data")
		os.MkdirAll(subDataDir, 0755)
		for name, content := range b.SubDataFiles {
			// 安全检查：防止路径穿越
			if strings.Contains(name, "/") || strings.Contains(name, "..") {
				continue
			}
			path := filepath.Join(subDataDir, name)
			if err := os.WriteFile(path, append(content, '\n'), 0644); err != nil {
				continue // 跳过无法写入的缓存文件
			}
		}
		restored = append(restored, "订阅缓存数据")
	}

	if len(restored) == 0 {
		return "", fmt.Errorf("备份文件中没有可恢复的数据")
	}

	// 恢复 sing-box 配置和规则后，重新 ApplyRules() 让其自动生成缺失的 .srs 占位文件
	// 避免新环境导入备份后缺少 .srs 文件导致 sing-box 启动失败（死循环）
	if len(b.SingBoxConfig) > 0 && len(b.Rules) > 0 {
		if err := ApplyRules(); err != nil {
			log.Printf("⚠️ [ImportBackup] ApplyRules 失败: %v", err)
		}
	}

	// 恢复后重启 sing-box 使配置生效
	if len(b.SingBoxConfig) > 0 {
		go RestartService()
		// 异步下载真实规则集覆盖占位文件
		// StartGeoUpdateLoop启动时配置为空会错过下载时机，这里主动触发一次
		// 走后台 goroutine，不阻塞 import 返回
		go func() {
			time.Sleep(3 * time.Second) // 等待 sing-box 启动并就绪（走 2080 代理需要）
			log.Println("[ImportBackup] 开始下载真实规则集覆盖占位文件...")
			if err := DownloadGeoRuleSets(); err != nil {
				log.Printf("⚠️ [ImportBackup] DownloadGeoRuleSets 失败: %v", err)
			}
		}()
	}

	return strings.Join(restored, "、"), nil
}
