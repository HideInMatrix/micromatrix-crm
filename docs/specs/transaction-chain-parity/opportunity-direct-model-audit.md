# W3.6.0 商机直接模型与迁移审计

## 1. 直接模型

本阶段将旧 `opportunities / opportunity_stages / opportunity_stage_logs / opportunity_items` 替换为 Cordys 直接模型：

- `opportunity`
- `opportunity_field`
- `opportunity_field_blob`
- `opportunity_stage_config`
- `opportunity_rule`

商机主记录使用 `organization_id / owner / stage / create_time / update_time` 等 Cordys 字段；自定义字段通过 `ResourceFieldValueService` 写入 Field/Blob 表，不再使用 `customData` 作为数据库真相。

## 2. 旧数据迁移

`20260828211500_w360_opportunity_direct_models` 保留可转换旧数据：

- 旧 Stage ID 作为新 `opportunity_stage_config.id` 保留，避免商机阶段引用重编号。
- `isWon/isLost/probability/sort` 转换为 `type/rate/pos`。
- 商机 DateTime 转为 Cordys 毫秒时间戳。
- `opportunity_items.productId` 按原排序聚合为 Cordys `products` JSON 文本。
- 旧 `customData` 仅迁移到当前组织真实存在的自定义 ModuleField。
- Field/Blob 路由与 `ResourceFieldValueService` 一致：`textarea/multiselect/checkbox` 固定进入 Blob，其余超过 255 字符的值进入 Blob。
- 完成转换后删除四张旧表，不保留双写、兼容 View 或第二份数据库真相。

## 3. 跨模块调用方

已迁移直接依赖旧商机字段的生产调用方：

- 客户查重、客户 360、客户删除保护。
- 客户公海库容的商机阶段排除。
- 首页商机统计、漏斗、排行、趋势、输单原因统计。
- 线索转商机。
- 报价从商机意向产品解析真实产品。
- 跟进计划商机权限、联系人归属和最新跟进时间。
- 成员删除引用检查。

数据范围统一改为 `directOwnerFilter / matchesDirectOwner`，不再依赖旧 `ownerId + deptId` 商机列。

## 4. 验证结果

- Prisma validate：通过。
- Prisma generate：通过。
- API `tsc --noEmit`：通过。
- 独立空库：40/40 migrations 全量复放通过。
- 独立空库 Seed：通过。
- 当前 `default` 数据库完整副本：新 migration 应用通过。
- 家里真实 `default`：第 40 条 migration 应用通过。

当前数据库中旧商机、旧阶段和旧明细样例数量均为 0，因此本次真实库升级不存在历史商机数据丢失；迁移中的转换 SQL仍通过现库副本路径验证。
