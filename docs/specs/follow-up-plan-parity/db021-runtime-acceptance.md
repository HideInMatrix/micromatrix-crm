# DB-021 8.3 FollowUpPlan runtime 验收

日期：2026-08-30

## 结论

DB-021 8.3 后端 runtime 已完成。FollowUpPlan 的 API CRUD、列表/详情、高级筛选、删除和复制/合并链已经退出 `customData` 运行时读写，动态字段统一进入 `follow_up_plan_field` / `follow_up_plan_field_blob`。

物理列 `follow_up_plans.customData` 本阶段仍保留，仅用于旧版本升级兼容；当前 FollowUpPlan 生产 runtime 不再读取或写入该列。列删除必须等待旧数据迁移策略完成，不能在缺少可证明 key -> ModuleField 映射时直接丢弃历史值。

## Runtime 对齐矩阵

| 能力 | 当前实现 | 验收结果 |
| --- | --- | --- |
| Create | 主记录与 `ResourceFieldValueService.save(..., 'create', tx)` 同事务 | PASS |
| Update | 主记录与本次提交动态字段 `save(..., 'update', tx)` 同事务；未提交动态字段保持不变 | PASS |
| List / Detail | `ResourceFieldValueService.load()` 批量回填 `moduleFields` | PASS |
| Filter | 系统字段走 Prisma 条件；动态字段走 `filterResourceIds()`，最终取交集 | PASS |
| Delete | 删除 FollowUpPlan 主记录，Field/Blob 通过 FK cascade 清理 | PASS |
| Lead -> Customer copy | 新计划创建后分别复制 source `fields` / `fieldBlobs` | PASS |
| Customer merge | 仅更新 `targetId`，FollowUpPlan `id` 不变，Field/Blob 原资源关联保持 | PASS |
| API contract | DTO / shared VO / web API payload 从 `customData` 切换为 `moduleFields` | PASS |

## 本阶段发现并修复的基座缺口

8.2 已完成 FollowPlan 的资源配置和 `assertResource()`，但进入真实 runtime 前进一步发现 `ResourceFieldValueService` 内部仍有四处“其他资源默认落到 Order delegate”的旧分支：

- unique 校验；
- delete；
- create；
- load/find。

同时通用 load 条件默认使用 `resource.organizationId`，而历史 FollowUpPlan 主表使用 `tenantId`。

本阶段已为 `followPlan` 增加显式 `followUpPlanField` / `followUpPlanFieldBlob` delegate，并在 unique/load 时使用 `resource.tenantId`。专项单测还将 Order delegate 设置为直接抛错，防止未来 FollowPlan 再次意外落入 Order 表。

## 复制与合并边界

### Lead 转 Customer

`copyLeadFollowArtifactsInTransaction()` 现在读取 FollowUpPlan 的 `fields` / `fieldBlobs`，创建 customer FollowUpPlan 后使用新 planId 复制两类值；原有状态、负责人、计划时间、转换记录映射保持不变。

### Customer merge

客户合并使用 `followUpPlan.updateMany(... data: { targetId })`，不会重建 FollowUpPlan，也不会改变 planId。因此 Field/Blob 仍引用同一资源 ID，不需要额外复制。真实库 Smoke 已验证 targetId 转挂前后两类字段值完全不变。

## `customData` runtime 扫描

- `apps/api/src/modules/follow-up-plans`（排除 test）：`customData` = **0 命中**。
- 线索转换已不再存在 `plan.customData` 复制。
- FollowUpPlan DTO、shared VO、web API payload 已不再公开 `customData`。
- Prisma schema / generated model 与旧测试 fixture 中仍可出现物理 `customData` 字段；这是升级兼容证据，不属于 runtime API 读写。

Cordys 源码在更新动态字段时还会读取旧值用于其自身变更日志。MicroMatrix 当前 FollowUpPlan runtime 没有对应独立 change-log 子系统，本阶段不凭空新增一套 Cordys 之外的本地审计模型；8.3 的正式任务范围是 CRUD/list/detail/filter/delete/复制链退出 `customData`，该范围已全部闭环。

## 自动化证据

### API typecheck

```text
pnpm --filter @micromatrix/api typecheck
exit 0
```

包含 Prisma generate 与 `tsc --noEmit`，在新增 runtime Smoke 和专项单测后再次执行通过。

### FollowUpPlan 既有规则单测

```text
node --import tsx --test src/modules/follow-up-plans/follow-up-plans.service.test.ts
3 passed / 0 failed
```

覆盖：已转换状态保护、原子转跟进记录、到期提醒去重。

### ResourceFieldValueService 单测

```text
node --import tsx --test src/modules/metadata/resource-field-value.service.test.ts
9 passed / 0 failed
```

新增 FollowPlan 用例验证：

- `tenantId` 资源隔离；
- normal/blob 分表写入；
- load 回读；
- FollowPlan filter SQL 使用 `follow_up_plans`、`follow_up_plan_field` 和 `"tenantId"`；
- FollowPlan 不允许访问 Order Field/Blob delegate。

### 真实数据库 Runtime Smoke

```text
pnpm smoke:db021-follow-plan-runtime
DB-021 FollowPlan runtime smoke: 12 assertions passed
exit 0
```

真实数据库验证：

1. `followPlan` ModuleForm 含 8 个系统字段；
2. 创建一条 normal 自定义字段与一条 blob 自定义字段；
3. FollowUpPlan + Field/Blob 同事务落库；
4. 两张字段表各命中 1 行；
5. `load()` 完整往返；
6. normal + blob 联合动态筛选命中该 plan；
7. 模拟客户合并只更新 `targetId`；
8. 转挂后 planId 不变；
9. normal/blob 行均保持；
10. 转挂后 `load()` 值完全一致；
11. 删除主计划后 normal 行为 0；
12. 删除主计划后 blob 行为 0。

Smoke 使用随机 tenant/plan/field 数据并在 `finally` 清理，不保留验收数据。

## 阶段结论

8.3 可以关闭。DB-021 整体暂时仍为 `IN_PROGRESS`，下一步进入 8.4：让 PC / Mobile 共用的 FollowUpPlan 表单真正读取 `followPlan` metadata、回填并提交 `moduleFields`，同时不新增 Cordys 不存在的 `/system/modules` 专属 FollowPlan 按钮。
