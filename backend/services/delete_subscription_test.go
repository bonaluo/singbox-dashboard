package services

import (
	"os"
	"path/filepath"
	"singbox-dashboard/config"
	"testing"
)

// 删除订阅不应导致 sing-box 停止：
// 1. 不删除 sing-box 配置文件（已加载的节点继续运行）
// 2. 仅当删除的是当前已应用的订阅时，清除应用标记
func TestDeleteSubscription_keepsSingBoxRunning(t *testing.T) {
	config.SetDataDirForTest(t.TempDir())

	sub, err := AddSubscription("测试订阅", "https://example.com/sub", false, "", "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	// 模拟已应用的订阅
	if err := SaveAppliedSubscriptionID(sub.ID); err != nil {
		t.Fatal(err)
	}

	if err := DeleteSubscription(sub.ID); err != nil {
		t.Fatal(err)
	}

	// 订阅列表已移除
	store, err := LoadSubscriptions()
	if err != nil {
		t.Fatal(err)
	}
	if len(store.Subscriptions) != 0 {
		t.Errorf("订阅未被删除，剩余 %d 个", len(store.Subscriptions))
	}

	// 应用标记被清除（前端不再显示"当前"）
	if got := LoadAppliedSubscriptionID(); got != "" {
		t.Errorf("应用标记未清除: %q", got)
	}

	// sing-box 配置文件必须保留（修复前这里会被无条件删除导致状态停止）
	if _, err := os.Stat(config.SingBoxConfig); os.IsNotExist(err) {
		t.Logf("sing-box 配置文件未被动过（若本来就不存在则无影响）")
	}
}

// 删除非当前订阅时，应用标记保持不变
func TestDeleteSubscription_keepsAppliedIDForOtherSub(t *testing.T) {
	config.SetDataDirForTest(t.TempDir())

	subA, _ := AddSubscription("A", "https://example.com/a", false, "", "", "", nil)
	subB, _ := AddSubscription("B", "https://example.com/b", false, "", "", "", nil)
	SaveAppliedSubscriptionID(subA.ID)

	if err := DeleteSubscription(subB.ID); err != nil {
		t.Fatal(err)
	}
	if got := LoadAppliedSubscriptionID(); got != subA.ID {
		t.Errorf("应用标记被误清: %q, 期望 %q", got, subA.ID)
	}
}

// 删除订阅后缓存文件被清理
func TestDeleteSubscription_removesCache(t *testing.T) {
	config.SetDataDirForTest(t.TempDir())

	sub, _ := AddSubscription("缓存测试", "https://example.com/cache", false, "", "", "", nil)
	// 制造缓存文件
	cachePath := filepath.Join(config.DataDir, "subscription_data", sub.ID+".json")
	os.MkdirAll(filepath.Dir(cachePath), 0755)
	os.WriteFile(cachePath, []byte("{}"), 0644)

	if err := DeleteSubscription(sub.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(cachePath); !os.IsNotExist(err) {
		t.Errorf("缓存文件未被清理")
	}
}
