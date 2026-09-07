# PLAN-FORM-001 Cordys 源码审计

状态：`VERIFIED`

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

PLAN-FORM-001 已完成单一 `followPlan` ModuleForm、FollowUpPlan Field/Blob、完整 system/custom runtime 与 PC/Mobile 共用 create-context 语义：

1. `followPlan` 已进入 `ModulesView.vue`，Customer 模块也已有真实“跟进计划表单设置”入口；
2. PC `FollowUpPlanDialog.vue` 已按同一 `fields[]` 顺序混排 system/custom，system field 通过专用 adapter 保留业务选择器；
3. Mobile 已按 `hidden / mobile / required` 消费同一 ModuleForm，并补齐负责人、联系人、意向产品；
4. `planProduct` 已作为 `data_source_multiple(PRODUCT)` 标准扩展 ModuleField 使用现有 FollowUpPlan Field/Blob；
5. Browser Smoke 已真实覆盖 PC/Mobile 创建、产品多选保存与编辑回显。

Browser Smoke 同时暴露了一个通用 Seed 根因：`apps/api/prisma/seed.ts` 曾在 ModuleForm system template create 时硬编码 `mobile=false`，update 时也不回写模板 mobile，导致源码里的 `mobile:true` 在 fresh DB 被 Seed 吃掉。该问题已改为始终按 `template.mobile ?? false` 落库；fresh reset + seed 后实查 FollowPlan 除隐藏 `status` 外 8 个创建字段均为 `mobile=true`。

## 7. Cordys `field.json` 与 MicroMatrix 当前 FollowPlan system metadata 差异

本轮继续审计 `CordysCRM/backend/crm/src/main/resources/form/field.json` 后，确认 Cordys FollowPlan 默认 FormDesign 字段与 MicroMatrix 当前 `MODULE_SYSTEM_FIELDS.followPlan` 之间存在以下直接差异：

| 语义         | Cordys `field.json`                                                                  | MicroMatrix 当前                                                                             | 审计结论                                                                                                |
| ------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 跟进类型     | `planType / type`，SELECT，控制 Customer/Clue 相关字段显隐，mobile=true              | `targetType`，SELECT                                                                         | 语义接近，但字段 key 和显隐模型不同；MicroMatrix 当前通过 `targetType + targetId` 聚合目标对象语义      |
| 客户         | `planCustomer / customerId`，DATA_SOURCE(CUSTOMER)，required，mobile=true            | 没有独立 `customerId` FormDesign 字段，统一为 `targetId`                                     | Cordys 是独立业务字段；MicroMatrix 当前为统一 target adapter，后续 runtime 不能假装两者物理模型完全相同 |
| 线索         | `planClue / clueId`，DATA_SOURCE(CLUE)，required，mobile=true                        | 没有独立 `clueId` FormDesign 字段，统一为 `targetId`                                         | 同上                                                                                                    |
| 商机         | `planOpportunity / opportunityId`，DATA_SOURCE(OPPORTUNITY)，mobile=true             | 没有独立 `opportunityId` FormDesign 字段，统一为 `targetId`                                  | 同上                                                                                                    |
| 联系人       | `planContact / contactId`，DATA_SOURCE(CONTACT)，required，mobile=true               | `contactId` metadata 保持稳定 key，runtime 由 FollowPlan system adapter 提供真实联系人选择器 | 物理 FieldType 不强行伪装成 Cordys DATA_SOURCE；实际业务选择语义已由统一 runtime adapter 保证           |
| 预计开始时间 | `planStartTime / estimatedTime`，`DATE_TIME`，`dateType=date`，required，mobile=true | `estimatedAt`，`datetime`，PC/Mobile 均按时间控件渲染                                        | 时间控件语义已收口；是否必填继续遵循 MicroMatrix 当前产品规则，不伪造历史值                             |
| 跟进方式     | `planMethod / method`，SELECT，默认选项为“到访=1 / 电话=2”，required，mobile=true    | `method`，`select`，保留电话/拜访/微信/邮件/会议/其他现有字符串值域                          | FormDesign 类型已收口；值域属于明确产品语义差异，不做破坏性 1/2 替换                                    |
| 负责人       | `planOwner / owner`，MEMBER，required，hasCurrentUser                                | `ownerId`，member，required                                                                  | 语义基本一致，key 不同                                                                                  |
| 意向产品     | `planProduct`，`DATA_SOURCE_MULTIPLE(PRODUCT)`                                       | `planProduct: data_source_multiple(PRODUCT)`，进入 FollowUpPlan Field/Blob                   | **已完成；PC/Mobile 真实多选、保存、编辑回显通过**                                                      |
| 预计沟通内容 | `planContent / content`，TEXTAREA，required，mobile=true                             | `content`，textarea，required                                                                | 基本一致                                                                                                |
| 状态         | Cordys FollowPlan 创建 FormDesign 默认字段中未发现 status                            | `status` 保留为 system metadata，但默认 `hidden=true / mobile=false`                         | 不进入创建表单，状态仍由既有状态机动作管理；避免删除系统字段再额外造状态兼容逻辑                        |

特别说明：

- 后续源码核对确认 Cordys `FollowUpPlanAddRequest / FollowUpPlanUpdateRequest` 只有 `moduleFields`，没有 `productIds / products`；`BusinessModuleField` 也没有 `planProduct` 核心属性映射。由此确认 `planProduct` 本身就是 ModuleField，不需要独立关系模型。
- MicroMatrix 应复用 `follow_up_plan_field / follow_up_plan_field_blob`。`planProduct` 使用稳定标准扩展 key，字段类型为 `data_source_multiple`，`config.dataSourceType=PRODUCT`，不得塞进 `customData`，也不得创建额外双写真相源。
- `ResourceFieldValueService` 现有筛选编译已经按 JSON 数组处理 `data_source_multiple`，但保存/反序列化曾漏掉该类型；PLAN-FORM-001 必须同步修复通用 Field/Blob 数组序列化，避免“可配置但不可正确保存”。
- `method` 的 Cordys 默认值域与 MicroMatrix 当前业务值域不同，也不能在没有产品决策的情况下直接改历史语义。

## 8. formProp / 高级 FormDesign 审计

Cordys `FormConfig` 的正式结构包含：`layout / labelPos / inputWidth / optBtnContent / optBtnPos / viewSize / linkProp`。逐项核对后，本单元不能机械复制全部属性：

| Cordys formProp | Cordys 实际语义                                                      | MicroMatrix 决策                                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layout`        | 设计器切换 1～4 列时，直接批量改每个字段的 `fieldWidth = 1 / layout` | **不新增第二套布局真相源**。MicroMatrix 已以字段 `span` 持久化实际栅格宽度，继续以 `span` 为唯一布局事实                                                                                              |
| `labelPos`      | `top / left`，运行时直接控制字段标题位置                             | **纳入本单元**，作为通用 formProp 保存，并由 PC DynamicForm 消费                                                                                                                                      |
| `inputWidth`    | 控件固定宽度或占满当前列                                             | **不纳入本单元**。MicroMatrix 控件统一占满所在栅格列，布局宽度由 `span` 表达                                                                                                                          |
| `optBtnContent` | 保存、保存并继续、取消的文本与 enable                                | **不纳入本单元**。MicroMatrix 当前没有“保存并继续”业务动作，不能只改按钮文案伪造语义                                                                                                                  |
| `optBtnPos`     | 表单底部按钮左/中/右排列                                             | 暂不纳入；当前项目已有统一 Dialog/Drawer 操作区规范，不为 FollowPlan 单独破例                                                                                                                         |
| `viewSize`      | Cordys 创建 Drawer：small=50%、medium=75%、large=100%                | **纳入本单元**，映射为 MicroMatrix PC 表单容器 small/medium/large 尺寸；Mobile 不消费 PC 容器尺寸                                                                                                     |
| `linkProp`      | 跨表单场景字段带入/联动                                              | **不在 FollowPlan 本单元新增 UI**。Cordys `formAttr.vue` 的表单联动开放列表本身不包含 FollowPlan；MicroMatrix 后端已有通用 `linkProp` 校验/runtime，后续需要时在独立通用 FormDesign 单元完善设计器 UI |

因此 E 阶段最小正确实现为：通用 Metadata 层提供 formProp 的读取与 PATCH，当前 UI 只编辑并保留 `labelPos / viewSize`，PATCH 必须合并旧 `formProp`，不得覆盖未来/既有 `linkProp` 等未知属性；FollowPlan PC runtime 消费这两个属性，Mobile 继续只消费字段级 `mobile`。

## 9. 结论

PLAN-FORM-001 正确模型是“一套 `followPlan` ModuleForm + 一套 FollowPlan Field/Blob + 三种 create context 初始化规则 + PC/Mobile 完整 system/custom FormDesign runtime”，不是三套 context layout table。
