# DB-021 FollowUpPlan Field/Blob 源码审计

## 1. 结论

W3.6 交易链已经把 Opportunity / Product / Price / Quotation / Contract / Payment Plan / Payment Record / Invoice / Order 全部迁移到独立 Field/Blob；DB-021 当前只剩 FollowUpPlan。

现有 MicroMatrix FollowUpPlan 主功能（W2.2）不重做。本执行单元只关闭动态字段值的最后一个 legacy：

- 删除 FollowUpPlan 对 `customData` JSON 的运行时依赖。
- 新增 `follow_up_plan_field` / `follow_up_plan_field_blob`。
- 把 FollowUpPlan 注册进现有 `ResourceFieldValueService`。
- 补 FollowUpPlan 的 ModuleForm/Metadata 定义来源。
- create/update/list/detail/filter/线索转换复制/客户合并等调用方改读写分域字段。
- PC/Mobile FollowUpPlan 表单补真实动态字段渲染与提交。

不在本项新增评论、评论计数、三套上下文表单布局或新的 `/system/modules` 专属按钮。

## 2. Cordys DDL 事实

Cordys `V1.0.0_6__opportunity.sql`：

### 2.1 follow_up_plan_field

- `id VARCHAR(32) NOT NULL`
- `resource_id VARCHAR(32) NOT NULL`
- `field_id VARCHAR(32) NOT NULL`
- `field_value VARCHAR(255) NOT NULL`
- PK: `id`
- index: `(resource_id, field_id, field_value)`

### 2.2 follow_up_plan_field_blob

- `id VARCHAR(32) NOT NULL`
- `resource_id VARCHAR(32) NOT NULL`
- `field_id VARCHAR(32) NOT NULL`
- `field_value TEXT NOT NULL`
- PK: `id`
- index: `(resource_id)`

这与当前 MicroMatrix `ResourceFieldValueService` 的 normal/blob 双表模式一致。

## 3. Cordys 字段服务事实

`FollowUpPlanFieldService extends BaseResourceFieldService<FollowUpPlanField, FollowUpPlanFieldBlob>`：

- formKey 固定为 `FormKey.FOLLOW_PLAN`。
- `FormKey.FOLLOW_PLAN` 的实际 key 为 `plan`。
- `ModuleFieldService` 将 FOLLOW_PLAN 映射到主表 `follow_up_plan`。

`FollowUpPlanService`：

- 新增计划：`saveModuleField(... request.moduleFields ...)` 后插入计划主记录。
- 更新计划：先读取原字段值用于变更日志；更新时先 `deleteByResourceId` 再重新 `saveModuleField`。
- 列表：批量 `getResourceFieldMap(ids, true)`，再把字段值与表单字段合并。
- 详情：同样加载 ModuleForm + 字段值 + optionMap。
- 删除：`deleteByResourceIds(ids)` 后再删计划主记录。

因此 FollowUpPlan 的动态字段值不是附属 JSON，而是 CRUD 生命周期的一部分。

## 4. Cordys 筛选/排序事实

`ExtFollowUpPlanMapper.xml`：

- 普通动态字段筛选 JOIN `follow_up_plan_field`。
- Blob 动态字段筛选 JOIN `follow_up_plan_field_blob`。
- 动态字段排序使用 `follow_up_plan_field` + `sys_module_field`。

MicroMatrix 不能只把 create/update 改成分域表，却让列表高级筛选继续读 JSON。

## 5. Cordys 线索转换复制事实

`ClueService.batchCopyCluePlanAndRecord`：

1. 读取原线索 FollowUpPlan。
2. 按计划 ID 批量读取 FollowUpPlanField / Blob。
3. 每个新计划生成新 planId。
4. 每条 Field/Blob 生成新 id，并把 `resourceId` 改成新 planId。
5. 批量插入新计划、Field、Blob。
6. 原计划与原字段值保留。

MicroMatrix 当前线索转换会复制 FollowUpPlan `customData`。DB-021 关闭时必须改成复制两张分域字段表，不能丢掉此前已验收的转换语义。

## 6. Cordys FormKey / Web 表单事实

- 后端统一字段值 formKey：`FOLLOW_PLAN = plan`。
- 全局计划列表与高级筛选使用 `FormDesignKeyEnum.FOLLOW_PLAN`。
- 新增/编辑表单按来源使用 `FOLLOW_PLAN_CUSTOMER / FOLLOW_PLAN_BUSINESS / FOLLOW_PLAN_CLUE`。
- 这些上下文 key 负责表单布局/联动；字段值 Service 仍统一落 FollowUpPlan Field/Blob。

Cordys `/system/modules` 的 `configCard.vue` 没有“跟进计划表单设置”专属入口，因此 MicroMatrix **不能为了本项自行新增该按钮**。

本次只补 MicroMatrix 底层 `followPlan` ModuleForm/Metadata，使现有统一 Metadata/动态字段组件有字段定义来源；三套上下文布局属于更大的 FormDesign 对齐，不在 DB-021 中虚构实现。

## 7. MicroMatrix 当前缺口

### 7.1 Prisma

当前 `FollowUpPlan`：

- 仍有 `customData Json?`。
- 没有 `FollowUpPlanField / FollowUpPlanFieldBlob`。

### 7.2 shared / ModuleForm

当前 `ModuleKey` 只有 12 类，未包含 `followPlan`；`MODULE_LABELS` 也没有跟进计划。

### 7.3 ResourceFieldValueService

当前覆盖 clue/customer/contact/opportunity/product/price/quotation/contract/payment/invoice/order，共 12 类；没有 FollowUpPlan 映射。

### 7.4 FollowUpPlansService

当前：

- create 直接写 `dto.customData`。
- update 合并 `existing.customData + dto.customData`。
- VO 直接回传 `plan.customData`。
- DTO 仍暴露 `customData?: Record<string, unknown>`。

### 7.5 Web

当前 FollowUpPlan PC/Mobile/Dialog：

- 不读取 Metadata。
- 不渲染动态字段。
- 不提交 `customData` 或 `moduleFields`。

因此 DB-021 若只改数据库，用户仍无法使用动态字段，不算完成。

## 8. 升级库 customData 迁移边界

当前开发库只读统计：

```text
follow_up_plans total=0
nonempty customData=0
keys=[]
```

但 forward migration 必须兼容已有升级库。

由于历史 MicroMatrix 没有 FollowPlan ModuleForm 定义，旧 JSON key 不一定有可证明的 fieldId，禁止猜测。迁移规则：

1. 先建立 FollowPlan ModuleForm/ModuleField 定义。
2. 只迁移能通过 `ModuleField.key` **精确匹配**到 fieldId 的旧 `customData` key。
3. 按字段类型决定 normal/blob。
4. 无法匹配的 key 不静默丢弃；在 migration/验收审计中计数并保留兼容列，直到确认 0 未映射后再 DROP `customData`。
5. 空库和当前默认库最终目标必须是运行时代码不再读写 `customData`。

## 9. 实施原则

- 复用 `ResourceFieldValueService`，不新增 FollowUpPlan 专用 JSON Repository。
- 与 Cordys 一样，删除计划时字段值同步删除。
- 线索转换、客户合并等复制/转挂逻辑必须同步迁移。
- PC/Mobile 复用现有动态字段组件/Metadata API。
- 不新增 Cordys `configCard.vue` 中不存在的 FollowPlan `/system/modules` 按钮。
- DB-021 只有在 runtime `FollowUpPlan.customData` 为 0、Field/Blob/API/UI/复制/筛选/空库全部通过后才能 `VERIFIED`。
