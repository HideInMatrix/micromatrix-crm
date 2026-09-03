# W3.4-D Docker 发布链路需求

## 1. 目标

在继续 W3.4.2 线索与线索池前插入一个独立工程化执行单元，为 MicroMatrix CRM 建立前后端分离的 Docker 发布能力，并以 Git tag 作为唯一自动发布触发入口。

## 2. 范围

### R1 运行职责独立镜像

- API、Migration 与 Web 必须按职责分别构建镜像，不能把 NestJS、Prisma CLI 与 Web 静态资源塞进同一个常驻容器。
- API 使用 Node 24 生产运行时；Web 使用 Nginx 提供静态资源。
- workspace 共享包必须在镜像构建阶段正常参与编译，不能依赖宿主机 `node_modules` 或预先生成的 `dist`。

### R2 生产运行契约

- Web 浏览器请求继续使用相对 `/api`，由 Nginx 在运行时通过 `API_UPSTREAM` 转发到独立 API 服务。
- Vue Router 必须支持 history fallback，直接访问 `/login`、业务详情页等不能返回 404。
- SSE/长连接代理必须关闭响应缓冲并允许长 read timeout。
- API 附件目录 `/app/uploads` 必须作为持久化卷边界。
- API runtime 不携带 Prisma CLI；独立 Migration 镜像负责 `prisma migrate deploy`，成功后 API 才允许启动。
- `.env`、本地上传文件、Cordys 源码、Git 数据和构建产物不得进入 Docker build context。

### R3 Tag 驱动 GitHub Release

- `.github/workflows/release-docker.yml` 只在 `v*.*.*` tag push 时触发。
- 标准发布流程为：

```bash
git tag v0.0.1
git push origin v0.0.1
```

- workflow 必须拒绝不符合 `v<major>.<minor>.<patch>` 语义版本格式的 tag。
- 源码 typecheck/lint 和 Docker runtime Smoke 未通过时不得推送镜像。

### R4 GHCR 与多架构

- 发布目标为 GitHub Container Registry：
  - `ghcr.io/<owner>/<repo>-api`
  - `ghcr.io/<owner>/<repo>-migrate`
  - `ghcr.io/<owner>/<repo>-web`
- 镜像名必须转换为小写，避免 Docker repository name 大小写错误。
- 每个 release 同时构建 `linux/amd64` 与 `linux/arm64`。
- 至少生成原始 tag、SemVer version、major.minor 与 `latest` 标签。

### R5 可复现部署与验收

- 提供 `docker-compose.release.yml` 和无真实密钥的 release 环境变量示例。
- Redis 作为 API cache runtime 时必须启用密码、内部网络、volume 与 healthcheck，默认不得发布宿主机端口；Redis 不得成为 API 冷启动硬依赖，Migration 也不依赖 Redis。
- migration 成功后 API 才启动；Redis 未就绪时 API 仍按数据库路径启动，Redis 恢复后缓存客户端自动重连；API 健康后 Web 才启动。
- 提供 `pnpm smoke:docker-release`：真实构建三个镜像、启动隔离 PostgreSQL/Redis、执行全部 migration、启动 API/Web，并验证 Redis 缓存集成、健康检查、SPA fallback 与 `/api` proxy。

## 3. 不在本执行单元内

- Kubernetes/Helm。
- 自动部署到生产服务器。
- Docker Swarm。
- GitHub Release 二进制附件。
- 自动创建 Git tag；tag 由发布者显式创建并 push。
