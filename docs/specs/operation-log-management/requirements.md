# LOG-002 操作日志详情与生命周期管理需求

## 1. 目标

LOG-001 已解决真实客户端 IP、默认 180 天自动清理和 Docker stdout/stderr 轮转，但当前操作日志仍存在两个平台治理缺口：

1. `operation_logs.detail` 直接保存在主表，列表查询会连同字段级 before/after diff 一起读取，长期运行后主表宽度和列表 I/O 会持续放大；
2. 保留天数只能通过环境变量调整，管理员无法在网页端查看当前策略、修改当前租户保留周期或主动执行一次受限清理。

项目内 CordysCRM 源码确认其操作日志采用“轻量主表 + 独立 Blob 表”存储，并提供列表与详情分离 API；Cordys 当前源码未发现 retention/cleanup UI 或自动清理。因此 LOG-002 继续保留 LOG-001 的生命周期治理作为 MicroMatrix 生产增强，同时吸收 Cordys 的主表/详情拆分方式。

用户已明确确认：**项目尚未正式上线，不存在需要迁移或兼容的旧数据**。因此本单元直接迁移到目标结构，不实现旧 `operation_logs.detail` 的回填、双写、兼容读取或渐进迁移。

## 2. 需求

### R1 操作日志主表与详情分离

- `operation_logs` shall 只保存列表和检索所需的轻量字段：租户、操作者、模块、动作、资源、IP、时间。
- 字段级变更详情、错误详情等可扩展 JSON shall 保存到一对一 `operation_log_blobs` 表。
- `operation_log_blobs.operationLogId` shall 同时作为主键和外键，主日志删除时通过数据库级 `ON DELETE CASCADE` 自动删除详情。
- `BusinessChangeLogService` shall 把 `{ changes: [...] }` 写入 Blob；其它显式详情写入场景 shall 同步迁移。
- 普通 `@LogOperation` 只产生摘要时 shall 不创建空 Blob。
- 本批 migration shall 直接删除 `operation_logs.detail`，不迁移已有 detail 数据。

### R2 列表与详情 API 分离

- `GET /logs/operations` shall 只读取列表字段，不 join、不 select Blob 详情。
- `GET /logs/operations/:id` shall 按当前租户读取单条日志及其 Blob，并返回完整详情。
- 详情接口必须使用 `tenantId + id` 边界，跨租户 ID shall 返回 404。
- shared contract shall 把列表 VO 与详情 VO 分开，禁止重新把 detail 放回分页列表契约。

### R3 租户级操作日志保留策略

- 每个租户 shall 可持久化独立的操作日志保留策略；其它租户不得读取或修改该策略。
- 未保存策略时有效默认值 shall 为 `OPERATION_LOG_RETENTION_DAYS`，缺省仍为 180 天。
- 网页允许配置 30～3650 天，或明确选择“永久保留”。
- `OPERATION_LOG_CLEANUP_BATCH_SIZE`、`OPERATION_LOG_CLEANUP_MAX_BATCHES` 和 Cron 时间继续是运维安全参数，不开放给网页管理员修改。
- 保存策略不得要求重启 API。

### R4 自动清理与手工清理

- 每日自动清理继续复用 `DistributedCoordinatorService` 的 DAILY slot，多实例只有一个调度实例执行。
- 自动清理 shall 按租户读取有效 retention；永久保留的租户 shall 跳过删除。
- 每个租户的删除仍 shall 先按 `createdAt` 取有界主键，再批量 `deleteMany`，禁止无界全表 DELETE。
- 手工“立即执行清理” shall 只清理当前租户，并继续服从 batchSize/maxBatches 上限。
- 手工清理在“永久保留”策略下 shall 不执行删除，并返回明确状态。
- 清理后 shall 保存当前租户最近清理时间、最近删除数量和触发来源（AUTO/MANUAL），供网页查看。
- Blob 详情 shall 由 FK cascade 随主日志删除，不写第二套清理循环。

### R5 权限与审计

- 日志列表、详情与策略读取使用 `system:log`。
- 策略保存与立即清理使用独立 `system:log:update`，不能因为用户能查看日志就自动获得生命周期修改权。
- `system:log:update` shall 作为 `system:log` 子权限进入统一权限树。
- 策略修改和手工清理 shall 进入现有操作日志链路；日志内容不得记录批量删除的明细 payload。

### R6 Web 管理体验

- `/system/logs` 的“操作日志”页 shall 增加“日志策略”入口，不新增左侧菜单。
- 策略界面至少展示：当前保留模式/天数、默认值来源、最近清理时间、最近删除数量、最近触发来源、每日自动清理说明。
- 有 `system:log:update` 时可修改保留策略和立即清理；只有 `system:log` 时保持只读。
- “永久保留”必须有容量增长警告；立即清理必须二次确认。
- 操作日志列表 shall 增加详情入口；有 Blob 时展示字段 diff/JSON，没有 Blob 时明确显示“无扩展详情”。

### R7 验收

- Prisma validate/generate/migrate shall 通过，数据库基线从 70 migrations 推进到 71。
- 专项测试至少覆盖：默认/租户 retention、永久保留、输入边界、租户隔离、列表不读取 Blob、详情读取 Blob、cascade 结构、手工清理边界、自动协调调用。
- API Rules、全仓 typecheck、lint、Web build、`git diff --check` shall 全绿。
- 使用本地开发 PostgreSQL 实际应用 migration；项目未上线，不执行旧 detail 回填验收。

## 3. 本批明确不做

- 不清理 `login_logs`，登录日志生命周期继续独立评估。
- 不把操作日志导出到 Elasticsearch/OpenSearch/Loki。
- 不做对象存储冷归档。
- 不兼容或回填旧 `operation_logs.detail` 数据。
- 不开放 batchSize/maxBatches/Cron 给网页修改。
