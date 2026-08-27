# Docker 发布与 Git Tag 打包

MicroMatrix CRM 的生产发布使用前后端两个独立镜像：

- API：`ghcr.io/hideinmatrix/micromatrix-crm-api`
- Web：`ghcr.io/hideinmatrix/micromatrix-crm-web`

GitHub Actions 会根据实际 `owner/repo` 动态生成小写 GHCR 地址；上面的地址是当前仓库实例。

## 1. 发布一个版本

首次发布 `v0.0.1`：

```bash
git tag v0.0.1
git push origin v0.0.1
```

如果本地已经存在这个 tag，只需要：

```bash
git push origin v0.0.1
```

`.github/workflows/release-docker.yml` 只监听 `v*.*.*` tag。普通 `git push origin master` 不会触发 Docker release。

流水线依次执行：

1. SemVer tag 校验。
2. pnpm install；先构建 `@micromatrix/shared`，再执行全仓 typecheck、ESLint。
3. 真实 Docker runtime Smoke。
4. API/Web 分别构建 `linux/amd64`、`linux/arm64`。
5. 推送到 GHCR。

`@micromatrix/shared` 的 `main` / `types` 都指向 `packages/shared/dist`。GitHub Runner 是全新 checkout，不存在开发机残留的 `dist`，因此源码校验必须先生成 shared 构建产物再校验 API/Web。根 `pnpm typecheck` 和 `pnpm build` 均按 `shared → api → web` 的依赖顺序执行，避免本地缓存掩盖 workspace 跨包问题。

以 `v0.0.1` 为例，至少可使用：

```text
ghcr.io/hideinmatrix/micromatrix-crm-api:v0.0.1
ghcr.io/hideinmatrix/micromatrix-crm-web:v0.0.1
```

## 2. 本地验证 release 镜像

执行：

```bash
pnpm smoke:docker-release
```

脚本不会使用当前开发数据库。它会创建临时 Docker network/PostgreSQL，执行全部 Prisma migration，启动 API/Web，完成验证后自动清理临时容器和网络。

验证内容：

- API Docker build。
- Web Docker build。
- API 镜像内 `prisma migrate deploy`。
- `/api/health`。
- Nginx `/healthz`。
- Nginx `/api` 反向代理。
- Vue Router `/login` history fallback。

## 3. 使用 release compose 部署

复制配置模板，注意不要直接使用示例密钥：

```bash
cp docker/.env.release.example docker/.env.release
```

修改 `docker/.env.release` 中的数据库密码、JWT 密钥、`INTEGRATION_CREDENTIALS_KEY`、外部 Web 地址和镜像版本，然后：

```bash
docker compose \
  --env-file docker/.env.release \
  -f docker-compose.release.yml \
  pull

docker compose \
  --env-file docker/.env.release \
  -f docker-compose.release.yml \
  up -d
```

默认 Web 暴露在 `8080`，可通过 `WEB_PORT` 修改。

启动顺序由 Compose 负责：PostgreSQL 健康 → migration 成功 → API 健康 → Web。

## 4. 数据持久化

- PostgreSQL：`release_pgdata`
- API 附件/导出文件：`release_uploads` → `/app/uploads`

升级应用镜像不会删除这两个 volume。

生产环境若使用外部 PostgreSQL，只需把 `DATABASE_URL` 指向外部数据库；是否保留 compose 内 PostgreSQL 可根据部署环境进一步裁剪。

## 5. 手工构建

不经过 GitHub Actions 时可以分别构建：

```bash
docker build -f docker/api.Dockerfile -t micromatrix-crm-api:local .
docker build -f docker/web.Dockerfile -t micromatrix-crm-web:local .
```

Web 镜像不编译固定 API 地址。运行时通过：

```text
API_UPSTREAM=http://api:3000
```

决定 `/api` 请求转发目标。
