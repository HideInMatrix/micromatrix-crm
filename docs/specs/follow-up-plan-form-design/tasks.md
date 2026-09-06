# PLAN-FORM-001 跟进计划完整 FormDesign 与创建上下文任务

状态：`IN_PROGRESS`

- [x] A. Cordys 与 MicroMatrix FormDesign 源码审计。
  - [x] A1 确认后端只有 `FormKey.FOLLOW_PLAN = plan`，不存在 planClue/planBusiness ModuleForm。
  - [x] A2 确认三种 FormDesignKey 共享 `/follow/plan/module/form` 配置。
  - [x] A3 确认三种 key 的真实职责是 API 路由 + system field 上下文初始化。
  - [x] A4 确认 Cordys 真实“跟进计划表单设置”入口位于 system/module 客户管理更多菜单。
  - [x] A5 核对 MicroMatrix 单一 ModuleForm 与当前 system field 硬编码缺口，并冻结规格。
  - [x] A6 记录 Cordys `field.json` 与 MicroMatrix FollowPlan system metadata 差异：target 字段模型、contact 类型、estimated time、method、status、`planProduct`。
    - [x] 用户确认纳入 `planProduct`；继续源码审计确认 Cordys 通过 `moduleFields` 保存，不存在独立 productIds 核心模型。

- [ ] B. 表单设置入口与 shared runtime 契约。
  - [ ] B1 `followPlan` 加入 ModulesView 可配置模块。
  - [ ] B2 Customer 模块增加真实“跟进计划表单设置”入口。
  - [ ] B3 抽取 FollowPlan create-context/system-field runtime 契约，PC/Mobile 共用。
  - [ ] B4 Rules/typecheck 验证。
  - [ ] B5 加入稳定标准扩展字段 `planProduct: data_source_multiple(PRODUCT)`，并修复通用 `data_source_multiple` Field/Blob 数组序列化。

- [ ] C. PC 完整 FormDesign runtime。
  - [ ] C1 FollowUpPlanDialog 按完整 ModuleForm fields 顺序渲染 system + custom。
  - [ ] C2 hidden/required/span 对 system field 生效。
  - [ ] C3 Customer/Lead/Opportunity fixed context 与全局切换保持正确。
  - [ ] C4 PC Browser Smoke。

- [ ] D. Mobile 完整 FormDesign runtime。
  - [ ] D1 Mobile 按完整 fields 顺序和 mobile/hidden 渲染 system + custom。
  - [ ] D2 create context 与 PC 共用同一映射语义。
  - [ ] D3 Mobile Browser Smoke。
  - [ ] D4 Mobile 通用 DataSource 单选/多选控件支持 `planProduct` 选择与回显，不写产品专属临时选择器。

- [ ] E. formProp / 高级 FormDesign 收口。
  - [ ] E1 审计当前 ModulesView 与 Cordys formProp 的剩余差异。
  - [ ] E2 在通用 Metadata/FormDesign 层补齐本任务需要的 formProp，不写 FollowPlan 专属配置孤岛。
  - [ ] E3 Service/API/Browser 回归。

- [ ] F. 最终验收与封板。
  - [ ] F1 FollowPlan + Customer/Lead/Opportunity + FollowRecord 相邻回归。
  - [ ] F2 baseline reset + seed + validate/diff。
  - [ ] F3 API Rules + root typecheck/build/lint + Prettier + `git diff --check`。
  - [ ] F4 parity/project-progress/alignment-log/spec index 文档封板。
