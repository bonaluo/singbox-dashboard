# sing-box Dashboard

基于 Web 的 [sing-box](https://sing-box.sagernet.org/) 管理仪表板，提供节点管理、订阅管理、路由规则配置、连接监控和日志查看功能。

**预构建镜像，开箱即用。**

## 镜像说明

| 镜像 | 说明 |
|------|------|
| `bonaluo/singbox-dashboard-backend` | Go 后端 API 服务（端口 9092） |
| `bonaluo/singbox-dashboard-frontend` | Next.js 前端 Web 界面（端口 9000） |

## 快速部署

```yaml
# docker-compose.yml
services:
  backend:
    image: bonaluo/singbox-dashboard-backend:latest
    container_name: singbox-backend
    network_mode: host
    volumes:
      - ./data:/data
    environment:
      - SINGBOX_CONFIG=/data/sing-box-config.json
      - CLASH_API=http://127.0.0.1:9090
      - DASHBOARD_DATA_DIR=/data
    restart: unless-stopped

  frontend:
    image: bonaluo/singbox-dashboard-frontend:latest
    container_name: singbox-frontend
    network_mode: host
    environment:
      - HOSTNAME=0.0.0.0
      - PORT=9000
    restart: unless-stopped
    depends_on:
      - backend
```

```bash
docker compose up -d
```

## 访问

| 服务 | 地址 |
|------|------|
| 前端仪表板 | http://localhost:9000 |
| 后端 API | http://localhost:9092 |
| sing-box Clash API | http://localhost:9090 |
| 代理端口 | socks5://localhost:2080 |

## 功能

- **仪表盘** — 服务状态、节点统计、当前连接节点
- **节点管理** — 查看所有代理节点、切换当前节点
- **订阅管理** — 添加/删除/更新 Clash 订阅，自动解析 vmess/ss 链接
- **规则配置** — 可视化配置路由规则，支持 37 种 sing-box 匹配字段
- **配置查看** — 语法高亮 JSON 查看器
- **连接监控** — 实时查看活动连接
- **日志查看** — 实时日志流，级别过滤、关键字搜索

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SINGBOX_CONFIG` | `/data/sing-box-config.json` | sing-box 配置文件路径 |
| `CLASH_API` | `http://127.0.0.1:9090` | Clash REST API 地址 |
| `DASHBOARD_DATA_DIR` | `/data` | 数据目录 |
| `LISTEN_ADDR` | `0.0.0.0:9092` | 后端监听地址 |

## 技术栈

- **前端**: Next.js 14, React 18, TypeScript, Tailwind CSS 3.4
- **后端**: Go 1.22, net/http, SSE
- **容器化**: Docker 多阶段构建

## License

MIT