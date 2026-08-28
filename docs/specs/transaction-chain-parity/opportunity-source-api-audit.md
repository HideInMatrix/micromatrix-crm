# W3.6.0 商机源码与 API 证据矩阵

## 1. 审计范围

本审计以 CordysCRM 源码为事实来源，覆盖 PC 商机列表/看板/详情、商机 Controller/Service/DTO/Mapper、阶段配置、关闭规则及自动 Listener、失败原因、`/system/modules` 商机卡片，以及当前 MicroMatrix 差异。

## 2. Cordys 页面入口

主要页面：

- `frontend/packages/web/src/views/opportunity/index.vue`
- `frontend/packages/web/src/views/opportunity/components/opportunityTable.vue`
- `frontend/packages/web/src/views/opportunity/components/billboard/*`
- `frontend/packages/web/src/views/opportunity/components/optOverviewDrawer.vue`
- `frontend/packages/web/src/views/opportunity/quotation.vue`

商机主页面同时存在列表和阶段看板；详情 Drawer 展示客户、联系人、负责人、阶段、动态字段、跟进等真实资源信息。

## 3. 商机主 API

`OpportunityController` 固定 `@RequestMapping("/opportunity")`。

| API | 方法 | 语义 |
| --- | --- | --- |
| `/opportunity/module/form` | GET | 商机表单 |
| `/opportunity/page` | POST | 商机分页 + 动态筛选 + DataScope |
| `/opportunity/statistic` | POST | 当前筛选统计 |
| `/opportunity/add` | POST | 新增 |
| `/opportunity/update` | POST | 更新 |
| `/opportunity/delete/{id}` | GET | 删除 |
| `/opportunity/batch/transfer` | POST | 批量转移负责人 |
| `/opportunity/batch/delete` | POST | 批量删除 |
| `/opportunity/get/{id}` | GET | 详情 |
| `/opportunity/update/stage` | POST | 更新阶段 |
| `/opportunity/batch/update` | POST | 批量更新 |
| `/opportunity/tab` | GET | 全部/部门 Tab 可见性 |
| `/opportunity/contact/list/{opportunityId}` | GET | 商机联系人 |
| `/opportunity/export-all` | POST | 导出全部 |
| `/opportunity/export-select` | POST | 导出选中 |
| `/opportunity/template/download` | GET | 导入模板 |
| `/opportunity/import/pre-check` | POST multipart | 导入预检 |
| `/opportunity/import` | POST multipart | 正式导入 |
| `/opportunity/sort` | POST | 看板阶段排序 |
| `/opportunity/chart` | POST | 图表 |

读、新增、更新、删除、转移、导入、导出和阶段动作都有独立权限/DataScope 证据；批量操作使用批量资源权限检查。

## 4. 商机直接表

### 4.1 `opportunity`

初始 DDL 位于 `migration/1.0.0/ddl/V1.0.0_6__opportunity.sql`。后续 migration 的最终语义包括：

- `customer_id` 最终允许为空；
- `contact_id` 最终允许为空；
- `products`、`expected_end_time` 最终允许为空；
- 新增 `actual_end_time`、`failure_reason`、`pos`；
- 初始 `status` 在 1.1.3 被删除。

核心字段为 `id/customer_id/name/amount/possible/products/organization_id/last_stage/stage/contact_id/owner/update_user/create_time/update_time/create_user/follower/follow_time/expected_end_time/actual_end_time/failure_reason/pos`。

### 4.2 动态字段

Cordys 使用 `opportunity_field` 与 `opportunity_field_blob`。当前 MicroMatrix `Opportunity.customData Json?` 只是旧实现，W3.6 必须切换到直接 Field/Blob 服务。

## 5. 商机阶段

直接表 `opportunity_stage_config` 来自 1.2.3 DDL，包含 `name/type/rate/afoot_roll_back/end_roll_back/pos/organization_id` 和完整创建/更新审计。

Controller `/opportunity/stage`：

- GET `/get`
- POST `/add`
- GET `/delete/{id}`
- POST `/update-rollback`
- POST `/update`
- POST `/sort`

Service 约束：最多 15 个阶段；添加支持相对目标节点插入；删除时至少保留一个进行中阶段；列表返回阶段是否已有业务数据；`afootRollBack/endRollBack` 为组织级开关；排序和配置修改写系统模块操作日志。

阶段类型只有 `AFOOT` 与 `END`；业务阶段枚举中成功/失败分别是 `SUCCESS/FAIL`。完结阶段以赢率区分成功和失败。

## 6. 商机关闭规则

直接表 `opportunity_rule` 包含 `name/organization_id/owner_id/scope_id/enable/auto/operator/condition/create_time/update_time/create_user/update_user`。

API：POST `/opportunity-rule/page|add|update`，GET `/opportunity-rule/switch/{id}|delete/{id}`。

`OpportunityRuleService` 证据：Scope/Owner 使用 JSON 文本并通过 UserExtend Scope 展开；多规则按 `createTime desc` 选择最新匹配；条件支持 AND/OR；新增、编辑、删除、启停均写 `SYSTEM_MODULE` 操作日志。

`OpportunityRuleListener` 只消费 `enable=true && auto=true` 规则。命中后写 `lastStage=当前 stage`，迁移到当前组织 `type=END && rate=0` 的失败阶段，并写 `failureReason=system`。

## 7. 商机失败原因

Cordys `configCard.vue` 使用 `ReasonTypeEnum.OPPORTUNITY_FAIL_RS`，与线索/客户原因使用同一字典配置体系。

当前 MicroMatrix 的 `DictionariesModule` 与 Web `DictionaryModule` 已预留 `OPPORTUNITY_FAIL_RS`，无需新建原因表；缺口是系统模块 Drawer 和商机失败阶段的业务校验接入。

## 8. `/system/modules` 商机卡片

Cordys 主操作：商机表单 `newForm`、报价表单 `newFormOpportunityQuotation`、商机阶段 `businessStepSet`；更多操作：商机关闭规则 `businessParamsSet`、商机失败原因 `OPPORTUNITY_FAIL_RS` 全局开关。

当前 `NavigationModulesView.vue`：

| Action | 状态 |
| --- | --- |
| 商机表单设置 | REAL：通用字段配置页 |
| 报价表单设置 | REAL/待报价直接字段复验 |
| 商机阶段设置 | **PLACEHOLDER** |
| 商机关闭规则 | **PLACEHOLDER** |
| 商机失败原因设置 | **PLACEHOLDER** |

W3.6.0 关闭前必须把后三项变为真实 Drawer/API。

## 9. 当前 MicroMatrix 差异

当前后端 `@Controller('opportunities')` 使用自定义 REST：`GET/POST /opportunities`、`PATCH /opportunities/:id`、`/opportunities/stages` 等，不是 Cordys `/opportunity/*`。

当前 Prisma 使用 `opportunity_stages/opportunities/opportunity_stage_logs/opportunity_items` 和 `Opportunity.customData JSONB`。主要差异：

- 阶段缺 `AFOOT/END`、rollback 和完整审计；
- 主记录使用 `stageId` relation，而 Cordys 保存阶段配置 ID 并保留 `lastStage`；
- 自定义 `wonAt/lostAt/remark/customData` 不是 Cordys 直接模型；
- 缺 `opportunity_rule` 与自动关闭任务；
- 手工输单只要求任意 `lostReason`，尚未消费 `OPPORTUNITY_FAIL_RS`。

## 10. 结论

W3.6.0 不能只把三个系统设置按钮接上现有 API；商机主数据、阶段、规则、动态字段和 API 契约必须同一执行单元破坏式对齐。task 1.1 已完成，下一步进入 **1.2 商机直接模型与 forward migration**。
