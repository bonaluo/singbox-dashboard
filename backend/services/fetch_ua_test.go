package services

import (
	"singbox-dashboard/config"
	"testing"
)

func TestFetchUASetting(t *testing.T) {
	config.SetDataDirForTest(t.TempDir()) // 隔离数据目录，避免污染真实数据

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

func TestFetchProxySetting(t *testing.T) {
	config.SetDataDirForTest(t.TempDir())
	t.Setenv("FETCH_PROXY", "") // 隔离宿主机环境变量（config.FetchProxy 初始化后不更新，此处仅确保测试确定性）

	// 未设置时为空（走容器内 sing-box 内置代理）
	if got := LoadFetchProxy(); got != "" {
		t.Errorf("默认外部代理 = %q, 期望空", got)
	}

	// 保存后生效
	if err := SaveFetchProxy("http://10.0.0.1:7890"); err != nil {
		t.Fatal(err)
	}
	if got := LoadFetchProxy(); got != "http://10.0.0.1:7890" {
		t.Errorf("保存后外部代理 = %q", got)
	}

	// 清空恢复
	if err := SaveFetchProxy(""); err != nil {
		t.Fatal(err)
	}
	if got := LoadFetchProxy(); got != "" {
		t.Errorf("清空后外部代理 = %q, 期望空", got)
	}

	// 未保存时回退到进程启动时的配置值（config.FetchProxy 在启动时读一次 FETCH_PROXY，
	// 测试内 Setenv 不影响已初始化的包级变量，故此处验证回退值与配置一致即可）
	if got := LoadFetchProxy(); got != config.FetchProxy {
		t.Errorf("未保存时回退 = %q, 期望配置值 %q", got, config.FetchProxy)
	}
}
