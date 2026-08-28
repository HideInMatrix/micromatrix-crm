# W3.6 交易链深度对齐任务清单

> 状态：已立项，执行中。
>
> 每个大模块的 `/system/modules` 对应卡片检查属于关闭门槛，不是后续补漏任务。

## 0. 全程执行约束

- [x] 0.1 建立 W3.6 需求、设计和任务三件套。
- [ ] 0.2 每个大模块先输出 Cordys 源码证据矩阵，再实施代码。
- [ ] 0.3 每个大模块完成后检查 `/system/modules` 对应卡片，所有 Cordys action 必须变成真实功能或有明确后续依赖。
- [ ] 0.4 每个大模块独立完成 API/数据库 Smoke、Browser Smoke、根回归、typecheck、ESLint、build、Prisma 与 diff 检查后再提交。

## 1. W3.6.0 商机

- [x] 1.1 固化商机源码、API、直接模型和 `/system/modules` 证据矩阵。
  - 证据：[商机源码与 API 证据矩阵](./opportunity-source-api-audit.md)。
- [x] 1.2 建立商机直接模型与 forward migration。
  - 对齐 `opportunity/opportunity_field/opportunity_field_blob/opportunity_stage_config/opportunity_rule`。
  - 删除 `customData` 作为商机字段真相；清理旧自定义阶段模型/历史模型业务依赖。
  - API TypeScript typecheck 通过；40/40 migration 空库复放、空库 Seed、现库副本升级和真实 `default` migrate deploy 均通过。
  - 证据：[商机直接模型与迁移审计](./opportunity-direct-model-audit.md)。
- [x] 1.3 重建 `/opportunity/*` 主 API。
  - module/form、page、statistic、add/update/delete、batch transfer/delete/update、get、update/stage、tab、contact list、import/export/template、sort、chart。
  - 迁移 User View、跟进、首页筛选、客户 360、通知和 Mobile 调用方。
  - 2026-08-28 验证：API/Web typecheck 全绿；`apps/web/src/api` 已无 `/opportunities` 旧 API；真实运行时 `module/form/page/statistic/stage/get/tab` 与 add→get→stage→batch update 写链路通过，Smoke 数据已清理。
- [x] 1.4 对齐商机阶段与失败原因。
  - `/opportunity/stage/*`、AFOOT/END、rate、rollback、排序、15 阶段限制。
  - `OPPORTUNITY_FAIL_RS` 手工失败原因校验，自动失败保留 `system`。
  - 2026-08-28 验证：阶段 add/update/update-rollback/sort/delete 专项 Smoke 通过并恢复默认 rollback；失败原因关闭时允许无原因、开启后无原因 400、有效原因 ID 可进入失败阶段且详情翻译为原因名称，临时数据全部清理。
- [x] 1.5 对齐商机关闭规则与自动关闭任务。
  - `/opportunity-rule/*`、Scope/Owner、AND/OR 条件、启停、auto、最佳规则匹配与自动失败终态。
  - 2026-08-28 验证：`smoke:w360-opportunity-rule` 通过 CRUD、Scope 展开、最新规则优先、自动关闭和 `failureReason=system`，Smoke 数据自动清理；定时任务与 Cordys `TaskCleanupJob` 同为每日 03:00。
- [x] 1.6 重建商机 Vue 页面。
  - Cordys 列表/看板、详情、批量、转移、阶段、联系人、跟进、报价跳转、深链。
  - 2026-08-28 验证：`smoke:w360-opportunity-browser` 18/18；列表/看板/详情/批量/深链全绿，无 API 5xx、无 Runtime exception；修复深链首次挂载时详情 Drawer 不触发 load 的问题。
- [x] 1.7 `/system/modules` 商机卡片专项收口。
  - 商机表单设置：REAL。
  - 报价表单设置：REAL，并登记报价直接字段后复验点。
  - 商机阶段设置：PLACEHOLDER → REAL。
  - 商机关闭规则：PLACEHOLDER → REAL。
  - 商机失败原因：PLACEHOLDER → REAL。
  - 2026-08-28 Browser Smoke 已实际打开阶段/关闭规则/失败原因三个 Drawer，均为真实 API 功能入口。
- [x] 1.8 商机最终专项验收与提交。
  - 2026-08-28 最终验收：根 Smoke 224/224；Rules 114/114；`smoke:w360-opportunity-rule` 全绿；`smoke:w360-opportunity-browser` 18/18；typecheck、ESLint、production build 全绿。
  - Prisma `40 migrations found`，真实 `default` 数据库 `Database schema is up to date!`；W3.6 临时 migration replay/data clone 数据库已删除。
  - 最终回归同时修复两个跨模块直接模型遗漏：客户合并与联系人商机关联检查由旧 `tenantId` 改为 `organizationId`；根 Smoke 已迁除全部旧 `/opportunities` API 假设。

## 2. W3.6.1 产品与价格表

- [ ] 2.1 源码与 DDL 证据矩阵。
- [ ] 2.2 产品与价格表直接字段值/API/页面。
- [ ] 2.3 `/system/modules` 产品卡片：产品表单 + 价格表表单全部 REAL。
- [ ] 2.4 专项验收与提交。

## 3. W3.6.2 报价

- [ ] 3.1 源码与 DDL 证据矩阵。
- [ ] 3.2 `opportunity_quotation`、Field/Blob、审批/快照直接模型。
- [ ] 3.3 Cordys 报价 API、审批、作废、导出/PDF 与 User View。
- [ ] 3.4 报价 Vue 页面与商机/合同链路。
- [ ] 3.5 回查 `/system/modules` 商机卡片“报价表单设置”，确认直接字段模型已真实消费。
- [ ] 3.6 专项验收与提交。

## 4. W3.6.3 合同

- [ ] 4.1 源码与 DDL 证据矩阵。
- [ ] 4.2 合同直接字段、审批/快照、作废/归档与交易关联。
- [ ] 4.3 Cordys 合同 API 与页面。
- [ ] 4.4 `/system/modules` 合同卡片：合同表单、回款计划表单、回款记录表单、工商抬头必填、发票表单、合同阶段按依赖关闭缺口。
- [ ] 4.5 专项验收与提交。

## 5. W3.6.4 回款与发票

- [ ] 5.1 回款计划/记录源码与直接模型。
- [ ] 5.2 发票源码、审批、作废与直接模型。
- [ ] 5.3 Cordys API、页面、通知/到期任务。
- [ ] 5.4 回查 `/system/modules` 合同卡片的回款计划、回款记录、发票入口全部 REAL。
- [ ] 5.5 专项验收与提交。

## 6. W3.6.5 订单

- [ ] 6.1 源码与 DDL 证据矩阵。
- [ ] 6.2 订单直接字段/API/状态流/页面。
- [ ] 6.3 `/system/modules` 订单卡片：订单表单 + 订单状态流全部 REAL。
- [ ] 6.4 专项验收与提交。

## 7. W3.6.6 全交易链最终验收

- [ ] 7.1 商机 → 报价 → 合同 → 回款/发票 → 订单连续生命周期 Smoke。
- [ ] 7.2 全角色/DataScope/第二租户权限矩阵。
- [ ] 7.3 隔离空库全 migration + 双次 Seed + runtime Smoke。
- [ ] 7.4 `/system/modules` 最终卡片全量复查，DB-001～005、DB-021、DB-022 更新状态。
- [ ] 7.5 根 Smoke、rules、Browser、typecheck、ESLint、production build 全绿并更新总文档。
