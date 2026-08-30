# DB-021 FollowUpPlan Field/Blob 实施计划

## 1. 范围

只关闭 FollowUpPlan 动态字段 legacy；W2.2 已完成的 CRUD、权限、状态、提醒、转换、PC/Mobile 主功能保持现有语义。

## 2. 执行顺序

### 8.1 源码/现状审计

- Cordys DDL、FieldService、CRUD、筛选、复制、FormKey。
- MicroMatrix Prisma / DTO / Service / Web / ModuleForm 差异。
- 升级库 customData 使用情况。

### 8.2 数据模型与 Metadata 基座

- `ModuleKey += followPlan`，label=跟进计划。
- ModuleForms Seed 增加 FollowPlan form。
- Prisma 新增 FollowUpPlanField/Blob。
- forward migration 创建两表及索引。
- 注册 `ResourceFieldValueService` resource config。
- 设计兼容旧 `customData` 的精确 key->fieldId 迁移，不猜 key。

### 8.3 后端 runtime 迁移

- DTO 改为 `moduleFields` 契约，移除 runtime `customData` API。
- create/update/list/detail 接 `ResourceFieldValueService`。
- 高级筛选接分域表。
- delete 清理 Field/Blob。
- convert/clone/merge/lead transition 复制 Field/Blob。
- change log 保持动态字段可见。

### 8.4 PC/Mobile 表单

- FollowUpPlanDialog 读取 followPlan Metadata。
- 渲染动态字段并提交 moduleFields。
- PC/Mobile/Customer360/顶部计划入口全部复用同一表单。
- 不新增 `/system/modules` 专属按钮。

### 8.5 专项验收与 DB-021 封板

- 专项 API Smoke：normal/blob、create/update/detail/list/filter/delete。
- 线索转换复制计划 + Field/Blob。
- 客户合并/转挂不丢字段。
- Browser：PC/Mobile 动态字段真实往返。
- 空库 57+ migrations + 双 Seed。
- Rules/typecheck/lint/build/root smoke。
- runtime legacy scan：FollowUpPlan `customData` 读写为 0。
- 更新 DB-021 -> VERIFIED。

## 3. 明确非目标

- FollowUpPlan 评论/评论计数。
- 完整复刻 Cordys 三套 CUSTOMER/BUSINESS/CLUE FormDesign 布局编辑器。
- 新增 `/system/modules` FollowPlan 配置按钮。
- 改写 W2.2 已验收的权限/状态/提醒业务规则。
