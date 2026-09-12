# W3.4-D Docker 发布链路设计

## 1. 镜像结构

### API

`docker/api.Dockerfile` 使用 multi-stage build：

1. Node 24 Alpine `base` 安装 OpenSSL 与 CA，builder/runtime 复用同一基础层。
2. builder 固定 pnpm `11.25.0`，只安装 `@micromatrix/migrate` 与 `@micromatrix/api...`（Prisma 构建工具 + API + shared），不再把 Web/Vite 或根目录 ESLint 工具链拉入 API builder。
3. pnpm store 使用 BuildKit cache mount；构建 `@micromatrix/shared`，随后执行 API 的 Prisma generate + TypeScript build。
4. 使用 pnpm modern deploy：`--config.inject-workspace-packages=true --filter @micromatrix/api --prod --no-optional deploy`。runtime 不携带 `prisma` CLI、Studio、TypeScript/PGlite 等 optional peer 工具链。
5. runtime 只复制 deploy 结果，并以非 root `node` 用户执行 `node dist/main.js`。
6. `/app/uploads` 声明为持久化卷。

### Migration

`docker/migrate.Dockerfile` 使用 Node 24 Alpine，部署 `@micromatrix/migrate` 及其 production workspace 依赖 `@micromatrix/shared`，并复制 `apps/api/prisma` schema/migrations/config、生成后的 Prisma Client 与 Seed 依赖的 metadata system-field 模板。builder 必须先构建 shared，再执行 pnpm 11 dedicated production deploy，保证 `tsx prisma/seed.ts` 的 `@micromatrix/shared` 运行时 import 在发布镜像内真实可解析。

Migration runtime 以 `docker/release-init.sh` 为 ENTRYPOINT：默认 `init` 顺序执行 `prisma migrate deploy` + `SEED_MODE=bootstrap` Seed；重复执行时 bootstrap 只补空安装，不覆盖已有管理员数据。Migration 镜像只在升级/初始化时短暂运行，API 常驻镜像不再承担 Prisma CLI、migration 或 Seed 工具链。

数据库结构变更必须采用 append-only migration：开发阶段修改 `schema.prisma` 后执行 `pnpm db:migrate:dev -- --name <change>` 生成新的 `prisma/migrations/<timestamp>_<change>/migration.sql`，已发布 migration 不得再次修改。根目录提供 `pnpm db:deploy` / `pnpm db:status` 作为生产 deploy/status 统一入口；`pnpm db:legacy-sync` 仅用于历史环境一次性修复“旧库已记录 migration、但实际 schema 落后”的遗留状态，不属于日常发布流程。

GitHub Actions 在发布前执行 `pnpm db:verify-migrations`，固定已发布 baseline 的 SHA-256，阻止继续改写历史 baseline；Docker smoke 在 fresh PostgreSQL 上执行正常 `migrate deploy` 后立即用 `prisma migrate diff --exit-code` 比较数据库与当前 `schema.prisma`。因此后续如果只改 schema 却没有新增 migration，发布会在镜像构建前失败，而不会再把不完整的 migrate 镜像推到线上。

### Web

`docker/web.Dockerfile` 在 `BUILDPLATFORM` 的 Node 24 builder 内同时构建 PC `apps/web` 与 Mobile `apps/mobile`，最终把两份与 CPU 架构无关的静态产物分别放到 Nginx `/` 与 `/mobile/`。多架构发布时不会在 QEMU arm64 Node 下重复执行 Vite。

Nginx 配置使用官方 `/etc/nginx/templates/*.template` 运行时 envsubst：

```text
浏览器 /api/* -> Nginx -> ${API_UPSTREAM} -> NestJS
浏览器 /任何 Vue 路由 -> try_files -> /index.html
```

因此同一个 Web 镜像可以在不同部署环境指向不同 API，不需要重新执行 Vite build。

## 2. 生产 Compose

当前生产 `docker-compose.yml` 的启动顺序为：

```text
postgres healthy -------------------┐
    ↓                               │
migrate (Migration image)           │
    ↓ success                       │
api healthy <------ redis ----------┼----> worker (dist/worker.js)
    ↓                 ↑             │
web                   └-- queue ----┘
```

附件与导出文件存放在 API/worker 共享的 `release_uploads` volume，PostgreSQL 数据存放在 `release_pgdata`，Redis AOF 存放在 `release_redisdata`。Redis 使用密码认证且不发布宿主机端口；Migration 与 Redis 无依赖，API 也不等待 Redis healthy，Redis 冷启动或运行时故障时普通缓存逻辑直接降级 PostgreSQL。Export Worker 必须等待 Redis healthy；异步导出 producer 在 queue 不可用时 fail-closed 返回 503。PostgreSQL `ExportTask` 是任务真相源，worker 启动负责保留已有 job 或恢复缺失 job。

## 3. GitHub Actions

触发器：

```yaml
on:
  push:
    tags:
      - 'v*.*.*'
```

流水线分为四层：

1. `verify`：校验 SemVer tag，使用 `pnpm/setup@v2` 直接准备 Node 24/pnpm 11.25.0 与 pnpm store cache，显式执行 frozen install、全仓 typecheck 和 lint；不再经过 npm bootstrap + pnpm self-update。
2. `docker-smoke`：从 tag 对应源码执行 tracked `docker/release-smoke.sh`，真实构建 API/Migration/Web 镜像，并用隔离 PostgreSQL/Redis 验证 migration + bootstrap Seed、Redis cache runtime、Worker/API/Web runtime、PC/Mobile SPA fallback 与 proxy。
3. `api-images`：amd64 使用 `ubuntu-latest` 原生构建，arm64 使用 `ubuntu-24.04-arm` 原生构建 API 与 Migration，各自推送临时架构 tag；不通过 QEMU 执行 Prisma/TypeScript/pnpm deploy。
4. `api-manifest` 分别合并 API/Migration 两套架构镜像为正式 multi-arch tags；`web-image` 在 x64 runner 原生构建一次静态 dist，再组装 `linux/amd64,linux/arm64` Nginx 镜像。

GHCR 写权限只授予 API 架构发布、manifest 和 Web 发布 job，其余 job 只有源码读取权限。

## 4. 镜像标签

以 `v0.0.1` 为例：

```text
ghcr.io/hideinmatrix/micromatrix-crm-api:v0.0.1
ghcr.io/hideinmatrix/micromatrix-crm-api:0.0.1
ghcr.io/hideinmatrix/micromatrix-crm-api:0.0
ghcr.io/hideinmatrix/micromatrix-crm-api:latest

ghcr.io/hideinmatrix/micromatrix-crm-migrate:v0.0.1
ghcr.io/hideinmatrix/micromatrix-crm-migrate:0.0.1
ghcr.io/hideinmatrix/micromatrix-crm-migrate:0.0
ghcr.io/hideinmatrix/micromatrix-crm-migrate:latest

ghcr.io/hideinmatrix/micromatrix-crm-web:v0.0.1
ghcr.io/hideinmatrix/micromatrix-crm-web:0.0.1
ghcr.io/hideinmatrix/micromatrix-crm-web:0.0
ghcr.io/hideinmatrix/micromatrix-crm-web:latest
```

实际 owner/repository 由 `GITHUB_REPOSITORY` 动态转成小写，不把仓库所有者写死在 workflow 中。

## 5. 安全边界

- GitHub workflow 只使用 `GITHUB_TOKEN` 推 GHCR，不保存 registry 密码。
- `.dockerignore` 显式排除所有 `.env`，仅允许 `.env.example`。
- Docker image 不内置 JWT、数据库密码、企业集成密钥。
- `docker/.env.release.example` 只能作为字段模板，生产部署必须创建独立 `.env.release` 并使用随机密钥。
