# Operation Log 需求

## 1. 定位

Operation Log 是当前系统的审计基础能力，负责请求级操作摘要、字段变更详情、真实客户端 IP、租户级保留策略、自动/手工清理以及管理员日志查询。PostgreSQL 是审计真相源，不把操作日志外移到 Redis。

## 2. 写入

- `@LogOperation` 记录 tenant、操作者、module、action、target、IP、时间等摘要。
- 字段级 before/after、错误详情等大 JSON 写入一对一 Blob，不放回主表分页读取。
- `BusinessChangeLogService` 统一生成字段 diff；普通无详情操作不创建空 Blob。
- 登录日志和操作日志是两个独立生命周期，不因为操作日志清理而删除 LoginLog。

## 3. 客户端 IP

- 业务代码只使用 Nest/Express 已解析的 `request.ip / @Ip()`，不自行解析原始 X-Forwarded-For。
- `TRUST_PROXY_HOPS` 明确配置受控代理层数；非法值启动失败。
- Compose Web 直连 API 默认 1 hop；若前面还有 1Panel/Nginx 等受控代理，由部署环境显式调整。
- IPv4-mapped IPv6 统一规范化为 IPv4 文本。
- 密码登录、Provider 登录和 OperationLog 共用同一 IP 规范化逻辑。

## 4. 列表与详情

- `GET /logs/operations` 只读取轻量摘要，不 join Blob。
- `GET /logs/operations/:id` 按 tenant + id 读取摘要和扩展详情。
- 跨租户日志 ID 返回 404。
- Web 日志列表按需打开详情，不预加载大 JSON。

## 5. Retention

- 默认操作日志保留天数来自 `OPERATION_LOG_RETENTION_DAYS`，缺省 180 天。
- 租户可配置 30～3650 天或永久保留。
- 未显式配置时继续继承环境默认值；永久保留必须有明确状态，不用歧义空值。
- batchSize/maxBatches/Cron 时间仍属于运维安全参数，不开放给租户 UI。

## 6. 自动清理

- 每日自动清理由 `DistributedCoordinatorService.runScheduledOnce(...,'DAILY')` 去重。
- 按租户计算 effective retention，永久保留租户跳过。
- 每批先按 createdAt 选择有界 ID，再 deleteMany；禁止无界全表 DELETE。
- Blob 依赖 FK cascade 随主日志删除。
- 一个租户清理失败只记录错误并继续其它租户。

## 7. 手工管理

- “清理过期日志”只执行当前租户 retention。
- “清空全部操作日志”删除当前租户全部 OperationLog，与 retention 无关。
- 两个动作使用不同 API、按钮和确认文案。
- 全量清空要求 `system:log:update`，前端必须危险级二次确认并要求输入 `清空`。
- 全量清空接口本身不写新的 OperationLog，否则会破坏“清空全部”语义。
- 清理接口返回真实 deleted 数量，并更新最近清理时间/数量/来源。

## 8. Docker 运行日志

- 长期容器统一使用 json-file rotation，默认 `20m × 5`。
- migrate 是一次性 job，不要求长期轮转策略。
- Docker stdout/stderr 轮转与数据库 OperationLog 是不同层次，不能互相替代。

## 9. 权限与验收

- `system:log`：列表、详情、策略读取。
- `system:log:update`：策略修改、过期清理和全量清空。
- 策略修改与手工过期清理进入操作日志；全量清空除外。
- 验收覆盖 tenant 隔离、Blob 分离、retention、permanent、批次上限、DAILY coordination、clear-all 和真实 proxy IP。
