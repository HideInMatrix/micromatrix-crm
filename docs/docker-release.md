# Docker 发布与 Git Tag 打包

生产发布使用三个职责隔离的镜像；异步导出 worker 复用 API 镜像：

- API：`ghcr.io/<owner>/<repo>-api`
- Migration：`ghcr.io/<owner>/<repo>-migrate`
- Web：`ghcr.io/<owner>/<repo>-web`

Web 镜像同时包含 PC `apps/web/dist` 与 Mobile `apps/mobile/dist`，Mobile 固定发布在 `/mobile/`。

## 1. 工具链

- Node.js：25
- pnpm：11.25.0
- API / Migration 使用 Alpine runtime；Web 使用 Nginx runtime。
- GitHub Release workflow：`.github/workflows/release-docker.yml`。

API 镜像只包含生产运行时，不承担数据库 migration。Migration 镜像负责 Prisma ORM 8 migration graph 和 bootstrap Seed。worker 通过同一 API 镜像执行 `node dist/worker.js`。

## 2. 发布版本

只有 `v*.*.*` Tag 会触发镜像发布：

```bash
git tag v0.0.1
git push origin v0.0.1
```

Workflow 会分别原生构建 amd64 / arm64 的 API 与 Migration 镜像，再合并 multi-arch manifest；Web 静态产物只需构建一次，再组装多架构 Nginx runtime。

## 3. Migration 镜像

`docker/migrate.Dockerfile` 只复制当前 Prisma 8 所需资产：

- `apps/api/migrations/`
- `apps/api/prisma.config.ts`
- `apps/api/src/prisma/contract.prisma`
- `apps/api/src/prisma/db.ts`
- `apps/api/src/prisma/seed.ts` / `seed-bootstrap.ts`
- Prisma runtime helper 与 `@micromatrix/shared`

镜像构建阶段执行 `contract emit`，产物落到 `src/prisma/contract.json` / `contract.d.ts`。

`docker/release-init.sh` 默认执行：

```text
prisma db migrate
SEED_MODE=bootstrap tsx src/prisma/seed.ts
```

Migration 是一次性服务；数据库结构升级成功后才允许 API / worker / Web 进入后续启动阶段。

## 4. 本地 release smoke

```bash
pnpm smoke:docker-release
```

脚本使用独立临时 PostgreSQL / Redis，不复用当前开发库。验收至少覆盖：

- API / Migration / Web 三张镜像真实构建。
- 当前 Prisma 8 migration graph 从空库应用。
- bootstrap Seed。
- API 与 worker 入口存在并可运行。
- Redis / BullMQ 基础链路。
- `/api/health`、Nginx `/healthz` 和 `/api` proxy。
- PC `/login` history fallback。
- Mobile `/mobile/` 与深层路由 fallback。

不能用静态 grep 代替真实 Docker build / runtime smoke。

## 5. 生产 Compose

根目录 `docker-compose.yml` 是生产部署入口。部署时先准备 `docker/.env.release`，再执行：

```bash
docker compose --env-file docker/.env.release pull
docker compose --env-file docker/.env.release up -d
```

推荐把 `APP_VERSION` 固定到已成功发布的 Tag，避免依赖本机旧 `latest` 缓存。

如果启用企业微信、钉钉或飞书 OAuth，`docker/.env.release` 必须显式设置对外 Web 域名，例如 `WEB_PUBLIC_URL=https://crm.example.com`；也可以为企微单独设置 `WECOM_OAUTH_REDIRECT_URI`。生产 Compose 不再提供 localhost 默认值，避免忘记配置时生成不可用的 OAuth 回调地址；缺少公开地址时 Provider 登录会按服务端现有校验明确失败。

标准启动顺序：

1. PostgreSQL / Redis 启动并通过 healthcheck。
2. Migration 服务执行 Prisma 8 graph 与 bootstrap Seed。
3. Migration 成功后启动 API。
4. worker 等待 Migration 与 Redis healthy 后启动。
5. API healthy 后启动 Web。

Redis 故障不能破坏普通 PostgreSQL 业务的真实性；但依赖 BullMQ 的异步导出在 queue 不可用时必须 fail-closed，不能伪装为已排队。

## 6. 反向代理与客户端 IP

Compose 内部标准链路：

```text
client -> web/Nginx -> api
```

此时 `TRUST_PROXY_HOPS=1`。

若宿主机还有 1Panel/Nginx：

```text
client -> 1Panel Nginx -> web/Nginx -> api
```

此时设置 `TRUST_PROXY_HOPS=2`。每一层受控 Nginx 使用 `X-Forwarded-For $proxy_add_x_forwarded_for`；业务代码不要直接信任客户端提交的 forwarding header。

## 7. 数据持久化

- PostgreSQL：生产 volume / 外部数据库。
- Redis：AOF volume；只保存缓存、实时协调和 BullMQ delivery metadata。
- 附件/导出：API 与 worker 共享 uploads volume。

PostgreSQL 始终是业务与 `ExportTask` 的真相源；Redis queue metadata 丢失时，worker 通过 PostgreSQL PENDING task 恢复缺失 job。

## 8. 首次安装

bootstrap Seed 只在空安装补基础数据和默认管理员；检测到已有用户后不会覆盖现有安装。

默认管理员：

```text
admin@demo.com / admin123
```

首次登录后应立即修改默认密码。

## 9. 数据库发布前检查

Prisma ORM 8 规则见 [prisma-migration-policy.md](./prisma-migration-policy.md)。任何 destructive migration 在正式环境发布前都必须针对目标数据库重新执行只读 precheck，不能复用开发库结论。
