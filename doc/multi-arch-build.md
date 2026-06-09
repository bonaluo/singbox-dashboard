# 多架构镜像构建原理

singbox-dashboard 的 Docker 镜像同时支持 `linux/amd64` 和 `linux/arm64` 两个架构。用户在 Apple Silicon Mac、Intel Mac、AMD64 Linux、ARM64 Linux 上 `docker pull` 时，Docker 会自动拉取匹配架构的镜像，无需手动指定 `--platform`。

## 整体流程

```
CI runner (amd64)
  │
  ├─ QEMU 模拟 arm64 ──→ 构建出 arm64 镜像 ──┐
  │                                           ├─→ Manifest List ──→ Docker Hub
  └─ 原生 amd64 ──────→ 构建出 amd64 镜像 ──┘
                                                   │
                                           docker pull 时自动选匹配架构
```

## 第一层：基础镜像已经是多架构的

```dockerfile
# backend/Dockerfile
ARG GO_IMAGE=golang:1.25-alpine      # ← Docker Hub 上这是个 manifest list
FROM ${GO_IMAGE} AS builder          #   包含 amd64 + arm64 两份实际镜像
...
FROM ghcr.io/sagernet/sing-box:latest # ← 也是 manifest list
```

```dockerfile
# frontend/Dockerfile
ARG NODE_IMAGE=node:22-alpine        # ← 同样是 manifest list
FROM ${NODE_IMAGE} AS builder
```

`golang:1.25-alpine`、`node:22-alpine`、`ghcr.io/sagernet/sing-box:latest` 这些基础镜像本身就是多架构的 Manifest List。如果 `FROM` 的镜像只有 amd64，下游构建不出 arm64 镜像——这是整个链路的前提。

## 第二层：Buildx + QEMU 交叉构建

GitHub Actions 的 CI 配置（`.github/workflows/release.yml`）中，4 行代码完成跨架构构建：

```yaml
- uses: docker/setup-qemu-action@v3        # ① 安装 QEMU 用户态模拟器
- uses: docker/setup-buildx-action@v3      # ② 创建 Buildx builder
- uses: docker/build-push-action@v5        # ③ 构建 + 推送
  with:
    platforms: linux/amd64,linux/arm64     # ④ 指定两个目标平台
```

`ubuntu-latest` runner 是 amd64。Buildx 看到 `platforms` 里有两个架构时的行为：

| 目标平台 | runner 原生？ | 怎么构建 |
|----------|-------------|---------|
| `linux/amd64` | ✅ 同架构 | 直接在 runner 上执行，无额外开销 |
| `linux/arm64` | ❌ 不同架构 | QEMU 用户态模拟 arm64 指令集执行每条 `RUN` |

QEMU 的工作原理：`docker/setup-qemu-action@v3` 在 runner 内核里注册 binfmt_misc 处理器。当 Docker 尝试执行 arm64 二进制（如 `go build`、`npm install`）时，内核拦截并把每条 arm64 指令翻译成 amd64 指令。整个过程对 Dockerfile 完全透明，不需要修改任何构建脚本。

### 后端：CGO_ENABLED=0 是关键

```dockerfile
RUN CGO_ENABLED=0 go build -ldflags="-X 'singbox-dashboard/config.GitCommit=${GIT_COMMIT}'" -o singbox-dashboard .
```

`CGO_ENABLED=0` 生成纯静态二进制，不依赖 C 交叉编译工具链。如果开了 CGO，arm64 交叉编译需要 `aarch64-linux-gnu-gcc`，构建复杂度会大幅上升。

### 前端：Node.js 多架构天然支持

```dockerfile
FROM ${NODE_IMAGE} AS builder
RUN npm install --registry ${NPM_REGISTRY}
RUN npm run build
```

Node.js 是解释型运行时，`npm install` 和 `npm run build` 不需要交叉编译。`node:22-alpine` 基础镜像本身有 arm64 版本，QEMU 模拟执行即可。

## 第三层：Manifest List（胖清单）

Buildx 构建完成后，不会推送两个独立 tag。而是**创建一个 Manifest List 指向两份镜像**，共用同一个 tag：

```
bonaluo/singbox-dashboard-backend:latest
├── linux/amd64 → sha256:abc123...  （amd64 镜像 digest）
└── linux/arm64 → sha256:def456...  （arm64 镜像 digest）
```

Manifest List 是 Docker Registry v2 协议的标准能力，本质上是一个 JSON 索引文件，不包含实际镜像层数据。

## 用户 pull 时发生了什么

```bash
docker pull bonaluo/singbox-dashboard-backend:latest
```

Docker 客户端在 HTTPS 请求中携带 `Accept: application/vnd.docker.distribution.manifest.v2+json` 头，并根据宿主机内核架构自动选择匹配的镜像：

| 用户机器 | `uname -m` | Docker 拉取 |
|---------|-----------|------------|
| Intel Mac / AMD64 Linux | `x86_64` | `linux/amd64` 镜像 |
| Apple Silicon Mac (M1/M2/M3/M4) | `aarch64` | `linux/arm64` 镜像 |
| ARM64 Linux (树莓派、AWS Graviton 等) | `aarch64` | `linux/arm64` 镜像 |

整个过程对用户透明，无需 `--platform` 参数。Docker Desktop for Mac 虽然在 macOS 里跑 Linux VM，但 VM 内核跟随 Mac 芯片架构（Apple Silicon → arm64 VM → 拉 arm64 镜像）。
