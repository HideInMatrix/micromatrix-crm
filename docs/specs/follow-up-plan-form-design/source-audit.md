# PLAN-FORM-001 Cordys 源码审计

状态：`IN_PROGRESS`

## 1. FormDesignKeyEnum 与后端 FormKey 不是同一层

Cordys 前端 `FormDesignKeyEnum` 包含 `plan / planClue / planBusiness / followPlan` 四个 FollowPlan 相关 key；但后端 `FormKey` 只有 `FOLLOW_PLAN = plan`，不存在 `planClue / planBusiness` 两套 ModuleForm。

## 2. 三种创建上下文读取同一表单配置

Cordys `crm-form-create/config.ts` 将 `FOLLOW_PLAN_CUSTOMER / FOLLOW_PLAN_CLUE / FOLLOW_PLAN_BUSINESS` 全部映射到 `getCustomerFollowPlanFormConfig()`。该函数请求 `GET /follow/plan/module/form`，后端 `FollowUpPlanController` 固定返回 `FormKey.FOLLOW_PLAN = plan`。

因此 FollowPlan FormDesign 的真实配置真相源只有 `plan`。

## 3. FormDesign 设置入口真实存在

旧 DB-021 审计只检查 `configCard.vue`，所以留下了“没有 FollowPlan 设置入口”的不完整结论。继续审计确认：`system/module/index.vue` 的客户管理更多菜单明确包含 `followRecord` 与 `followPlan`；`followPlanDrawer.vue` 使用 `CrmFormDrawer(formKey = FOLLOW_PLAN_CUSTOMER = plan)`。

所以 MicroMatrix 应提供真实“跟进计划表单设置”入口，编辑的仍是单一 `followPlan` ModuleForm。

## 4. Cordys FormDesign 读写与字段模型

通用 Drawer 使用 `GET /module/form/config/{formKey}` 与 `POST /module/form/save`。保存 payload 包含 `formKey + formProp + fields[]`。表单级 `FormConfig` 包含 layout、labelPos、inputWidth、按钮配置、viewSize、linkProp；字段级属性直接存在 ModuleField/Blob，包括顺序、fieldWidth、required/readable/editable/mobile、options、defaultValue、显隐/联动等，不存在独立 layout table。

## 5. 三个 context key 的真正职责

Cordys `useFormCreateApi.specialFormFieldInit()`：

- CUSTOMER：`type=CUSTOMER`，`customerId=sourceId`；
- CLUE：`type=CLUE`，`clueId=sourceId`；
- BUSINESS：默认 Customer 类型，并带入 `opportunityId` 与商机关联客户；
- create/update/detail API 同样根据三个 context key 路由到对应业务 API。

因此它们是创建上下文，不是三套 FormDesign 数据。

## 6. MicroMatrix 当前实现

已经完成单一 `followPlan` ModuleForm、FollowUpPlan Field/Blob、system field metadata、PC DynamicForm 与 MobileDynamicForm custom field 往返。

当前缺口：

1. `ModulesView.vue` 的 `AVAILABLE_MODULES` 没有 `followPlan`，无真实设置入口；
2. `FollowUpPlanDialog.vue` 将关联对象、联系人、时间、方式、负责人、内容硬编码在模板中；
3. PC `dynamicFields` 主动过滤全部 system field，所以 FormDesign 对 system field 的顺序、span、hidden/required 不会影响创建/编辑；
4. Mobile 同样把 system fields 写死，只对 custom fields 使用 `MobileDynamicForm`。

## 7. Cordys `field.json` 与 MicroMatrix 当前 FollowPlan system metadata 差异

本轮继续审计 `CordysCRM/backend/crm/src/main/resources/form/field.json` 后，确认 Cordys FollowPlan 默认 FormDesign 字段与 MicroMatrix 当前 `MODULE_SYSTEM_FIELDS.followPlan` 之间存在以下直接差异：

| 语义 | Cordys `field.json` | MicroMatrix 当前 | 审计结论 |
| --- | --- | --- | --- |
| 跟进类型 | `planType / type`，SELECT，控制 Customer/Clue 相关字段显隐，mobile=true | `targetType`，SELECT | 语义接近，但字段 key 和显隐模型不同；MicroMatrix 当前通过 `targetType + targetId` 聚合目标对象语义 |
| 客户 | `planCustomer / customerId`，DATA_SOURCE(CUSTOMER)，required，mobile=true | 没有独立 `customerId` FormDesign 字段，统一为 `targetId` | Cordys 是独立业务字段；MicroMatrix 当前为统一 target adapter，后续 runtime 不能假装两者物理模型完全相同 |
| 线索 | `planClue / clueId`，DATA_SOURCE(CLUE)，required，mobile=true | 没有独立 `clueId` FormDesign 字段，统一为 `targetId` | 同上 |
| 商机 | `planOpportunity / opportunityId`，DATA_SOURCE(OPPORTUNITY)，mobile=true | 没有独立 `opportunityId` FormDesign 字段，统一为 `targetId` | 同上 |
| 联系人 | `planContact / contactId`，DATA_SOURCE(CONTACT)，required，mobile=true | `contactId`，当前 metadata 为普通 text | MicroMatrix 当前字段类型未表达真实业务选择器语义 |
| 预计开始时间 | `planStartTime / estimatedTime`，`DATE_TIME`，`dateType=date`，required，mobile=true | `estimatedAt`，当前 metadata 为 `date` | 字段类型与 required 语义存在差异，应在 PLAN-FORM-001 内继续核对并收口 |
| 跟进方式 | `planMethod / method`，SELECT，默认选项为“到访=1 / 电话=2”，required，mobile=true | `method`，当前 metadata 为 text；当前业务运行时还支持电话/拜访/微信/邮件/会议/其他等字符串 | 不可直接把 MicroMatrix 现有业务值强改成 Cordys 1/2；需要单独决定产品语义后再调整值域 |
| 负责人 | `planOwner / owner`，MEMBER，required，hasCurrentUser | `ownerId`，member，required | 语义基本一致，key 不同 |
| 意向产品 | `planProduct`，`DATA_SOURCE_MULTIPLE(PRODUCT)` | 当前 FollowUpPlan metadata 未内置该稳定字段；现有 Field/Blob 已支持扩展字段 | **正式纳入 PLAN-FORM-001；按标准扩展 ModuleField 保存到 FollowUpPlan Field/Blob** |
| 预计沟通内容 | `planContent / content`，TEXTAREA，required，mobile=true | `content`，textarea，required | 基本一致 |
| 状态 | Cordys FollowPlan 创建 FormDesign 默认字段中未发现 status | `status` 当前被放入 `MODULE_SYSTEM_FIELDS.followPlan` | 这是明确差异；是否应继续出现在创建/编辑 FormDesign 中需按当前产品交互与 Cordys 行为收口 |

特别说明：

- 后续源码核对确认 Cordys `FollowUpPlanAddRequest / FollowUpPlanUpdateRequest` 只有 `moduleFields`，没有 `productIds / products`；`BusinessModuleField` 也没有 `planProduct` 核心属性映射。由此确认 `planProduct` 本身就是 ModuleField，不需要独立关系模型。
- MicroMatrix 应复用 `follow_up_plan_field / follow_up_plan_field_blob`。`planProduct` 使用稳定标准扩展 key，字段类型为 `data_source_multiple`，`config.dataSourceType=PRODUCT`，不得塞进 `customData`，也不得创建额外双写真相源。
- `ResourceFieldValueService` 现有筛选编译已经按 JSON 数组处理 `data_source_multiple`，但保存/反序列化曾漏掉该类型；PLAN-FORM-001 必须同步修复通用 Field/Blob 数组序列化，避免“可配置但不可正确保存”。
- `method` 的 Cordys 默认值域与 MicroMatrix 当前业务值域不同，也不能在没有产品决策的情况下直接改历史语义。

## 8. 结论

PLAN-FORM-001 正确模型是“一套 `followPlan` ModuleForm + 一套 FollowPlan Field/Blob + 三种 create context 初始化规则 + PC/Mobile 完整 system/custom FormDesign runtime”，不是三套 context layout table。
