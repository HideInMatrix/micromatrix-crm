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

`docker/migrate.Dockerfile` 使用 Node 24 Alpine，仅部署 `@micromatrix/migrate`（`prisma + dotenv`）以及 `apps/api/prisma` schema/migrations/config。它以 `./node_modules/.bin/prisma` 为 ENTRYPOINT，默认执行 `migrate deploy`。Migration 镜像只在升级时短暂运行，API 常驻镜像不再承担数据库迁移工具链。

### Web

`docker/web.Dockerfile` 在 `BUILDPLATFORM` 的 Node 24 builder 内运行 Vite build，最终仅把与 CPU 架构无关的 `apps/web/dist` 放入 Nginx Alpine。多架构发布时不会在 QEMU arm64 Node 下重复执行 Vite。

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
2. `docker-smoke`：从 tag 对应源码真实构建 API/Migration/Web 镜像，并用隔离 PostgreSQL/Redis 验证 migration、Redis cache runtime、API/Web runtime 与 proxy。
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
