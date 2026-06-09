# sing-box Dashboard

基于 Web 的 [sing-box](https://sing-box.sagernet.org/) 管理仪表板，提供节点管理、订阅管理、路由规则配置、连接监控和日志查看功能。

## 架构

```
┌─────────────────────────────────────────┐
│  Frontend (Next.js 14 + Tailwind CSS)   │
│  Port: 9000                             │
└──────────────┬──────────────────────────┘
               │ HTTP API
┌──────────────┴──────────────────────────┐
│  Backend (Go 1.22)                      │
│  Port: 9092                             │
│  ├── 节点管理 (Clash REST API)           │
│  ├── 订阅管理 (Base64 解析 / Vmess)       │
│  ├── 规则引擎 (37 种匹配字段)             │
│  ├── 日志捕获 (SSE 实时推送)             │
│  └── SSE Hub (事件推送)                  │
└──────────────┬──────────────────────────┘
               │ Clash API (curl)
┌──────────────┴──────────────────────────┐
│  sing-box Process                       │
│  Clash API: 9090  |  Proxy: 2080        │
└─────────────────────────────────────────┘
```

## 功能

- **仪表盘** — 服务状态、节点统计、当前连接节点
- **节点管理** — 查看所有代理节点、切换当前节点
- **订阅管理** — 添加/删除/更新 Clash 订阅，自动解析 vmess/ss 链接
- **规则配置** — 可视化配置路由规则，支持 37 种 sing-box 匹配字段、动作类型（route/reject/hijack-dns/sniff）、反转匹配
- **配置查看** — 语法高亮 JSON 查看器，可折叠、一键复制
- **连接监控** — 实时查看活动连接，按目标/协议/链路/流量排序
- **日志查看** — 实时日志流，级别过滤、关键字搜索、ANSI 码自动清除

## 快速开始

### 前置要求

- Docker & Docker Compose
- sing-box 配置文件（可选，订阅导入会自动生成）

### 部署

**方法一：本地开发（Linux/WSL2，host 网络）**

```bash
./build.sh              # 构建并启动
./build.sh backend      # 仅构建启动后端
./build.sh frontend     # 仅构建启动前端
```

**方法二：生产 / macOS / Windows（bridge 网络）**

```bash
cp .env.example .env    # 编辑 .env 中端口等参数
docker compose up -d     # bridge 模式（默认，所有平台通用）
# host 模式（仅 Linux/WSL2）: docker compose -f docker-compose.yml -f docker-compose.host.yml up -d
```

> **注意**：如果 Docker Hub 拉取超时（中国大陆常见），参考 [DOCKER_HUB.md](./DOCKER_HUB.md) 的"镜像拉取加速"章节配置代理或改用 `./build.sh` 源码构建。

### 访问

### 首次使用

启动后后端自动等待订阅。通过仪表板三步完成配置：

1. 打开浏览器访问 http://localhost:9000
2. 点击左侧 **📡 订阅**
3. 点击 **添加订阅**，填写名称和订阅链接后确认
4. 在订阅列表中点击 **拉取** 解析节点数据
5. 点击 **应用** 生成 sing-box 配置并启动代理

之后即可通过代理端口使用（默认 `socks5://localhost:2080`）。

### 访问

| 服务 | 地址 |
|------|------|
| 前端仪表板 | http://localhost:9000 |
| 后端 API | http://localhost:9092 |
| sing-box Clash API | http://localhost:9090 |
| 代理端口 | socks5://localhost:2080 |

### 数据目录

所有持久化数据存储在 `${DATA_DIR:-./data}`（由 `.env` 配置）：

```
data/
├── sing-box-config.json    # sing-box 运行配置（订阅 apply 时自动生成）
├── sing-box.log            # sing-box 运行日志
├── rules.json              # 路由规则
├── subscriptions.json       # 订阅列表
└── subscription_data/      # 订阅缓存数据
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TZ` | `Asia/Shanghai` | 容器时区（日志时间戳以此为准） |
| `SINGBOX_CONFIG` | `/data/sing-box-config.json` | sing-box 配置文件路径 |
| `SINGBOX_BIN` | `/usr/local/bin/sing-box` | sing-box 可执行文件路径 |
| `CLASH_API` | `http://127.0.0.1:9090` | Clash REST API 地址 |
| `DASHBOARD_DATA_DIR` | `/data` | 仪表板数据目录 |
| `LISTEN_ADDR` | `0.0.0.0:9092` | 后端监听地址 |

### Docker Compose 变量（.env）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATA_DIR` | `./data` | 数据目录 |
| `FRONTEND_PORT` | `9000` | 前端端口 |
| `BACKEND_PORT` | `9092` | 后端 API 端口 |
| `SINGBOX_MIXED_PORT` | `2080` | 代理端口 |
| `SINGBOX_CLASH_PORT` | `9090` | Clash API 端口 |

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/status` | 服务状态（运行状态、当前节点、节点数） |
| GET | `/api/proxies` | 代理节点列表 |
| POST | `/api/proxies/switch` | 切换当前代理节点 |
| GET | `/api/subscriptions` | 订阅列表 |
| POST | `/api/subscriptions` | 添加订阅（自动拉取验证） |
| DELETE | `/api/subscriptions/{id}` | 删除订阅 |
| POST | `/api/subscriptions/{id}/fetch` | 拉取并解析订阅 |
| POST | `/api/subscriptions/{id}/apply` | 应用订阅到 sing-box 配置 |
| GET | `/api/rules` | 规则列表 |
| POST | `/api/rules` | 添加规则 |
| PUT | `/api/rules/{id}` | 更新规则 |
| DELETE | `/api/rules/{id}` | 删除规则 |
| POST | `/api/rules/apply` | 应用规则到 sing-box 配置 |
| GET | `/api/config` | 查看 sing-box 原始配置 JSON |
| GET | `/api/connections` | 活动连接列表 |
| GET | `/api/logs?tail=N` | 查看 sing-box 日志 |
| GET | `/api/events?types=...` | SSE 事件流（实时状态/连接/日志推送） |

## 规则配置

支持全部 37 种 sing-box route rule 匹配字段：

**域名/IP**：domain, domain_suffix, domain_keyword, domain_regex, geosite, geoip, source_geoip, ip_cidr, source_ip_cidr, ip_is_private, source_ip_is_private

**端口**：port, port_range, source_port, source_port_range

**进程/用户**：process_name, process_path, process_path_regex, package_name, user, user_id, inbound

**协议/网络**：protocol, client, network, network_type, network_is_expensive, network_is_constrained, ip_version, auth_user, clash_mode

**WiFi/其他**：wifi_ssid, wifi_bssid, rule_set, source_mac_address, source_hostname, preferred_by

## 技术栈

- **前端**：Next.js 14, React 18, TypeScript, Tailwind CSS 3.4
- **后端**：Go 1.22, net/http (标准库), SSE
- **容器化**：Docker 多阶段构建, docker-compose
- **实时通信**：Server-Sent Events (SSE) 替代轮询

## License

MIT
