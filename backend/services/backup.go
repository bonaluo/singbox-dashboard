package services

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"singbox-dashboard/config"
	"strings"
	"time"
)

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
		Version:       "1.0",
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

	if b.Version == "" {
		return "", fmt.Errorf("无效的备份文件：缺少 version 字段")
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
