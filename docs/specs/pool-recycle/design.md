# Pool Recycle 设计

## 1. 设计目标

将当前每天固定时刻批量扫描的自动回收，升级为「业务事件驱动的延迟检查 + PostgreSQL 持久化计划 + 可靠投递/恢复」。测试环境可临时配置 `领取时间 + 2 分钟` 验证延迟任务是否按时触发；这只是测试阈值，不是生产默认值。正常队列运行时以到期后数秒内触发为目标，不承诺毫秒级准时。单纯把 Cron 改成每分钟会让全量资源反复扫描，且仍有接近一分钟的固有延迟，因此不采用每分钟全量补偿。

## 2. 当前实现与边界

当前 `PoolRecycleService` 使用 `@Cron('0 30 2 * * *')` 每天 02:30 执行 `recycleAll()`，读取租户启用自动回收的池及负责人名下资源，再通过 `ResourceRecycleConditionEvaluator` 判断时间条件。真正的移池操作由 `CluePoolRepository.recycle()` / `CustomerPoolRepository.recycle()` 完成。

当前项目已使用 BullMQ 6.x、ioredis、Redis AOF、独立 `dist/worker.js` Worker；现有 `AsyncJobsService` 主要服务异步导出，`WorkerAppModule` 目前注册导出 Worker。生产 Compose 已有独立 worker 容器，无需增加新的 Redis 或单独部署一套 Worker 容器。

## 3. 推荐架构

```text
领取 / 分配 / 转移 / 跟进 / 池规则修改
  -> PostgreSQL transaction
       -> 更新资源时间与状态
       -> upsert PoolRecycleTask（持久化计划 / Outbox）
  -> commit
  -> Dispatcher 投递 BullMQ delayed job（独立 pool-recycle queue）
       -> Worker 到期触发
            -> 读取 task + 最新资源 + 最新池规则
            -> ResourceRecycleConditionEvaluator 重新判断
            -> 事务锁 + CAS
            -> 复用现有 Repository.recycle()
            -> 更新任务状态、发送现有业务通知

Outbox Dispatcher + Worker bootstrap recovery + 低频 reconciliation
  -> 投递尚未成功 enqueue 的计划
  -> Worker 启动时恢复 PostgreSQL 中 Redis 缺失的计划
  -> 低频核对 Redis job 与 PostgreSQL 计划是否一致
```

### 3.1 PostgreSQL 回收计划

建议新增 `PoolRecycleTask`，作为任务计划和可靠投递记录。每个租户、资源类型、资源 ID 保留一条当前计划，核心数据包括：

- `tenantId`、`resourceType`（lead/customer）、`resourceId`、当前解析出的 `poolId`。
- `dueAt`：下一次需要执行检查的时间；无法安全推导边界的规则由专门的低频校准/业务规则处理负责，不通过每分钟扫描所有资源实现。
- `expectedOwnerId`、`expectedCreateTime`、`expectedCollectionTime`、`expectedFollowTime` 和 `ruleFingerprint`：计划创建时的业务快照，用于识别旧任务和规则变化。
- `generation`：每次领取/跟进/规则变化时递增，旧 generation 不能影响新周期。
- `status`：PENDING、QUEUED、PROCESSING、COMPLETED、CANCELED、FAILED 等状态。
- `attempts`、`lockedUntil`、`lastError`、`createdAt`、`updatedAt` 等运维字段；Worker 异常退出后，过期 PROCESSING lease 可被恢复；达到有限重试上限后标记 FAILED 并进入可观测/人工恢复流程。

建立 `(tenantId, resourceType, resourceId)` 唯一约束和 `status + dueAt`、资源定位索引。计划更新应与资源时间戳变更同事务提交；队列投递失败时保留 PENDING，由恢复流程重新投递。

### 3.2 BullMQ 队列

- 新增独立 `pool-recycle` Queue，与现有 `export` Queue 隔离，避免导出任务占满并发影响回收时效。
- 复用当前 Redis 连接配置、统一 key prefix、现有 worker 容器和 `dist/worker.js` 入口；抽取共享 BullMQ 连接/生命周期能力，避免复制 Redis 配置逻辑。
- Queue job payload 只传 `taskId` 和 `generation`，不携带业务记录、负责人、规则或敏感信息。
- jobId 使用计划 ID + generation 形成稳定唯一值；新计划尽力移除旧 delayed job，无法移除时由 generation 校验保证旧任务 no-op。
- 延迟值为 `max(0, dueAt - now)`。Worker 并发独立配置，避免与导出 Worker 相互饥饿。
- BullMQ 是 at-least-once delivery，不承诺毫秒级准时；最终正确性由 PostgreSQL 计划状态和资源 CAS 保证。

### 3.3 计划计算与多条件语义

`ResourceRecycleConditionEvaluator` 继续作为唯一业务判断来源，不复制一套规则解释器。应将动态阈值解析和时间边界计算抽成 evaluator 与 scheduler 共用的纯函数，避免两处对分钟/小时/月边界产生语义分歧。新增计划计算器只负责计算下一次可能改变规则结果的时间边界：

- `storageTime + Picked`：以当前 `collectionTime` 为锚点。
- `storageTime + Created`：以 `createTime` 为锚点。
- 同时选中 Created 和 Picked：计划时间必须覆盖两个锚点，不能因较早的创建时间提前回收。
- `followUpTime`：以当前 `followTime` 为锚点；每次跟进后刷新 generation 和 dueAt。
- `CUSTOM,n,BEFORE_MINUTE/HOUR/DAY/WEEK/MONTH`：计算锚点加 duration 的到期边界。现有旧格式继续兼容。现有 evaluator 使用严格的“早于”比较，到期任务若恰好在边界时刻执行且条件尚未满足，应安排极短延迟复查，不能提前回收。
- AND / OR：到期任务触发后重新计算整组条件；如果尚未满足但存在后续可达边界，更新计划并再次延迟投递；如果条件已满足则进入回收事务。固定区间及日历区间条件不强行转为单一 duration，交由下一次边界或补偿扫描处理。
- 无法安全推导下一边界、规则无效或字段时间为空时，不得猜测回收时间；保留补偿扫描和现有 evaluator 的安全结果。

### 3.4 业务事件接入

在所有会改变回收锚点或资格的写路径中更新计划：

- 线索/客户从池领取成功后，使用事务内新 `collectionTime` 建立计划。
- 创建时直接分配负责人、负责人转移或重新分配后，使用新的领取时间建立计划。
- 跟进记录与目标资源 `followTime` 同事务更新时，刷新回收计划。
- 进入线索池/客户公海、转换客户、删除、负责人清空或客户命中跟进完结时，取消/失效当前计划。
- 池规则或自动回收开关更新后，对受影响池内已分配资源批量递增 generation 并重建计划；关闭或停用时取消计划。

事务内只写 PostgreSQL 计划/Outbox，不在数据库事务中等待 Redis。commit 后由 Dispatcher 尽快投递 BullMQ；若进程在 commit 后、enqueue 前崩溃，Outbox 记录仍为待投递状态，Dispatcher 恢复后继续投递。Dispatcher 只扫描待投递/失败记录，不扫描全部在线资源。

### 3.5 Worker 执行与并发安全

Worker 收到任务后：

1. 通过 `taskId + generation` 读取当前计划；计划不存在、已取消、generation 不匹配或已完成则 no-op。
2. 从 PostgreSQL 重新读取资源、负责人、租户、所属池、当前池规则和最新时间字段，不信任 job payload 快照。
3. 检查资源仍归当前负责人、未进入池、未删除/转化；检查池启用且自动回收开启。
4. 客户执行 `CustomerFollowUpCompletionService` 最新完结判断；命中完结或完结规则失效时遵循现有安全策略。
5. 调用 `ResourceRecycleConditionEvaluator.matches()` 对当前时间和最新时间戳重新判断。未命中则计算下一边界并重新排程，不能直接回收。
6. 命中时进入 Repository 事务，使用现有资源锁并对 owner、collectionTime、followTime、pool/shared 状态及 generation 做 CAS。任何字段已变化即放弃本次回收。
7. 复用现有 `CluePoolRepository.recycle()` / `CustomerPoolRepository.recycle()` 的负责人历史和系统回收原因；成功后将计划标记完成，并确保通知/操作记录仅一次。

跟进写入和回收之间必须有明确的数据库竞争结果：若跟进先提交，回收 CAS 失败；若回收先成功，后续跟进写入必须重新校验资源仍可跟进，不能把已回收资源更新成仍由个人负责。

### 3.6 恢复与补偿

- Worker 启动时扫描 PostgreSQL 中尚未完成的计划：若对应 generation 的 BullMQ job 缺失则补发；若 job 已存在则保留；过期 generation 的 job 视为陈旧。FAILED 不自动无限重试。
- Outbox Dispatcher 持续重试 PENDING/投递失败记录；Redis 暂时不可用时保留 PostgreSQL 计划，不丢弃业务意图。Dispatcher 只处理待投递记录，不按分钟全量扫描资源。
- 可选低频 reconciliation（建议每 15–30 分钟，具体间隔按可接受的异常恢复时间决定）核对已投递计划与 Redis job 是否一致，并修复 Redis 数据丢失等少见情况；它不是正常回收触发器，也不参与 2 分钟延迟验收。
- 具有明确时长阈值的动态规则由延迟任务触发，不再依赖每天 02:30 的批量扫描；固定区间和日历区间旧规则暂时保留每天 02:30 的兼容扫描。不要求每分钟执行全量补偿。
- 失败任务记录错误和尝试次数；瞬时故障有限指数退避。资源已变化、池已关闭等确定性状态属于 no-op/canceled，不反复重试。

## 4. 模块与部署边界

- `PoolRecycleService` 保留领域判断和现有通知语义，拆分计划管理、计划计算、任务投递与 Worker 执行职责。
- `AsyncJobsService` 当前偏向导出任务。实施时应抽取共享 BullMQ connection/runtime，或新增专用 `PoolRecycleJobsService`；不应把导出与回收混成同一 Queue。
- 在现有 `WorkerAppModule` 注册 `PoolRecycleWorkerModule`，并显式导入其所需的 PoolRules、ModuleForms、Notifications、Common、Prisma 等模块依赖。
- 继续使用现有 worker 容器、镜像和 `dist/worker.js`；Compose 只需按需要增加队列并发配置，不新增 Redis 实例。
- 由于增加 PostgreSQL 持久化任务表，需要按项目 Prisma ORM 8 migration policy 更新 contract、生成产物和 forward migration；不允许只依赖 Redis 保存计划。

## 5. 观测

至少观测：PENDING 计划数、已到期未执行数、BullMQ delayed/waiting/active/failed 数、最老 overdue 时间、投递失败/重试数、成功回收数、因状态变化 no-op 数。健康状态不暴露线索姓名、电话、负责人隐私或 Redis Secret。

## 6. 测试策略

- Evaluator 单元测试：分钟阈值边界、小时/天兼容、Created/Picked、多字段 AND/OR、缺失 followTime、固定时间和区间条件。
- Scheduler 单元测试：dueAt 计算、规则修改 generation、重新领取/跟进刷新、旧任务取消、AND/OR 下一边界。
- PostgreSQL + Redis 集成测试：事务提交后投递、enqueue 失败恢复、Redis 重启、Worker 重启、重复 job、延迟 job 到期、失败重试。
- 并发测试：跟进与回收竞争、重复领取、负责人转移与旧任务竞争、手动移池与自动回收竞争。
- 端到端测试：测试环境临时将领取时间阈值配置为 2 分钟；创建线索并移入池；由张伟领取；不跟进，验证由 BullMQ 延迟任务在约 2 分钟后回收；另测 2 分钟内跟进后旧任务不回收、重新领取重置计时。测试时禁用/隔离低频 reconciliation 对该场景的影响，确保验证的是主延迟任务。
- 同样覆盖客户公海及客户跟进完结规则；PC 配置页与移动端实际操作均按项目强制自测规范验收。
