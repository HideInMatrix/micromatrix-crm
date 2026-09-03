# Docker 发布与 Git Tag 打包

MicroMatrix CRM 的生产发布使用三个职责隔离的镜像：

- API：`ghcr.io/hideinmatrix/micromatrix-crm-api`
- Migration：`ghcr.io/hideinmatrix/micromatrix-crm-migrate`
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
4. API 与 Migration 按架构原生构建：`linux/amd64` 使用 x64 GitHub Runner，`linux/arm64` 使用 `ubuntu-24.04-arm`，随后分别合并 multi-arch manifest；不通过 QEMU 执行 Prisma/TypeScript 构建。
5. Web 的 Vite 静态产物固定在 BuildKit `BUILDPLATFORM` 构建一次，再组装 `linux/amd64`、`linux/arm64` 两个 Nginx runtime 镜像。
6. 三个镜像推送到 GHCR。

`@micromatrix/shared` 的 `main` / `types` 都指向 `packages/shared/dist`。GitHub Runner 是全新 checkout，不存在开发机残留的 `dist`，因此源码校验必须先生成 shared 构建产物再校验 API/Web。根 `pnpm typecheck` 和 `pnpm build` 均按 `shared → api → web` 的依赖顺序执行，避免本地缓存掩盖 workspace 跨包问题。

镜像构建阶段继续收窄 workspace 依赖：API builder 只安装 `@micromatrix/migrate` 与 `@micromatrix/api...`（Prisma 构建工具 + API + shared），Web builder 只安装 `@micromatrix/web...`（Web + shared）。API runtime 使用 Alpine + pnpm dedicated-lockfile `--prod --no-optional` deploy，不再携带 Prisma CLI、Studio、TypeScript 等构建/迁移工具；数据库 migration 由独立 Migration 镜像执行。

以 `v0.0.1` 为例，至少可使用：

```text
ghcr.io/hideinmatrix/micromatrix-crm-api:v0.0.1
ghcr.io/hideinmatrix/micromatrix-crm-migrate:v0.0.1
ghcr.io/hideinmatrix/micromatrix-crm-web:v0.0.1
```

## 2. 本地验证 release 镜像

执行：

```bash
pnpm smoke:docker-release
```

脚本不会使用当前开发数据库。它会创建临时 Docker network/PostgreSQL/Redis，通过独立 Migration 镜像执行全部 Prisma migration，再启动 API/Web，完成验证后自动清理临时容器和网络。

验证内容：

- API Docker build。
- Migration Docker build。
- Web Docker build。
- API/Migration/Web Dockerfile workspace scope 与多架构构建策略防回归检查。
- API runtime 不包含 Prisma CLI；Migration 镜像独立执行 `prisma migrate deploy`。
- Redis 使用密码认证；API 实际写入认证上下文与通知缓存 key，并验证修改密码后认证缓存主动失效。
- `/api/health`。
- Nginx `/healthz`。
- Nginx `/api` 反向代理。
- Vue Router `/login` history fallback。

## 3. 使用 release compose 部署

安装流程保持与 Cordys CRM 相同的思路：部署者只负责准备配置并启动容器，不需要手工执行数据库 migration 或 seed。

先复制配置模板，注意不要直接使用示例密钥：

```bash
cp docker/.env.release.example docker/.env.release
```

修改 `docker/.env.release` 中的数据库密码、Redis 密码、JWT 密钥、`INTEGRATION_CREDENTIALS_KEY`、外部 Web 地址和镜像版本，然后：

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

Compose 内部会自动完成以下启动顺序：

1. PostgreSQL 与 Redis 作为独立基础服务启动；Redis 只存在于 Compose 内部网络，不发布宿主机端口，并保留 healthcheck 供运行状态观测；
2. 内部初始化服务只依赖 PostgreSQL，自动执行数据库 migration，并在首次安装时创建系统基础数据和默认管理员；
3. Migration 成功后启动 API；API 不把 Redis healthy 作为启动硬门槛，Redis 尚未就绪时缓存调用直接按 miss 回退 PostgreSQL，恢复后客户端自动重新连接；
4. API 健康后启动 Web。

`migrate` 是内部一次性服务，作用等同于 Cordys CRM 启动时自动执行的 Flyway migration，部署者不需要直接运行它。

首次安装默认管理员：

```text
账号：admin@demo.com
密码：admin123
```

已有管理员时，后续升级不会把其密码重置回默认值。首次登录后应立即修改默认密码。

默认 Web 暴露在 `8080`，可通过 `WEB_PORT` 修改。

启动顺序由 Compose 负责：PostgreSQL 健康 → migration 成功 → API 健康 → Web；Redis 独立运行并提供可降级缓存，不阻断 API 冷启动。

## 4. 数据持久化

- PostgreSQL：`release_pgdata`
- Redis AOF：`release_redisdata`
- API 附件/导出文件：`release_uploads` → `/app/uploads`

升级应用镜像不会删除这些 volume。Redis 只保存可丢弃派生缓存，即使 Redis volume 被清空，业务数据仍以 PostgreSQL 为准。

生产环境若使用外部 PostgreSQL，只需把 `DATABASE_URL` 指向外部数据库；是否保留 compose 内 PostgreSQL 可根据部署环境进一步裁剪。

## 5. 手工构建

不经过 GitHub Actions 时可以分别构建：

```bash
docker build -f docker/api.Dockerfile -t micromatrix-crm-api:local .
docker build -f docker/migrate.Dockerfile -t micromatrix-crm-migrate:local .
docker build -f docker/web.Dockerfile -t micromatrix-crm-web:local .
```

Web 镜像不编译固定 API 地址。运行时通过：

```text
API_UPSTREAM=http://api:3000
```

决定 `/api` 请求转发目标。
