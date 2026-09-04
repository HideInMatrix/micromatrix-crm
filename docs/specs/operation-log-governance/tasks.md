# LOG-001 操作日志与运行日志治理任务

- [x] L1 现场审计与规格冻结
  - 确认 Nginx 已转发 `X-Real-IP` / `X-Forwarded-For`。
  - 确认 API 未配置 `trust proxy`，OperationLog 使用 `request.ip`，登录链路使用 `@Ip()`。
  - 确认 `OperationLog` 缺少全局 `createdAt` retention 索引与清理任务。
  - 确认复用 `DistributedCoordinatorService` DAILY slot。

- [x] L2 客户端 IP 基座
  - 增加受控 `TRUST_PROXY_HOPS` 解析并接入 API bootstrap。
  - 增加 `normalizeClientIp()`。
  - 接入密码登录、企微登录、OperationLog interceptor。
  - 增加 IP/config 单测。

- [x] L3 OperationLog retention
  - Prisma 增加 `createdAt` 独立索引及 migration。
  - `LogsModule` 增加每日清理服务。
  - 默认 180 天、1000/批、20 批/轮，可由环境变量调整。
  - 接入 DAILY distributed coordination 并增加专项测试。

- [x] L4 Docker 运行日志轮转
  - 根生产 Compose 增加统一 `json-file` logging anchor。
  - 长期服务默认 `20m × 5`。
  - 生产 API 默认 `TRUST_PROXY_HOPS=1`。
  - release env example 补充治理参数。

- [x] L5 验收
  - Prisma generate、专项测试。
  - lint / typecheck。
  - Compose config。
  - `git diff --check`。

- [x] L6 文档封板
  - 更新 alignment-log 与部署说明。
  - 记录默认保留周期、代理拓扑和运维调整方式。
  - L2～L5 全绿后标记 `LOG-001 VERIFIED`。

## 最终验收

- `TRUST_PROXY_HOPS` 默认关闭，生产 Compose 显式设置为 `1`；密码登录、企微登录与 `OperationLog` 全部使用 Nest/Express 解析后的 IP，再统一把 IPv4-mapped IPv6 规范化为 IPv4 文本。专项测试覆盖默认关闭、受控 hop、非法配置与 IP 规范化。
- `OperationLog` 默认保留 180 天；清理任务每天 04:15 执行，按 `createdAt` 选取最多 1000 条主键后删除，单轮最多 20 批，并复用 `operation-log-cleanup` DAILY coordination。专项测试证明 cutoff 使用严格 `lt`、不足一批立即停止、历史积压时严格停在 20 批。
- Prisma 增加 `operation_logs(createdAt)` 独立索引；`20260904093000_operation_log_retention_index` 已在本地开发 PostgreSQL 实际应用，数据库基线推进到 **70 migrations**，没有修改既有日志记录。
- 生产 Compose 的 PostgreSQL、Redis、API、worker、web 均使用 `json-file` 轮转，展开配置确认默认 `max-size=20m`、`max-file=5`；一次性 migrate 服务保持原策略。
- 最终验证：LOG-001 专项 **8/8 PASS**；新测试目录已纳入标准 `test:rules`，API Rules **179/179 PASS**；全仓 `pnpm typecheck` PASS；lint **0 error / 8 个既有 warning**；`docker compose --env-file docker/.env.release.example config --quiet` PASS；`git diff --check` PASS。
- 本批不清理 `login_logs`，不回写已有桥接 IP 历史值，也不引入 Loki/ELK 等外部日志平台。

当前状态：**VERIFIED**。
