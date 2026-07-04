# singbox-dashboard 开发指南

## 开发环境部署

**只能使用 `./build.sh` 脚本部署**，禁止直接使用 `docker compose` 命令。

```bash
./build.sh
```

脚本自动：
- 生成 TAG（格式 `yy.mm.dd.hh.mm`），通过 `--env-file .env.dev` 载入配置
- 构建并启动开发环境容器

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
