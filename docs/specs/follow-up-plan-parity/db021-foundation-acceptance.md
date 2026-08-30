# DB-021 8.2 数据模型与 Metadata 基座验收

## 1. 结论

DB-021 8.2 已完成并通过 targeted 验证。

## 2. 已完成基座

- `ModuleKey += followPlan`，标签为“跟进计划”。
- `MODULE_SYSTEM_FIELDS.followPlan` 已建立 8 个系统字段。
- Seed 已加入 `ensureModuleForm('followPlan')`。
- Prisma 新增 `FollowUpPlanField / FollowUpPlanFieldBlob`。
- 新增 migration `20260830164500_db021_follow_up_plan_fields`。
- `ResourceFieldValueService` 已注册 `followPlan`。
- FollowPlan 主表沿用 W2.2 的 `tenantId`，字段过滤 SQL 通过 `organizationColumn` 兼容，不改旧主表结构。

## 3. 验证结果

- `prisma format`: exit 0。
- `prisma validate`: schema valid。
- `prisma generate`: exit 0。
- `pnpm --filter @micromatrix/api typecheck`: exit 0。
- `prisma migrate deploy`: **57 migrations found**，第 57 个 migration 应用成功。
- Seed：exit 0。
- 当前开发库实证：
  - `follow_up_plan_field` 存在。
  - `follow_up_plan_field_blob` 存在。
  - `sys_module_form.form_key=followPlan` 存在。
  - FollowPlan 系统字段数：8。

## 4. 保留项

8.2 刻意保留 `follow_up_plans.customData`。只有 8.3 完成 CRUD/list/detail/filter/delete/转换复制等 runtime 切换，并确认升级数据不会丢失后，才允许移除该 legacy 列。

因此 8.2 可以关闭，下一步进入 8.3。
