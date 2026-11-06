# Docker 发布与部署

## 1. 镜像结构

生产发布使用三个镜像，异步导出 Worker 复用 API 镜像：

- API：`ghcr.io/hideinmatrix/micromatrix-crm-api`
- Migration：`ghcr.io/hideinmatrix/micromatrix-crm-migrate`
- Web：`ghcr.io/hideinmatrix/micromatrix-crm-web`

Web 镜像同时包含 PC `apps/web/dist` 与 Mobile `apps/mobile/dist`，Mobile 固定发布在 `/mobile/`。

## 2. Git Tag 发布

发布 workflow：`.github/workflows/release-docker.yml`，仅由 `v*.*.*` Tag 触发。

```bash
VERSION=1.0.0
git tag -a "v${VERSION}" -m "Release v${VERSION}"
git push origin "v${VERSION}"
```

Workflow 会分别构建 API 与 Migration 的 amd64 / arm64 镜像并发布多架构 manifest；Web 静态产物构建一次，再组装多架构 Nginx 镜像。

**Tag workflow 只负责构建和推送镜像，不会自动更新生产容器，也不会执行生产数据库迁移。** GitHub Actions 成功不等于生产部署完成。

## 3. Migration 镜像

`docker/migrate.Dockerfile` 复制当前 Prisma ORM 8 所需 contract、migration graph 和 bootstrap seed。镜像构建阶段执行 `contract emit`。

`docker/release-init.sh` 的默认 `init` 流程为：

1. 通过 Prisma ORM 运行时执行 `db migrate --yes`。
2. 执行 `src/prisma/seed.ts`，补齐首次安装所需基础数据。

Migration 是一次性服务；Migration 成功后，Compose 才允许 API、Worker 和 Web 按依赖启动。Migration 命令、contract 与 graph 的维护规则见 [Prisma Migration 规范](./prisma-migration-policy.md)。

## 4. 本地发布构建验证

```bash
pnpm typecheck
pnpm build
pnpm db:verify-migrations
pnpm db:status
pnpm db:verify

docker build -f docker/api.Dockerfile -t micromatrix-crm-api:local .
docker build -f docker/migrate.Dockerfile -t micromatrix-crm-migrate:local .
docker build -f docker/web.Dockerfile -t micromatrix-crm-web:local .
```

部署后还需在目标环境确认 Migration 成功、API 健康状态、Worker 日志与任务处理状态，以及 PC、Mobile 路由。

## 5. 使用根目录 Compose 部署

根目录 `docker-compose.yml` 是标准生产 Compose 入口。以 `.env.example` 为模板准备部署环境文件，例如：

```bash
cp .env.example docker/.env.release
```

在 `docker/.env.release` 中至少设置：

- `APP_VERSION`：固定为已成功发布的 Tag，例如 `v1.0.0`，不要依赖 `latest`。
- PostgreSQL、Redis、JWT 和企业集成加密密钥。
- `WEB_PUBLIC_URL`：生产 Web 公开域名；启用 Provider OAuth 时必须使用真实可访问地址。
- `WEB_PORT`、`TRUST_PROXY_HOPS`：按实际网络拓扑设置。

拉取并重建服务：

```bash
docker compose --env-file docker/.env.release pull
docker compose --env-file docker/.env.release up -d
```

如果需要覆盖镜像地址，才设置 `API_IMAGE`、`MIGRATE_IMAGE`、`WEB_IMAGE`；否则由 `APP_VERSION` 统一决定三个镜像的版本。

## 6. 1Panel 等外部 Compose 部署

如果生产环境使用 1Panel 管理独立 Compose，更新该 Compose 使用的 `APP_VERSION` 为目标 Tag，再执行镜像拉取和服务重建。确认 API、Migration、Web 三类镜像版本一致；Worker 应继续复用同版本 API 镜像并执行 `node dist/worker.js`。

镜像发布不会自动修改 1Panel 中保存的 Compose 文件或容器。

## 7. 反向代理与客户端 IP

标准 Compose 内部链路：

```text
client -> web/Nginx -> api
```

此时 `TRUST_PROXY_HOPS=1`。如果宿主机前面还有一层受控 1Panel/Nginx：

```text
client -> 1Panel Nginx -> web/Nginx -> api
```

此时设置 `TRUST_PROXY_HOPS=2`。每一层受控代理应正确传递 `X-Forwarded-For`；业务代码不要直接信任客户端提交的 forwarding header。

## 8. 数据持久化与启动依赖

- PostgreSQL：持久化业务数据、审计、Inbox 和导出任务。
- Redis：AOF 持久化队列所需状态；同时承载缓存、实时信号和协调数据。
- 附件/导出：API 与 Worker 共享 uploads volume。
- API 启动依赖 Migration 成功；Worker 依赖 Migration 与 Redis；Web 依赖 API healthy。

PostgreSQL 始终是业务与 `ExportTask` 的事实源。Redis queue metadata 丢失时，Worker 可根据 PostgreSQL 中的待处理任务恢复 job。

## 9. 首次安装与数据库安全

Bootstrap Seed 只在空安装时补齐基础数据和初始管理员；检测到已有用户后不会覆盖现有安装。初始账号凭据以当前 Seed 实现为准，不要将明文密码写入仓库文档、Compose 文件或公开问题记录；首次登录后应立即修改初始凭据。

任何 destructive migration 在正式环境发布前都必须针对目标数据库重新执行只读 precheck，不能复用开发库结论。部署完成后检查 Migration 状态、API 健康、Worker 日志以及 PC/Mobile 实际访问。
