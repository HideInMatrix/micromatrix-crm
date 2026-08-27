# W3.4-D Docker 发布链路设计

## 1. 镜像结构

### API

`docker/api.Dockerfile` 使用 multi-stage build：

1. Node 24 Debian builder 安装固定 pnpm `10.30.3`、OpenSSL 与 CA。
2. 使用 workspace lockfile 安装依赖。
3. 构建 `@micromatrix/shared`，随后执行 API 的 Prisma generate + TypeScript build。
4. 使用 `pnpm deploy --prod --legacy` 生成独立生产依赖目录。
5. runtime 只复制 deploy 结果，并以非 root `node` 用户执行 `node dist/main.js`。
6. `/app/uploads` 声明为持久化卷。

Prisma CLI 与 `dotenv` 属于 API 生产部署能力，因此保留在 production dependencies。同一个镜像可以用：

```bash
./node_modules/.bin/prisma migrate deploy
```

作为一次性 migration 容器。

### Web

`docker/web.Dockerfile` 在 Node 24 builder 内运行 Vite build，最终仅把 `apps/web/dist` 放入 Nginx Alpine。

Nginx 配置使用官方 `/etc/nginx/templates/*.template` 运行时 envsubst：

```text
浏览器 /api/* -> Nginx -> ${API_UPSTREAM} -> NestJS
浏览器 /任何 Vue 路由 -> try_files -> /index.html
```

因此同一个 Web 镜像可以在不同部署环境指向不同 API，不需要重新执行 Vite build。

## 2. Release Compose

`docker-compose.release.yml` 的启动顺序为：

```text
postgres healthy
    ↓
migrate (API image / prisma migrate deploy)
    ↓ success
api healthy
    ↓
web
```

附件数据存放在 `release_uploads` volume，PostgreSQL 数据存放在 `release_pgdata`。

## 3. GitHub Actions

触发器：

```yaml
on:
  push:
    tags:
      - 'v*.*.*'
```

流水线分为三层：

1. `verify`：校验 SemVer tag，固定 Node 24/pnpm 10.30.3，执行全仓 typecheck 和 lint。
2. `docker-smoke`：从 tag 对应源码真实构建 API/Web 镜像，并用隔离 PostgreSQL 验证 migration/runtime/proxy。
3. `images`：API/Web matrix 并行，通过 Buildx/QEMU 构建 `linux/amd64,linux/arm64`，登录 GHCR 后推送。

GHCR 写权限只授予 `images` job，其余 job 只有源码读取权限。

## 4. 镜像标签

以 `v0.0.1` 为例：

```text
ghcr.io/hideinmatrix/micromatrix-crm-api:v0.0.1
ghcr.io/hideinmatrix/micromatrix-crm-api:0.0.1
ghcr.io/hideinmatrix/micromatrix-crm-api:0.0
ghcr.io/hideinmatrix/micromatrix-crm-api:latest

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
