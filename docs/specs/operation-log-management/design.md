# LOG-002 操作日志详情与生命周期管理设计

## 1. 源码审计结论

CordysCRM 当前源码的操作日志链路包含 AOP 记录、异步写入、操作日志列表、详情接口及 `sys_operation_log + sys_operation_log_blob` 拆表；Blob 保存修改前后等大字段，列表主表保持轻量。Cordys 前端日志页还对查询时间范围做限制，但当前源码未发现 retention 配置、自动删除任务或清理按钮。

MicroMatrix 当前状态：

- `OperationLog.detail Json?` 与摘要字段位于同一 `operation_logs` 表；
- `BusinessChangeLogService` 会写 `{ changes: [{ field, before, after }] }`；组织同步失败等场景也会写 detail；
- `LogsService.operationLogs()` 使用无 select 的 `findMany`，分页列表因此把 detail 一起读取后再返回；
- LOG-001 已有 `createdAt` 独立索引、180 天默认 retention、有界批量删除与 DAILY distributed coordination；
- retentionDays 当前只来自环境变量。

用户已确认项目未上线且无需要兼容的旧数据，因此本批直接做目标 schema，不设计 compatibility phase。

## 2. 数据模型

### 2.1 日志摘要

```prisma
model OperationLog {
  id         String   @id @default(cuid())
  tenantId   String
  userId     String?
  userName   String?
  module     String
  action     String
  targetId   String?
  targetName String?
  ip         String?
  createdAt  DateTime @default(now())

  blob OperationLogBlob?

  @@index([createdAt])
  @@index([tenantId, createdAt])
  @@index([tenantId, module])
  @@map("operation_logs")
}
```

### 2.2 扩展详情

```prisma
model OperationLogBlob {
  operationLogId String @id
  detail         Json

  operationLog OperationLog @relation(fields: [operationLogId], references: [id], onDelete: Cascade)

  @@map("operation_log_blobs")
}
```

Blob 不重复 tenantId。租户边界始终从父 `OperationLog` 校验；详情 API 以父记录 `tenantId + id` 查询并 include blob。

### 2.3 租户日志策略

```prisma
model OperationLogSetting {
  tenantId           String    @id
  retentionDays      Int?
  lastCleanupAt      DateTime?
  lastCleanupDeleted Int       @default(0)
  lastCleanupSource  String?
  updatedAt          DateTime  @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@map("operation_log_settings")
}
```

数据库内部 `retentionDays` 使用三态语义：`null` 表示继续继承环境变量默认值，`0` 表示永久保留，`30..3650` 表示租户显式覆盖。这样自动清理可以为了保存最近执行状态创建 setting row，而不会把未配置租户永久钉死在当时的默认天数。API 不暴露内部 `0` sentinel：网页仍使用 `retentionDays: null` 表示永久保留，并通过 `configured` 区分“显式策略”与“继承默认值”。

## 3. 写入路径

普通 `@LogOperation`：

```text
业务请求 -> OperationLog 摘要
```

字段差异：

```text
BusinessChangeLogService.diff
  -> OperationLog.create
       -> blob.create { detail: { changes } }
```

其它显式 detail 场景同步使用 nested create。由于 OperationLog 与 Blob 是同一个 Prisma nested write，摘要与详情原子落库，不引入“主日志成功但 Blob 丢失”的中间状态。

## 4. 读取路径

### 列表

`GET /logs/operations` 使用显式 `select`：

```text
id/userName/module/action/targetName/ip/createdAt
```

不读取 `blob`，不返回 `detail`。

### 详情

`GET /logs/operations/:id`：

```text
where tenantId + id
  -> 摘要 + blob.detail
  -> OperationLogDetailVO
```

跨租户或不存在统一 404。

## 5. retention 策略

环境变量职责收窄：

| 参数                                | 默认 | 职责                             |
| ----------------------------------- | ---: | -------------------------------- |
| `OPERATION_LOG_RETENTION_DAYS`      |  180 | 尚未保存租户策略时的默认保留天数 |
| `OPERATION_LOG_CLEANUP_BATCH_SIZE`  | 1000 | 单批数据库工作量上限             |
| `OPERATION_LOG_CLEANUP_MAX_BATCHES` |   20 | 单租户一次清理最多批次数         |

策略 API：

- `GET /logs/settings`：返回 effectiveRetentionDays、permanent、configured、last cleanup metadata；
- `PUT /logs/settings`：保存 `retentionDays: number | null`；
- `POST /logs/cleanup`：按当前有效策略立即执行当前租户清理。

自动任务每天 04:15 获取租户列表并逐租户执行；一个租户失败只记录错误并继续下一个租户。永久保留租户跳过 delete，但不伪造删除数量。

## 6. 权限

权限树调整为：

```text
system:log 系统日志
  └─ system:log:update 编辑日志策略/执行清理
```

读取 controller 继承 `system:log`；PUT/POST 方法额外声明 `system:log:update`。系统管理员 `*` 自动拥有新权限，不为普通读取角色自动升级写权限。

## 7. Web

`LogsView.vue` 保留 Cordys 式“操作日志 / 登录日志”Tab，在操作日志工具栏增加“日志策略”。

策略 Drawer：

- 保留模式：按天 / 永久；
- 天数：30～3650；
- 当前默认来源；
- 最近清理时间/数量/来源；
- 自动任务提示；
- 保存；
- 立即执行清理。

操作日志表增加“详情”列，点击后按 ID 延迟请求，不在列表预加载 Blob。详情优先把 `{changes}` 渲染为字段/修改前/修改后表格；其它 JSON 使用格式化 JSON 展示。

## 8. Migration 策略

本项目未正式上线，不保留旧 detail：

1. 创建 `operation_log_blobs`；
2. 创建 `operation_log_settings`；
3. 删除 `operation_logs.detail`；
4. 保留 LOG-001 已有索引。

不执行 `INSERT ... SELECT` 回填，不双写，不保留 deprecated column。

## 9. 验证

- schema validate + generate；
- migrate deploy 到当前开发库；
- LogsService / cleanup / setting 专项；
- Rules；
- root typecheck/lint/build；
- Web LogsView production build；
- 迁移后静态扫描禁止运行时代码继续引用 `operationLog.detail`。
