# ASYNC-001 BullMQ 异步导出中心设计

## 1. 运行拓扑

```text
Browser
  -> API export endpoint
     -> PostgreSQL ExportTask(PENDING + payload)
     -> BullMQ Queue add({taskId})
     <- immediately return ExportTaskVO(PENDING)

Redis 7 AOF
  -> micromatrix export queue
     -> dedicated worker process/container
        -> PostgreSQL load task + fresh user/roles
        -> business export handler re-query data
        -> ExcelJS build
        -> shared /app/uploads/exports
        -> conditional PENDING -> SUCCESS/FAILED

Browser ExportTask drawer
  -> PostgreSQL list
  -> download shared file
```

API 和 worker 使用同一镜像，但不同 entrypoint：

```text
api:    node dist/main.js
worker: node dist/worker.js
```

worker 不监听端口。

## 2. 模块分层

### 2.1 `AsyncJobsModule`

平台层，仅依赖 Config：

- `AsyncJobsService`
  - 创建 export Queue producer。
  - `enqueueExport(taskId)`。
  - `ensureExportJob(taskId)` recovery。
  - `cancelExportJob(taskId)`。
  - `startExportWorker(processor)` / shutdown。
  - metrics snapshot。

业务 service 不 import BullMQ。

### 2.2 `ImportExportModule`

- `ExportTasksService`：DB task 生命周期、文件生命周期、enqueue/recovery 辅助。
- `SpreadsheetService`：Excel 构建/解析。
- ImportExportModule 只依赖 AsyncJobsModule，不反向依赖 CRM 业务模块。

### 2.3 `ExportWorkerModule`

根层组合模块，依赖：

- ImportExportModule
- CustomersModule
- ContactsModule
- LeadsModule
- OpportunitiesModule
- ProductsModule
- ContractsModule
- OrdersModule

`ExportWorkerService` 维护显式 module switch，避免动态 DI/反射注册：

```ts
switch (task.module) {
  case 'customer':
  case 'customer_pool':
    return customers.buildQueuedExport(user, task.payload)
  ...
}
```

ContactsModule / LeadsModule 补充 service export，仅用于 worker composition。

## 3. Queue 连接

BullMQ 使用专用 Redis connection configuration，不复用 CACHE/EVENT 的 command client 或 subscriber client。

- queue name: `export`
- BullMQ prefix: `micromatrix-crm:bull`
- job name: `build-xlsx`
- jobId: ExportTask.id
- attempts: 3
- backoff: exponential, delay 2000ms
- removeOnComplete/removeOnFail：保留有限 job metadata；业务任务与文件生命周期仍由 PostgreSQL控制。
- producer 配置 fail-fast，不能在 Redis down 时无限等待 HTTP。

Redis 未配置：AsyncJobsService enabled=false；API 其他功能照常启动，异步导出 enqueue 返回 503。

## 4. ExportTask schema

追加：

```prisma
payload   Json?
startedAt DateTime?
attempts  Int @default(0)
```

历史任务 payload nullable；新异步任务必须有 payload。现有 status 字符串保持 PENDING/SUCCESS/FAILED/CANCELED。

payload 结构统一：

```ts
interface ExportTaskPayload {
  version: 1
  query: Record<string, unknown>
  input: {
    headList: string[]
    ids?: string[]
    poolId?: string
    // 模块所需的其它轻量查询字段
  }
}
```

fileName/module/tenantId/userId 已是 task 顶层字段，不重复复制。

## 5. Enqueue transaction

`ExportTasksService.enqueue()`：

1. normalize fileName。
2. PostgreSQL interactive transaction。
3. `pg_advisory_xact_lock(hashtextextended('export-user:<tenant>:<user>', 0))`。
4. count `PENDING`；>=10 拒绝。
5. 查询同 module PENDING；存在则拒绝。
6. create ExportTask(PENDING,payload,expiresAt)。
7. commit。
8. Queue add(jobId=task.id)。
9. queue add 失败：delete where id + status=PENDING；返回 ServiceUnavailableException。

这保证多 API 实例也不会绕过 Cordys 风格的用户任务限制。

## 6. Business handler 重构

每个当前导出 service 把现有同步函数拆成：

```ts
exportXlsx(user, query, input) {
  return exportTasks.enqueue(user, {
    module,
    fileName,
    payload: { version: 1, query, inputWithoutFileName },
  })
}

buildQueuedExport(user, payload) {
  // 原 collectExportItems / metadata / rows / workbook 逻辑全部移到这里
  return { data, rowCount }
}
```

`buildQueuedExport` 不创建 ExportTask，不接触 BullMQ，只返回文件 Buffer 与 rowCount。

price/order 子表分支也在 worker handler 内决定普通 workbook 或 sub-table workbook。

## 7. Worker 状态机

processor：

1. DB 查 task；非 PENDING -> no-op。
2. expiresAt 已过期 -> CANCELED/no-op。
3. conditional update PENDING：attempts +1，startedAt 首次写入。
4. 重新查 active user + roles，`toAuthUser()`。
5. module route -> buildQueuedExport。
6. 再查 task.status；CANCELED -> 丢弃 Buffer。
7. 写共享文件。
8. `updateMany where id,status=PENDING` -> SUCCESS。
9. 若 update count=0（取消竞态）删除刚写文件。

错误分类：

- BadRequest/Forbidden/NotFound/Unauthorized 等确定性业务错误：立即写 FAILED，并作为 BullMQ unrecoverable error 结束。
- 其它错误：继续 BullMQ retry；最后 attempt 才写 FAILED。

## 8. Recovery

worker bootstrap：

- start Worker 后读取 `PENDING && expiresAt > now`，按批次恢复。
- `ensureExportJob(taskId)` 检查同 jobId：
  - waiting/delayed/active -> keep。
  - missing -> add。
  - completed/failed 且 DB 仍 PENDING -> remove old + add。
- task payload null 的历史 PENDING 不能恢复，标 FAILED 并写明确错误。

BullMQ jobId + DB 状态共同保证重启恢复，不依赖进程内 callback。

## 9. Cancel

- 先 DB conditional PENDING -> CANCELED + completedAt。
- 再 best-effort queue remove waiting/delayed job。
- active job 无强杀；processor 在 build 后与 SUCCESS CAS 时再次检查。
- completed/failed task 的 DELETE 继续作为清理：删除文件并标 CANCELED。

## 10. Worker deployment

`docker-compose.yml` 新增：

```yaml
worker:
  image: same API_IMAGE
  command: ['node', 'dist/worker.js']
  environment: same DATABASE/REDIS/UPLOAD essentials
  volumes:
    - release_uploads:/app/uploads
  depends_on:
    migrate: service_completed_successfully
    redis: service_healthy
```

API 仍只硬依赖 migrate，不改为依赖 Redis health，从而维持 CACHE-001 的整体 fail-open 启动原则。

## 11. 验收层次

1. unit：producer concurrency/cleanup，worker route/retry/cancel/recovery。
2. Rules：把 import-export/async-jobs tests 纳入完整 Rules。
3. real runtime：PostgreSQL + Redis + 独立 worker，证明 enqueue 返回 PENDING 后异步转 SUCCESS。
4. restart：worker 停止时 PENDING 保留，重新启动后自动恢复。
5. Compose config + API/worker build + diff check。
