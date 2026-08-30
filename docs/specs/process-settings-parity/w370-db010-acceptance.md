# W3.7-9.2 DB-010 通用审批资源快照专项验收

验收日期：2026-08-30

## 1. 关闭范围

本轮只关闭 DB-010，不提前开放 DB-011 / DB-012 的高级审批开关。

关闭目标：

- Quote / Contract / Invoice / Order 的 UPDATE 审批统一使用通用资源快照；
- `ApprovalsService` 不再硬编码四类业务的 capture / restore / status / delete；
- `ApprovalInstance` 真实保存实例级 `comment` 与本次 `updateFields`；
- reject / submitter revoke 使用通用快照恢复；
- UPDATE approve 清理已失效快照；
- DELETE 保持审批通过后才真实删除；
- 旧 `approval_instances.business_snapshot` 退出运行时和物理 schema；
- 资源恢复与状态操作按 tenant fail-closed。

## 2. 数据模型与迁移

### 2.1 Migration 58：建立通用快照与实例上下文

`20260830194000_w370_approval_resource_snapshot`

- `approval_instances.comment`；
- `approval_instances.update_fields`；
- `approval_resource_snapshots`；
- 活动快照唯一键：`tenantId + formType + resourceId`；
- migration 执行时把旧 `business_snapshot` 中仍处于 `PENDING + UPDATE` 的四业务在途快照搬入通用表。

该 migration 已先在 `default` 执行并作为历史 migration 固化，后续没有回改。

### 2.2 Migration 59：退出旧实例快照列

`20260830203000_w370_drop_legacy_business_snapshot`

- 在四业务删旧前等价回归通过后执行；
- 只执行 `DROP COLUMN approval_instances.business_snapshot`；
- Prisma `ApprovalInstance.businessSnapshot` 同步删除；
- Snapshot Service 不再存在 legacy fallback；
- `ApprovalsService` 不再向实例双写旧快照。

当前 `default`：**59/59 migrations successfully applied**。

## 3. 运行时结构

### 3.1 Resource boundary

审批状态机通过显式白名单资源边界处理四业务：

- `ApprovalResourceCaptureService`：捕获编辑前 direct 主字段 + Field/Blob + 业务 Snapshot；
- `ApprovalResourceSnapshotService`：通用快照 upsert / load / clear；
- `ApprovalResourceRestoreService`：四业务恢复实现；
- `ApprovalResourceService`：统一 façade，负责 target info、审批状态、DELETE 生效、快照生命周期和 `updateFields` 差异计算。

`ApprovalsService` 本身已不再引用 quotation / contract / invoice / order Prisma 资源模型。

### 3.2 `updateFields` 与 comment

UPDATE 提审不是把 DTO key 机械当作“已修改字段”：

- capture 编辑前完整资源；
- 业务更新完成后重新 capture；
- 比较 direct 主字段；
- 比较 Field / Blob，以真实 `fieldId` 记录动态字段变化；
- 稳定排序后写入 `ApprovalInstance.updateFields`；
- `dto.comment` 独立写入实例 `comment`，不覆盖审批任务意见。

### 3.3 Tenant fail-closed

四类 restore、status 和 DELETE 均先使用 `resourceId + organizationId/tenantId` 确认资源归属，再对已验证 ID 执行实际动作。专项 Smoke 额外用错误 tenant 调用 restore，确认不能修改另一组织资源。

## 4. 专项验收

### 4.1 DB-010 generic lifecycle Smoke

命令：

`pnpm smoke:w370-db010-regression`

隔离临时库从零应用 **59/59 migrations + Seed**，直接断言：

- `approval_instances.business_snapshot` 列不存在；
- UPDATE 实例 `executeTiming=UPDATE`；
- 实例 `comment` 与提交内容一致；
- `updateFields` 至少真实包含本次变更的 `name`、`amount`；
- 同 tenant/form/resource 只有 **1** 条活动 `approval_resource_snapshots`；
- generic snapshot 保存编辑前业务值；
- 错误 tenant restore 不修改资源；
- reject 恢复编辑前值并清理快照；
- submitter revoke 恢复编辑前值并清理快照；
- UPDATE approve 清理失效快照。

同一脚本随后继续复用既有审批专项：

- Quotation CREATE / UPDATE reject / UPDATE revoke / DELETE delayed approval：PASS；
- Invoice UPDATE reject / revoke / DELETE / batch delete：PASS；
- Order CREATE / UPDATE reject / revoke / DELETE delayed approval / notification：PASS。

### 4.2 Contract 独立回归

`node apps/api/scripts/w363-contract-http-smoke.mjs`

- 临时库 **59/59 migrations + Seed**；
- direct CRUD / DataScope / stage；
- CREATE / UPDATE / DELETE approval；
- UPDATE reject / revoke rollback；
- `approved` 历史事实位；
- 全部 PASS。

## 5. 全局回归

- API Rules：**119/119**，0 fail；
- Root Smoke：**227/227**，0 fail；
- `pnpm smoke:w366-empty-db`：**59/59 migrations + Seed #1 + Seed #2**，关键计数稳定，隔离 runtime PASS；
- API typecheck：exit 0；
- workspace ESLint：exit 0；
- Shared / API / Web production build：exit 0；
- `git diff --check`：PASS。

## 6. Legacy / hard-code 扫描

- production `apps/api/src`：`businessSnapshot` **0**；
- `ApprovalsService`：quotation / contract / invoice / order Prisma direct resource 引用 **0**；
- `business_snapshot` 仅存在于：
  - 创建旧列的 W3.6.2 历史 migration；
  - migration 58 的在途数据搬运；
  - migration 59 的 DROP；
  - DB-010 Smoke 对“旧列必须不存在”的断言。

没有保留运行时第二真相源。

## 7. 结论

DB-010 已满足关闭条件，可标记 `VERIFIED`。

下一执行单元是 **W3.7-9.3 / DB-011 高级审批任务、动作、记录与附件**。DB-011 完成前，流程设置中的 add-sign / withdraw / requireComment 等高级能力不得因 DB-010 已完成而提前开放。
