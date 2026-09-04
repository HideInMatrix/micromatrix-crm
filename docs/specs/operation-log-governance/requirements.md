# LOG-001 操作日志与运行日志治理需求

## 1. 目标

在不改变 PostgreSQL 作为审计数据真相源的前提下，解决当前生产 Docker 拓扑中的三类长期运行问题：操作日志记录到容器桥接地址而非真实客户端 IP、`operation_logs` 无生命周期导致数据库持续增长、容器 stdout/stderr 使用 Docker 默认日志策略导致宿主机磁盘不可控增长。

本执行单元编号固定为 `LOG-001`。本批只治理现有操作/登录 IP 获取、操作日志保留与 Compose 容器日志轮转，不扩展为新的审计平台、日志检索平台或外部日志采集系统。

## 2. 范围

### R1 真实客户端 IP 与代理安全边界

- API 必须以 Express/Nest 已解析的 `request.ip` / `@Ip()` 为唯一客户端 IP 来源，业务代码不得自行取原始 `X-Forwarded-For`、`X-Real-IP`。
- 本地直接运行 API 时默认不信任代理头；调用方伪造 `X-Forwarded-For` 不得覆盖 socket peer IP。
- 生产 Compose 固定为 `client -> web/nginx -> api` 单代理拓扑，API 默认只信任 1 个代理 hop。Nginx 继续负责覆盖 `X-Real-IP` 并通过 `$proxy_add_x_forwarded_for` 追加真实远端地址。
- 代理 hop 必须通过明确的非负整数环境变量配置；非法值必须在 API 启动阶段失败，禁止静默退化为 `trust proxy=true`。
- IPv4-mapped IPv6（例如 `::ffff:192.168.1.10`）统一规范化为 IPv4 文本；原生 IPv6 地址保持原值。
- 密码登录、企微登录与 `@LogOperation` 操作日志必须共用同一 IP 规范化逻辑。

### R2 操作日志保留策略

- `OperationLog` 默认保留 180 天，通过 `OPERATION_LOG_RETENTION_DAYS` 可配置；配置必须为正整数。
- 自动清理每天执行一次，只删除严格早于保留截止时间的 `operation_logs`，不得影响 `login_logs`、业务变更记录或其它审计表。
- 清理必须按 `createdAt` 小批量选取主键后 `deleteMany`，默认批次大小 1000，通过 `OPERATION_LOG_CLEANUP_BATCH_SIZE` 可配置。
- 单次定时执行必须设置最大批次数，默认 20 批，通过 `OPERATION_LOG_CLEANUP_MAX_BATCHES` 可配置，防止历史积压时一次任务长时间占用数据库。
- `operation_logs.createdAt` 必须具有独立索引，使跨租户过期扫描不依赖 `(tenantId, createdAt)` 索引前缀。
- 清理过程中任一批失败不得影响 API 主请求链路；错误写入应用日志，下一个调度周期可继续处理剩余历史记录。

### R3 多实例定时协调

- 自动清理复用现有 `DistributedCoordinatorService.runScheduledOnce(..., 'DAILY')`，不得新增第二套 Redis lock、Redlock 或协调表。
- Redis 正常时同一 UTC day slot 只能由一个 API 实例进入清理核心逻辑。
- Redis 不可用时继续使用现有 PostgreSQL advisory transaction fallback；业务数据库仍是最终保护。
- 清理核心方法必须可独立调用，便于专项测试和人工维护，不把全部逻辑隐藏在 Cron wrapper 中。

### R4 Docker 容器日志轮转

- 根 `docker-compose.yml` 继续作为唯一生产 Compose 真相源。
- PostgreSQL、Redis、API、worker、web 等长期运行容器使用 Docker `json-file` 驱动并配置轮转；默认 `max-size=20m`、`max-file=5`。
- 一次性 `migrate` 容器不要求套用长期运行日志轮转策略。
- 日志轮转只约束 Docker stdout/stderr 文件，不改变应用日志格式，不在本批引入 Loki、ELK、Fluent Bit、OpenTelemetry Collector。
- 轮转参数可通过 Compose 环境替换配置，生产默认值必须在仓库中可见且安全。

### R5 兼容与数据安全

- 不重写既有 `operation_logs.ip` 历史值；修复只影响之后产生的记录。
- 不因日志治理执行数据库 reset、truncate 或全表无界 DELETE。
- `OperationLog` 现有租户分页、模块筛选和关键字查询 API 语义保持不变。
- PostgreSQL/Redis volume、上传文件 volume 和业务数据不得因 Compose 日志策略发生变化。

### R6 验收

- 单元测试必须覆盖 trust-proxy hop 解析、IPv4-mapped IPv6 规范化、保留时间边界、批量删除上限与 DAILY coordination 调用。
- Prisma migration 必须只增加清理所需索引，不修改已有操作日志数据。
- `pnpm lint`、`pnpm typecheck`、相关专项测试、`docker compose config --quiet` 与 `git diff --check` 必须通过。
- Compose 展开结果必须证明 API 使用 1 hop 默认代理配置，长期服务存在 `20m × 5` 默认日志轮转。

## 3. 本批明确不做

- 删除或定期清理 `login_logs`。
- 将操作日志同步到 Elasticsearch/OpenSearch/Loki。
- 为每个租户提供独立日志保留天数 UI。
- 解析任意多层 CDN/负载均衡拓扑；如果未来在 Nginx 前增加受控代理，需要显式调整 hop 配置并重新验收。
- 审计日志归档到对象存储或冷存储。
