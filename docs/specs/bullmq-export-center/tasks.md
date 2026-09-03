# ASYNC-001 BullMQ 异步导出中心任务

- [x] A1 现场审计与规格冻结
  - 审计 ExportTask/ExportTasksService/ExportTaskButton 当前同步执行现场。
  - 审计 13 类导出 module 与 price/order 子表 Buffer 路径。
  - 对照 Cordys PREPARED 后台导出、10 个待处理上限、同资源防重复、取消、24h 清理。
  - 冻结独立 worker、DB task 真相源、BullMQ durable delivery、producer fail-closed 语义。

- [x] A2 BullMQ 平台层
  - 引入 BullMQ dependency。
  - AsyncJobsModule/Service：producer、worker lifecycle、jobId、retry/backoff、metrics。
  - queue unavailable fail-fast 503。
  - producer 使用显式 ioredis connection lifecycle；连接 ready 后再构造 Queue，断线时关闭 offline queue，避免 HTTP 请求在进程内无限积压。
  - `/health.asyncJobs.queue` 可读取 BullMQ worker 数和 waiting/active/delayed/completed/failed 队列级状态，不再用 API 本地进程 worker 状态冒充全局运行态。

- [x] A3 ExportTask 持久契约与 producer
  - migration 增加 payload/startedAt/attempts。
  - ExportTasksService enqueue + user advisory transaction。
  - 10 个 PENDING 上限、同 module 防重复。
  - enqueue failure 清理 DB task。
  - cancel/cleanup/recovery DB 生命周期。

- [x] A4 业务导出 handler 化
  - customer/customer_pool/contact。
  - lead/lead_pool/opportunity。
  - product/price。
  - businessTitle/contractInvoice。
  - contractPaymentPlan/contractPaymentRecord。
  - order。
  - HTTP 路径不得再 collect all rows/build workbook。

- [x] A5 独立 Export Worker
  - WorkerAppModule + worker.ts。
  - ExportWorkerModule/Service 显式 module routing。
  - fresh AuthUser/roles。
  - retry/final failure/unrecoverable classification。
  - cancel race 与 startup recovery。
  - 正式 `dist/worker.js` 独立 Nest application context 启动通过；worker 不启动 HTTP server，不在 API 进程内偷偷消费队列。
  - `complete()` 使用 `PENDING` CAS；取消竞态导致 CAS 失败时删除刚生成的 xlsx，取消状态不会被晚到 worker 覆盖。

- [x] A6 部署与观测
  - docker-compose worker service，共享 uploads。
  - `/health` asyncJobs/exportQueue metrics。
  - docs/api/architecture/cordys parity 更新。
  - Compose 当前服务拓扑为 postgres / redis / migrate / api / worker / web；worker 与 API 共享 `release_uploads`，worker 依赖 migration 完成与 Redis healthy，且不发布端口。

- [x] A7 自动化与真实 Smoke
  - producer/limit/failure tests。
  - worker route/retry/cancel/recovery tests。
  - 13 module route coverage。
  - 真实 Redis + PostgreSQL + 独立 worker async completion/restart recovery。
  - API typecheck/build、完整 Rules、Compose config、`git diff --check`。
  - ASYNC 专项 **10/10 PASS**；完整 Rules **172/172 PASS**。
  - 新增 `pnpm --filter @micromatrix/api smoke:async-export`：隔离 PostgreSQL/Redis 从零应用 **69/69 migrations + bootstrap**，验证 producer 立即返回 PENDING、主动删除 Redis job 后 startup `recovered=1`、xlsx 下载签名、worker 停机任务保持 PENDING、重启 `kept=1` 后成功完成，以及 API health 能观察真实 BullMQ worker；最终 7 项断言全部为 true。
  - `docker compose --env-file docker/.env.release.example config` PASS；`git diff --check` PASS。

- [x] A8 文档封板
  - project-progress/specs index/alignment-log。
  - A2～A7 全绿后标记 `ASYNC-001 VERIFIED`。

当前状态：**VERIFIED**。
