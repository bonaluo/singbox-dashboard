# sing-box Dashboard

基于 Web 的 [sing-box](https://sing-box.sagernet.org/) 管理仪表板，提供节点管理、订阅管理、路由规则配置、连接监控和日志查看功能。

**预构建镜像，开箱即用。**

GitHub 仓库：[bonaluo/singbox-dashboard](https://github.com/bonaluo/singbox-dashboard)

## 国内镜像

Docker Hub 可能拉取超时。Docker 启动时添加 `--registry-mirror` 参数即可：

```bash
sudo tee -a /etc/docker/daemon.json <<< '"registry-mirrors": ["https://docker.m.daocloud.io"]'
sudo systemctl restart docker
```

或在 `docker-compose.yml` 中直接使用镜像前缀：

```yaml
image: docker.m.daocloud.io/bonaluo/singbox-dashboard-backend:latest
```

> 也可源码构建：`git clone` 后运行 `./build.sh`（自带镜像加速）。

## 镜像说明

| 镜像 | 说明 |
|------|------|
| `bonaluo/singbox-dashboard-backend` | Go 后端 API 服务（端口 9092） |
| `bonaluo/singbox-dashboard-frontend` | Next.js 前端 Web 界面（端口 9000） |

## 快速部署

### 1. 准备 `.env` 文件

```ini
NETWORK_MODE=bridge
DATA_DIR=./data
FRONTEND_PORT=9000
BACKEND_PORT=9092
SINGBOX_MIXED_PORT=2080
SINGBOX_CLASH_PORT=9090
```

### 2. 创建 `docker-compose.yml`

```yaml
services:
  backend:
    image: bonaluo/singbox-dashboard-backend:latest
    container_name: singbox-backend
    network_mode: ${NETWORK_MODE:-bridge}
    volumes:
      - ${DATA_DIR:-./data}:/data
    ports:
      - "${BACKEND_PORT:-9092}:9092"
      - "${SINGBOX_MIXED_PORT:-2080}:2080"
      - "${SINGBOX_CLASH_PORT:-9090}:9090"
    environment:
      - TZ=Asia/Shanghai
      - SINGBOX_CONFIG=/data/sing-box-config.json
      - CLASH_API=http://127.0.0.1:9090
      - DASHBOARD_DATA_DIR=/data
      - LISTEN_ADDR=0.0.0.0:${BACKEND_PORT:-9092}
    restart: unless-stopped

  frontend:
    image: bonaluo/singbox-dashboard-frontend:latest
    container_name: singbox-frontend
    network_mode: ${NETWORK_MODE:-bridge}
    ports:
      - "${FRONTEND_PORT:-9000}:9000"
    environment:
      - HOST=0.0.0.0
      - PORT=${FRONTEND_PORT:-9000}
    restart: unless-stopped
    depends_on:
      - backend
```

### 3. 启动

```bash
docker compose up -d
```

> **网络模式**：默认 `bridge`（所有平台通用）。Linux/WSL2 想用 host 模式可设 `NETWORK_MODE=host`，此时 `ports` 映射被忽略（仅 warning）。

### 4. 添加订阅

1. 打开浏览器访问 http://localhost:9000
2. 点击左侧 **📡 订阅**
3. 点击 **添加订阅**，填写名称和订阅链接
4. 添加后点击 **拉取** 解析节点数据
5. 点击 **应用** 生成 sing-box 配置并启动代理

代理端口默认为 `socks5://localhost:2080`，可在 `.env` 中修改 `SINGBOX_MIXED_PORT`。

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
| `TZ` | `Asia/Shanghai` | 容器时区，Go 日志时间戳以此为准 |
| `SINGBOX_CONFIG` | `/data/sing-box-config.json` | sing-box 配置文件路径 |
| `CLASH_API` | `http://127.0.0.1:9090` | Clash REST API 地址 |
| `DASHBOARD_DATA_DIR` | `/data` | 数据目录 |
| `LISTEN_ADDR` | `0.0.0.0:9092` | 后端监听地址 |

## Docker Compose 变量（.env）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NETWORK_MODE` | `bridge` | 网络模式（macOS/Windows: bridge；Linux/WSL2: host） |
| `DATA_DIR` | `./data` | 数据目录 |
| `FRONTEND_PORT` | `9000` | 前端端口 |
| `BACKEND_PORT` | `9092` | 后端 API 端口 |
| `SINGBOX_MIXED_PORT` | `2080` | 代理端口 |
| `SINGBOX_CLASH_PORT` | `9090` | Clash API 端口 |

## 技术栈

- **前端**: Next.js 14, React 18, TypeScript, Tailwind CSS 3.4
- **后端**: Go 1.22, net/http, SSE
- **容器化**: Docker 多阶段构建

## License

MIT
