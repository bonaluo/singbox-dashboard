# singbox-dashboard 开发指南

## 开发环境部署

**只能使用 `./build.sh` 脚本部署**，禁止直接使用 `docker compose` 命令。

```bash
./build.sh
```

脚本自动：
- 生成 TAG（格式 `yy.mm.dd.hh.mm`），通过 `--env-file .env.dev` 载入配置
- 构建并启动开发环境容器

### 镜像拉取：使用 crane + 本机代理，绕过 docker daemon

ghcr.io 官方源在国内 docker daemon 直接拉取极慢（25MB 可达 5 分钟+），
daocloud 等加速源对 ghcr.io 代理返回 403，均不可用。

**正确做法**：用 crane（`~/bin/crane`，go-containerregistry 客户端，纯二进制不走 docker daemon）+ 本机代理拉取后导入 docker。

代理地址不写死，以当前机器环境为准（`echo $http_proxy` 查看，常见如 `http://127.0.0.1:7890`）：

```bash
export https_proxy=$http_proxy http_proxy=$http_proxy   # 沿用环境变量中已配置的代理
~/bin/crane pull ghcr.io/sagernet/sing-box:vX.Y.Z /tmp/singbox-vX.Y.Z.tar
docker load < /tmp/singbox-vX.Y.Z.tar
```

- 拉取秒级完成，docker load 后本地已有该 tag，`docker compose build` 不会再触发远端拉取
- `SINGBOX_IMAGE` 保持官方 ghcr.io tag（crane 导入的就是该 tag），无需改加速源
- 首次使用需安装 crane：从 GitHub releases 下载 `go-containerregistry_Linux_x86_64.tar.gz`（需代理）解压到 `~/bin/crane`

## 开发调试

开发调试直接启动 dev server，仅打 tag 时构建 Docker 镜像。

## 端口约定

开发环境端口 = 正式环境端口 + 1，避免冲突：

| 服务      | 开发 | 正式 |
|-----------|------|------|
| Frontend  | 9001 | 9000 |
| Backend   | 9093 | 9092 |
| Clash API | 9091 | 9090 |
| Mixed     | 2081 | 2080 |
