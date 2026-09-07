# PLAN-FORM-001 跟进计划完整 FormDesign 与创建上下文需求

状态：`VERIFIED`

## 1. 目标

对齐 Cordys FollowPlan 的真实 FormDesign 语义：后端只有一套 `FormKey.FOLLOW_PLAN = plan`；Customer / Clue / Business 三个 `FormDesignKeyEnum` 是创建上下文 key，不是三套布局或字段真相源；三种上下文都读取同一份 FollowPlan ModuleForm 配置。

MicroMatrix 已有 `followPlan` ModuleForm + Field/Blob，但 PC/Mobile 仍把 system 字段硬编码在模板中，只动态渲染 custom fields。本单元把 system + custom fields 都收口到完整 ModuleForm runtime。

## 2. Cordys 已确认契约

- `GET /follow/plan/module/form` 固定返回 `FormKey.FOLLOW_PLAN = plan`。
- Web 的 `FOLLOW_PLAN_CUSTOMER / FOLLOW_PLAN_CLUE / FOLLOW_PLAN_BUSINESS` 都调用同一个 `getCustomerFollowPlanFormConfig()`。
- 三个 key 只负责 Customer/Clue/Opportunity API 路由，以及 `type`、`customerId / clueId / opportunityId` 等 system field 的上下文初始化。
- `system/module/index.vue` 客户管理更多菜单真实提供“跟进计划表单设置”，Drawer 编辑的仍是 `FOLLOW_PLAN_CUSTOMER = plan`。

## 3. 必须完成

1. `followPlan` 进入真实“跟进计划表单设置”入口。
2. 表单设置仍编辑单一 `followPlan` ModuleForm，禁止新增 `planBusiness / planClue` 持久化模型。
3. PC `FollowUpPlanDialog` 与 Mobile FollowPlan form 消费完整 ModuleForm 字段顺序、hidden、required、span/mobile 等属性。
4. system field 不得再因为模板硬编码而绕过 FormDesign；custom field 继续使用现有 Field/Blob。
5. Customer / Lead / Opportunity 三类创建上下文继续正确锁定或初始化关联对象。
6. 保存继续走现有统一 FollowUpPlansService DTO，不新增兼容 API、双写或 legacy 转换层。

## 4. 非目标

- 不新增三套 Context FormDesign 表。
- 不复制三套 FollowUpPlan Field/Blob 或 Service。
- 不修改已封板的评论、提醒、状态机、转记录和 DataScope 规则。
- 不保留当前硬编码 system field 模板作为“兼容层”。
- Cordys `field.json` 中的 `planProduct`（意向产品）正式纳入本单元：字段类型为 `DATA_SOURCE_MULTIPLE(PRODUCT)`，作为 FollowPlan 的稳定标准扩展 ModuleField 保存到现有 FollowUpPlan Field/Blob，不新增独立 Prisma 产品关系表。
- Cordys `planMethod` 的“到访=1 / 电话=2”默认值域不直接覆盖 MicroMatrix 当前跟进方式语义；是否调整值域另行按产品需求决定。

## 5. 已确认纳入的 `planProduct`

- Cordys FollowPlan 默认 FormDesign 存在 `planProduct: DATA_SOURCE_MULTIPLE(PRODUCT)`。
- Cordys `FollowUpPlanAddRequest / FollowUpPlanUpdateRequest` 没有 `productIds / products` 核心属性，产品值随 `moduleFields` 保存；`BusinessModuleField` 也没有 `planProduct` 核心映射。因此该字段属于 FollowPlan 标准扩展 ModuleField，不是独立业务列。
- MicroMatrix 按同一边界实现：`planProduct` 使用稳定 key、`data_source_multiple`、`dataSourceType=PRODUCT`，值进入 `follow_up_plan_field_blob`；不得新增 `FollowUpPlanProduct` 关系表，也不得塞进 `customData`。
- PC/Mobile 必须都能选择、回显多个产品；保存、编辑、列表/详情读取以及筛选所使用的 Field/Blob 真相源保持一致。
- `planProduct` 已按该边界实现并通过 PC/Mobile 真实选择、保存与编辑回显验收；继续使用 FollowUpPlan Field/Blob 作为唯一真相源。
- 本单元未新增产品关系表、兼容 DTO 或双写层，FormDesign 只负责字段配置和运行时渲染。

## 6. 验收

- 修改 `followPlan` 字段顺序、span、hidden/required 后 PC 创建/编辑真实生效。
- Mobile 按同一字段顺序和 mobile/hidden 规则渲染。
- Customer / Lead / Opportunity 上下文创建均保持正确关联对象。
- 三种上下文共用同一 FollowPlan ModuleForm，不产生布局漂移。
- FollowPlan Field/Blob、评论、转记录及相邻模块回归全绿。
- baseline、Rules、root typecheck/build/lint、Prettier、`git diff --check` 全绿后才可 `VERIFIED`。
