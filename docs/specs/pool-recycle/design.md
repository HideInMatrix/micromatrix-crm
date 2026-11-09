# Pool Recycle 设计

> **实现状态：核心功能已实现。** 截至 2026-11-09，线索池与客户公海的「领取后 2 分钟」真实后端闭环均已通过本地 PostgreSQL、Redis、BullMQ 和 Worker 验证，覆盖无跟进和新增跟进重新计时。PC/H5 页面视觉验收，以及 Redis/Worker 故障恢复和并发边界专项集成测试仍待补齐；不能将这些未执行的测试标记为通过。

## 1. 设计目标与边界

线索池和客户公海的动态时间回收采用「业务时间变更时持久化计划、BullMQ 延迟唤醒、Worker 到期后重新判断、Repository 事务完成回收」的方式。PostgreSQL 是计划与业务状态的事实源，Redis/BullMQ 只承担延迟投递。

2 分钟只用于本地/测试环境验证调度能力，不是生产默认回收时间。正常运行时以到期后数秒内执行为目标，不承诺毫秒级准时。每天 02:30 的既有扫描仍保留作兼容兜底，不是分钟级动态时间规则的主要触发机制。

## 2. 当前实现结构

```text
业务写入（创建、分配、领取、转移、跟进、池规则变更）
  -> PostgreSQL transaction
       -> 更新线索/客户业务字段
       -> upsert / cancel PoolRecycleTask
  -> commit
  -> PoolRecycleWorkerService 每 5 秒派发 PENDING 计划
       -> AsyncJobsService 投递 pool-recycle 延迟任务
       -> BullMQ Worker 到期执行
            -> 读取 PostgreSQL 最新计划、资源和池规则
            -> ResourceRecycleConditionEvaluator 重新判断
            -> Repository 事务锁 + CAS
            -> 回收至原所属池，写负责人历史
            -> 发送现有自动回收通知
```

主要代码位置：

- `PoolRecycleTaskService`：计划创建、刷新、取消、派发、恢复和状态管理。
- `ResourceRecycleConditionEvaluator`：规则匹配及下一次动态时间边界计算。
- `PoolRecycleService`：到期后的业务校验、池解析、回收调用和通知。
- `CluePoolRepository` / `CustomerPoolRepository`：事务锁、预期状态校验、负责人历史及回收状态变更。
- `AsyncJobsService`：独立 BullMQ Queue、Producer 和 Worker 生命周期。
- `PoolRecycleWorkerService`：Worker 启动恢复、待派发计划扫描及任务执行。
- `LeadPoolConfigDrawer.vue` / `CustomerPoolConfigDrawer.vue`：PC 端线索池与客户公海规则配置。

## 3. PostgreSQL 计划表

`pool_recycle_task` 每个租户、资源类型和资源 ID 保留一条当前计划，并通过唯一索引保证唯一性。主要字段：

- 资源定位：`organizationId`、`resourceType`、`resourceId`、`poolId`。
- 时间与状态：`dueAt`、`status`、`generation`。
- 执行快照：`expectedOwnerId`、`expectedCreateTime`、`expectedCollectionTime`、`expectedFollowTime`、`ruleFingerprint`。
- 运维信息：`attempts`、`lockedUntil`、`lastError`、创建/更新时间。

状态包括 `PENDING`、`QUEUED`、`PROCESSING`、`COMPLETED`、`CANCELED`、`FAILED`。`PENDING` 同时承担持久化待派发记录的 Outbox 职责，不另设第二张 Outbox 表。

资源时间戳或池规则变化时，在同一 PostgreSQL 事务内刷新计划并递增 generation。无有效池、规则或负责人时取消计划。旧 generation 即使仍在 Redis 中，也不能改变新业务周期。

## 4. BullMQ 延迟队列与恢复

- 独立 Queue：`pool-recycle`，使用统一 prefix `micromatrix-crm:bull`，与 Export Queue 隔离。
- Job payload 仅包含 `{ taskId, generation }`；稳定 Job ID 为 `poolrecycle-<taskId>-<generation>`，不携带线索、客户、负责人或规则快照。
- 延迟时间由 `max(0, dueAt - now)` 计算，并按 BullMQ 单次延迟上限分段唤醒；Worker 每次唤醒后重新计算下一边界。
- Queue 默认最多尝试 3 次，使用 2 秒起始指数退避；完成与失败 Job 分别按保留策略清理。
- `PoolRecycleWorkerService` 启动时先补建缺失计划，再恢复 PostgreSQL 中未完成且 Redis Job 缺失的任务。
- Worker 内的 Dispatcher 每 5 秒只扫描 PostgreSQL 中 `PENDING` 计划；派发失败会记录次数和错误并退避，最多 10 次后进入 `FAILED`。它不是每分钟扫描全部线索/客户的补偿任务。
- 当前没有独立的 15–30 分钟 Redis Job reconciliation 定时器；缺失 Job 的恢复发生在 Worker 启动恢复流程中。

## 5. 时间边界与规则语义

`ResourceRecycleConditionEvaluator` 同时负责最终 `matches()` 判断和 `nextDueAt()` 调度边界计算，避免调度逻辑与业务规则分叉。

- `storageTime + Picked`：以当前 `collectionTime` 为锚点。
- `storageTime + Created`：以 `createTime` 为锚点。
- 同时选择 Created 和 Picked：AND 语义下以较晚到期边界为准。
- `followUpTime`：优先以当前 `followTime` 为锚点；`followTime` 为空（从未跟进）时回退到最近一次领取时间 `collectionTime`。每次跟进提交后刷新计划和 generation；跟进时间缺失且领取时间也缺失时，不创建计划。该 evaluator 同时服务线索池和客户公海。
- 分钟、小时、天、周、月动态阈值使用锚点加时长计算；保留旧格式解析兼容。
- 现有比较采用严格的“早于”语义，计划边界增加 1ms，避免恰好到达阈值时提前回收。
- AND / OR、固定时间范围、TODAY/LAST_SEVEN 等既有条件仍由 evaluator 完整判断。延迟 Job 只负责唤醒，不直接决定回收。
- 无法安全计算边界或条件尚未满足时，不得猜测回收；由 evaluator 和后续计划刷新保持安全结果。

## 6. Worker 执行与并发安全

Worker 通过 `taskId + generation` 获取当前计划并领取执行锁，然后重新读取 PostgreSQL 中的资源、负责人、所属池、当前规则和时间字段。队列 payload 不作为业务事实来源。

执行前检查：

- 租户、资源类型、资源 ID、目标池和计划快照一致。
- 资源仍由有效负责人持有且未进入池；线索尚未转化。
- 目标池仍启用且自动回收开启，当前规则仍有效。
- 当前资源时间字段与计划快照一致，evaluator 重新判断当前条件已满足。
- 客户仍未命中管理员配置的跟进完结规则；规则字段失效时暂停该客户自动回收。

满足条件后，Repository 使用事务锁和带预期负责人、时间戳、generation 的条件更新（CAS）完成移池，保留负责人历史并写入系统回收原因。并发跟进、重新领取、转移负责人、手动移池或重复投递导致快照变化时，旧任务安全退出或刷新计划，不得重复回收、重复写历史或重复通知。

## 7. 兼容扫描与部署

- 既有 `PoolRecycleService` 每天 02:30 扫描保留，用于兼容固定区间、日历区间和历史规则；明确时长阈值的正常到期触发由 BullMQ 延迟任务负责。
- `PoolRecycleWorkerModule` 已注册到现有 `WorkerAppModule`，继续使用生产独立 Worker 容器和 `dist/worker.js`，不新增 Redis 实例或容器。
- `pool_recycle_task` 的结构通过 Prisma ORM 8 contract 和 forward migration 管理；禁止使用 `db push` 或手工 marker/ref 操作替代 migration。

## 8. 验收状态

| 验收项                        | 实现状态           | 验证状态                                               |
| ----------------------------- | ------------------ | ------------------------------------------------------ |
| 领取/分配/转移/跟进时刷新计划 | 已实现             | 类型检查与构建通过；全部业务分支尚未逐项做集成测试     |
| 线索池 2 分钟真实回收         | 已实现             | 本地真实 PostgreSQL + Redis + BullMQ + Worker 闭环通过 |
| 客户公海动态回收              | 已实现             | 尚待真实客户公海端到端闭环                             |
| 规则变化、旧 generation 失效  | 已实现             | 尚待专项并发/旧任务集成测试                            |
| Worker 启动补建与恢复         | 已实现             | 尚待 Redis/Worker 重启故障注入测试                     |
| PC 配置页面                   | 已实现             | TypeScript 与生产构建通过；浏览器视觉验收待补          |
| Mobile H5 业务操作            | 沿用现有池业务接口 | 本轮未做专门视觉验收                                   |

2026-11-09 本地真实数据验收：线索与客户各创建两条记录，分别验证领取后不跟进、领取后写跟进。无跟进记录使用领取时间生成首个计划；写跟进后 `generation` 从 1 增至 2，`dueAt` 按最后跟进时间重新计算。Worker 最终将 4 条记录全部回收到各自原池，负责人和领取时间清空，2 条跟进记录与负责人历史保留，任务均为 `COMPLETED` 且 `lastError` 为空。测试记录保留在本地。

线索池真实闭环验收以实际业务状态为准：测试成员领取后，PostgreSQL 计划到期时间按领取时间加 2 分钟生成；BullMQ Job 由 Worker 消费；线索回到原线索池、负责人清空、负责人历史保留且未产生跟进记录。具体验收结果与未完成项目以本表为准，不得将调度链路测试等同于完整业务验收。
