# LOG-002 操作日志详情与生命周期管理任务

- [x] G1 Cordys / MicroMatrix 现场审计与边界冻结
  - 确认 Cordys 采用操作日志主表 + Blob 表、列表 + 详情分离。
  - 确认 Cordys 当前无 retention/cleanup UI；MicroMatrix 保留 LOG-001 生命周期增强。
  - 确认 MicroMatrix `detail` 有真实字段 diff/错误详情写入，列表当前会读取 detail。
  - 用户确认项目未上线、无需旧数据兼容；冻结为直接目标 schema。

- [x] G2 需求、设计与主文档立项
  - 建立 LOG-002 requirements/design/tasks。
  - 更新 specs 索引、project-progress、docs/README、alignment-log 和 Cordys parity 当前指针。

- [x] G3 Prisma 目标结构
  - `OperationLog.detail` 移除，新增一对一 `OperationLogBlob`。
  - 新增租户级 `OperationLogSetting`。
  - 新 migration 直接 drop 旧 detail，不做回填。
  - Prisma generate/validate/migrate deploy。

- [x] G4 API 与写入链路
  - `BusinessChangeLogService` 与显式 detail 写入迁到 nested Blob。
  - operation list 使用显式轻量 select。
  - 增加 operation detail API。
  - 增加 setting GET/PUT 和 manual cleanup API。
  - 增加 `system:log:update` 权限并记录设置/手工清理操作日志。

- [x] G5 自动清理升级
  - retentionDays 从“全局 env 真值”改为“租户配置 + env 默认”。
  - 自动任务逐租户执行，永久保留跳过。
  - 保留 batchSize/maxBatches + DAILY coordination。
  - 保存最近清理时间/数量/来源。

- [x] G6 Web 日志管理
  - 操作日志页增加详情懒加载与详情 Drawer。
  - 增加日志策略 Drawer：天数/永久、状态、保存、立即清理。
  - 只读/更新权限准确控制。
  - 永久保留警告与立即清理二次确认。

- [x] G7 自动化与封板
  - LOG-002 专项覆盖存储、列表/详情、租户策略、永久保留、清理、权限边界。
  - API Rules、root typecheck、lint、Web build、Prisma validate、`git diff --check` 全绿。
  - 更新 project-progress/alignment-log 当前 migration 与 Rules 基线。
  - G3～G7 全绿后标记 `LOG-002 VERIFIED`。

## 最终验收

- `20260904130000_operation_log_detail_and_settings` 已在本地 PostgreSQL 实际 deploy，数据库基线为 **71 migrations**，`prisma migrate status` 确认 schema up to date。
- `operation_logs.detail` 已退出目标 schema；字段级 before/after 与显式详情写入独立 `operation_log_blobs`。数据库事务 Smoke 实测删除主日志后 Blob 从 `1` 级联为 `0`。
- 操作日志列表使用显式轻量 select，不读取 Blob；详情按 `tenantId + id` 懒加载。`BusinessChangeLogService` 新增直接回归，证明 diff 不再写主表 detail。
- retention 已升级为租户策略：未配置时继承部署默认 180 天，可设置 30～3650 天或永久保留；自动清理逐租户执行，单租户异常隔离，仍复用 DAILY coordination 与既有批次上限。
- `/system/logs` 已提供详情 Drawer 与日志策略 Drawer；`system:log` 只读，`system:log:update` 控制策略保存和立即清理，永久保留与立即清理均有明确风险提示。
- 最终验证：API Rules **190/190 PASS**；全仓 `pnpm typecheck` PASS；`pnpm lint` **0 error / 8 个既有 warning**；全仓 production build PASS，Web **4145 modules transformed**；Prisma validate/generate/status PASS；Prettier PASS；`git diff --check` PASS。

当前状态：**VERIFIED**。
