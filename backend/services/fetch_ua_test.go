package services

import (
	"singbox-dashboard/config"
	"testing"
)

func TestFetchUASetting(t *testing.T) {
	t.Setenv("DASHBOARD_DATA_DIR", t.TempDir()) // 隔离数据目录，避免污染真实数据

	// 未设置时回退到默认值
	if got := LoadFetchUA(); got != config.FetchUserAgent {
		t.Errorf("默认 UA = %q, 期望 %q", got, config.FetchUserAgent)
	}

	// 保存后生效
	if err := SaveFetchUA("custom/1.0 (test)"); err != nil {
		t.Fatal(err)
	}
	if got := LoadFetchUA(); got != "custom/1.0 (test)" {
		t.Errorf("保存后 UA = %q, 期望 custom/1.0 (test)", got)
	}

	// 清空恢复默认
	if err := SaveFetchUA(""); err != nil {
		t.Fatal(err)
	}
	if got := LoadFetchUA(); got != config.FetchUserAgent {
		t.Errorf("清空后 UA = %q, 期望回退默认 %q", got, config.FetchUserAgent)
	}
}
