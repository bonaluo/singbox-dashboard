package main

import (
	"log"
	"net/http"
	"os"
	"singbox-dashboard/config"
	"singbox-dashboard/handlers"
	"singbox-dashboard/services"
	"strings"
)

func main() {
	// 确保数据目录存在
	os.MkdirAll(config.DataDir, 0755)

	// 启动前先 rotate 日志（如果超过 20MB）
	if err := services.RotateLogIfNeeded(); err != nil {
		log.Printf("[main] 日志 rotate 警告: %v", err)
	}

	// 仅当配置文件存在时才启动 sing-box
	if _, err := os.Stat(config.SingBoxConfig); err == nil {
		// 启动前先重建规则，自动生成缺失的 .srs 占位文件并清理无效 rule_set 引用
		// 避免新环境缺少 .srs 文件导致 sing-box 启动失败（死循环）
		if _, err := os.Stat(config.RulesPath()); err == nil {
			if err := services.ApplyRules(); err != nil {
				log.Printf("[main] ApplyRules 失败（继续启动）: %v", err)
			}
		}
		log.Println("启动 sing-box ...")
		services.StartSingBox()
	} else {
		log.Println("未找到配置文件，等待订阅导入...")
	}

	// 启动 SSE Hub
	services.InitSSE()

	// 启动 Geo 规则集自动更新循环
	services.StartGeoUpdateLoop()

	// 注册所有路由
	mux := http.NewServeMux()
	handlers.Register(mux)

	// CORS 中间件
	srv := &http.Server{
		Addr:    config.ListenAddr,
		Handler: corsMiddleware(mux),
	}

	log.Printf("🚀 singbox-dashboard 后端启动")
	log.Printf("   监听: http://%s", config.ListenAddr)
	log.Printf("   sing-box 配置: %s", config.SingBoxConfig)
	log.Printf("   数据目录: %s", config.DataDir)
	log.Printf("   Git 提交: %s", config.GitCommit)
	log.Println("   ────────────────────────────────────────")

	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("服务端错误: %v", err)
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}

		// 日志
		if !strings.HasPrefix(r.URL.Path, "/api/logs") {
			log.Printf("%s %s", r.Method, r.URL.Path)
		}

		next.ServeHTTP(w, r)
	})
}
