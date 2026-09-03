# ASYNC-001 BullMQ 异步导出中心需求

## 1. 背景与目标

MicroMatrix 已有 `ExportTask`、导出任务抽屉、下载/清理和 24 小时保留契约，但当前 `ExportTasksService.create/createFromBuffer` 仍在 HTTP 请求生命周期内完成业务数据全量查询、ExcelJS 构建和文件写盘，接口返回时任务已经是 SUCCESS/FAILED，属于“任务外壳 + 同步执行”。

CordysCRM 的 `BaseExportService.asyncExport` 会先创建 PREPARED 任务并立即返回 taskId，再由后台执行器分批查询、生成文件并更新 SUCCESS/STOP/ERROR；同时限制用户待处理任务数量、阻止同资源类型重复堆积、支持取消与 24h 清理。

ASYNC-001 目标是引入 BullMQ durable queue，将现有 CRM xlsx 导出真正移出 HTTP API 进程，并保持现有导出任务 UI/API 契约尽量稳定。

## 2. 功能需求

### R1 BullMQ 平台基座

- 引入 BullMQ，队列固定用于异步导出，业务模块不得自行创建 Queue/Worker/Redis client。
- Queue job payload 只携带轻量标识 `{ taskId }`，不得把 Excel Buffer、全量业务 rows、JWT、密码或企业 Secret 放入 Redis。
- ExportTask 的业务请求参数持久化到 PostgreSQL，Redis/BullMQ 只承担 durable delivery；PostgreSQL 继续是用户可见任务状态真相源。
- Producer enqueue 必须 fail-closed：Redis/Queue 不可用时接口返回 503，不得返回一个实际上不会执行的 PENDING 任务。
- API 整体启动仍不把 Redis 作为登录/CRM 基础能力硬门槛；仅异步导出能力在 queue unavailable 时不可用。

### R2 独立 worker runtime

- 新增独立 worker 入口，不在 HTTP API 进程内执行 Excel 构建。
- release Compose 使用同一 API 镜像启动 `worker` 服务，API 与 worker 共享 `release_uploads` 卷。
- worker 不启动 HTTP server，不注册业务 Cron；只消费导出 queue。
- 一个或多个 worker 实例可同时运行，单个 job 只由一个 BullMQ worker 处理。
- 默认并发度可通过环境变量调整，并设置保守默认值避免 ExcelJS 并行导致内存峰值失控。

### R3 ExportTask 持久任务契约

ExportTask 增加执行恢复所需字段：

- `payload Json?`：冻结后的轻量导出请求参数。
- `startedAt DateTime?`：第一次真实执行时间。
- `attempts Int`：worker 实际执行次数。

继续保留现有：tenant/user/module/fileName/status/filePath/rowCount/fileSize/errorMessage/completedAt/expiresAt。

状态仍维持前端兼容集合：`PENDING / SUCCESS / FAILED / CANCELED`；PENDING 同时覆盖 waiting/retrying/running，worker 是否已启动由 `startedAt/attempts` 内部观测，不新增前端破坏性状态。

### R4 创建任务与并发限制

- HTTP 导出请求只做权限/DTO/文件名与必要轻量校验，持久化 query/headList/ids/poolId 等请求参数后 enqueue，立即返回 PENDING task。
- 不允许在 enqueue 前执行全量 `collectExportItems`、Excel 构建或文件写盘。
- 对齐 Cordys：同一用户最多 10 个 PENDING 导出任务。
- 对齐 Cordys：同一用户 + module 同时最多 1 个 PENDING 导出任务，避免重复点击形成相同重任务堆积。
- 上述 count/duplicate 判断和任务 create 必须在 PostgreSQL user-scoped advisory transaction 内串行，保证多 API 实例下成立。
- DB task create 成功但 queue add 失败时删除该新任务并返回 503。

### R5 worker 重新取数与权限

- worker 根据 taskId 从 PostgreSQL读取 task + payload，再按 module 路由到对应业务 service。
- worker 重新读取当前用户及角色权限并构造 AuthUser，不信任提交时缓存的权限快照。
- 用户已禁用/删除、权限变化、资源不可见、字段已删除等情况由现有业务查询/Metadata/DataScope 规则重新判定；不可恢复的业务错误直接 FAILED，不做无意义重试。
- 当前所有已有异步导出入口纳入首批：
  - customer / customer_pool
  - contact
  - lead / lead_pool
  - opportunity
  - product / price
  - businessTitle / contractInvoice
  - contractPaymentPlan / contractPaymentRecord
  - order
- 子表导出（price/order）必须在 worker 中构建，不允许在 HTTP 请求侧提前生成 Buffer。

### R6 retry / recovery

- transient worker failure 使用 BullMQ attempts + exponential backoff，默认 3 次。
- 每次 processor 进入时原子增加 ExportTask.attempts；第一次执行设置 startedAt。
- 最后一次失败后写 FAILED + errorMessage + completedAt；业务 4xx/权限/数据校验类错误直接 final failed。
- worker/API 重启后扫描仍为 PENDING 且未过期的 ExportTask，并确保对应 BullMQ job 存在；不存在则以 task.id 作为 jobId 重新入队。
- 如果 Redis 中同 jobId 已处于 waiting/delayed/active，则 recovery 不重复入队；如果 DB 仍 PENDING 而 BullMQ job 已 completed/failed，允许清理旧 job 后重新入队，保证 DB task 能最终收敛。

### R7 cancel / cleanup

- DELETE/清理 PENDING 任务时先将 DB 状态改为 CANCELED，再 best-effort 移除 waiting/delayed job。
- active job 不做线程级强杀；worker 在业务构建前后及文件落盘后检查 DB 状态。任务已 CANCELED 时不得更新 SUCCESS，若文件刚生成则删除。
- SUCCESS/FAILED/CANCELED 的现有“清理”行为继续允许，文件存在时删除文件并把任务标为 CANCELED，保持现有前端入口兼容。
- 24h 到期清理继续以 PostgreSQL expiresAt 为准；不能依赖 BullMQ removeOnComplete 代替业务文件/任务清理。

### R8 可观测

- `/health` 增加 asyncJobs/exportQueue 指标：enabled、producer enqueue success/failure、worker started、active/completed/failed/retried/canceled/recovered 等计数。
- 不在 health/log 中暴露 Redis password、完整 payload、客户数据、文件内容。
- worker 日志包含 taskId/module/tenantId 与失败摘要，避免输出导出行内容。

## 3. 验收要求

- producer 测试：创建只持久化轻量 payload，不调用业务 collect/build；queue add failure 删除 task 并返回 503。
- 并发测试：同用户第 11 个 PENDING 被拒；同用户同 module 第二个 PENDING 被拒。
- worker 测试：从 task payload 重新加载当前 AuthUser，路由到正确 handler，SUCCESS 写 filePath/rowCount/fileSize。
- retry 测试：transient error 重试，最后失败才写 FAILED；业务 BadRequest/Forbidden 直接 final failed。
- cancel race 测试：active build 完成前任务被取消，最终不能覆盖为 SUCCESS，生成文件被清理。
- recovery 测试：DB PENDING + queue missing 可恢复；已 waiting/active 不重复。
- 当前 13 类 module routing 全覆盖。
- 真实 Redis + PostgreSQL + worker smoke：HTTP/producer 创建任务后立即得到 PENDING，worker 异步生成文件，最终 SUCCESS 可下载；停止 worker 后任务保持 PENDING，重启 worker 后恢复完成。
- API typecheck、worker build、完整 Rules、`git diff --check` 全绿。
- release Compose config 验证 worker 与 API 共享 uploads，worker 依赖 migrate + redis health，不对外暴露端口。

## 4. 非本批范围

- 不把 6 个 `@Cron` 迁移 BullMQ；COORD-001 的 Scheduler 时间槽协调保持不变。
- 不把 MessageDelivery outbox 迁移 BullMQ；数据库 outbox/CAS/retry 语义保持不变。
- 不异步化导入；导入包含逐行校验/部分成功反馈，需单独定义任务结果协议。
- 不实现 EnterpriseGlobalTask 真正执行器；现有 execution 记录继续作为独立业务能力。
- 不引入 Redis Streams/Kafka/RabbitMQ。
- 不在本批处理 SEQ-001 业务流水号。
