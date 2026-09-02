# W3.7-9.4F DB-012 高级流程设计器与统一图写契约专项验收

日期：2026-09-02

## 1. 关闭范围

本单元关闭 DB-012 最后一项高级流程编辑缺口：

- 流程写契约统一为显式 `createNodes + createLinks`；
- 服务端删除 `createNodes-only` 线性 payload 自动推导；
- Vue Flow 从只读/受控线性展示升级为可编辑业务图；
- CONDITION / DEFAULT / APPROVER 高级配置可真实编辑并 round-trip；
- 9.4B～9.4E 已完成的审批人异常策略、字段权限、pass/reject 后置字段和 Webhook 在流程设计器中正式开放；
- 流程级 `duplicateApproverRule` 解除历史 UI 禁用，`allowBatchProcess` 继续保持未实现能力的 fail-closed 状态；
- 现有业务 Smoke / Browser 调用方迁移为调用端显式图，不再依赖服务端双协议兼容。

9.4F 不新增 migration，数据库基线保持 **68 migrations**。

## 2. API / Shared 图契约

- `ApprovalFlowWriteInput.createLinks` 为必填数组。
- Create / Update DTO 的 `createLinks` 为必填数组。
- `ApprovalFlowConfigService` create/update 统一执行 graph validation + graph persistence，不再存在 `createLinearGraph()` / `isExplicitGraph()` 分流。
- graph version compare 同时比较节点与连接；只修改流程描述等非图内容不会无条件制造新 FlowVersion，图节点/边发生业务变化时才生成新版本。
- production source scan：`apps/api/src`、`apps/web/src`、`packages/shared/src` 中 `createLinearGraph`、`isExplicitGraph` 和旧“高级图禁止线性覆盖保存”文案均为 **0**。

## 3. Vue Flow 高级设计器

流程设计步骤现在真实维护 nodes / links 双模型并支持：

- START / APPROVER / CONDITION / DEFAULT / END；
- 节点新增、删除、拖拽布局；
- 显式连接建立/删除及同源分支 `sort`；
- CONDITION 的 AND / OR、字段、operator、value；
- APPROVER 的指定成员、动态层级/方向、ANY/ALL、抄送、empty approver、same submitter；
- HIDDEN / VIEW / EDIT 字段权限；
- pass / reject 字段后置更新；
- pass / reject Webhook enable/url/method/header/body/describe 与安全测试连接；
- 流程级 duplicate approver rule。

前端 position 仅作为画布状态，不进入业务 API 真相源；保存前执行与服务端约束对应的 graph validator。

## 4. Browser 专项

### 4.1 9.4F Advanced Designer

`pnpm smoke:w370-db012-advanced-designer-browser`

结果：**25 passed / 0 failed**。

覆盖：

- 独立/可恢复 Browser fixture；
- API 显式图创建；
- 高级流程进入编辑抽屉和 Vue Flow；
- APPROVER 高级配置面板；
- EDIT 字段权限回显；
- pass post-field 回显与编辑；
- empty/same submitter/Webhook 配置入口；
- Webhook loopback 测试真实调用安全 API 并被拒绝；
- duplicateApproverRule UI 开放；
- PUT 统一图写契约；
- 节点高级配置完整 round-trip；
- post-field `PASS_V2` 持久化；
- Webhook disabled 配置保留；
- Browser API 非预期 5xx = 0；
- Runtime exception = 0。

### 4.2 9.4A 条件图回归

旧 9.4A Browser 已从“高级图只读保护”更新成真实可编辑验收：

`pnpm smoke:w370-db012-condition-browser`

结果：**18 passed / 0 failed**。

真实验证 CONDITION 节点编辑、统一 nodes+links PUT、新 FlowVersion、CONDITION/DEFAULT/links 完整保留，API 5xx=0、Runtime exception=0。

### 4.3 相邻审批中心 Browser

- 9.4C Field Permission：**21/21 PASS**。
- 9.3B Add Sign：**18/18 PASS**。
- 9.3C Return Back：**17/17 PASS**。
- 9.3D Approver Revoke：**24/24 PASS**。
- 9.3E Attachment / requireComment：**28/28 PASS**。

9.3B Browser 同步修正两类已变化测试前提：需要提交人本人审批的夹具显式设置 `sameSubmitterAction=ALLOW`；待办查找不再假定目标一定落在审批中心第一页。

## 5. API / Runtime 回归

当前 68 migration schema 基线下保持：

- DB-010 generic approval regression：PASS；
- DB-011 task-record migration / add-sign / return-back / approver-revoke / attachment-comment：PASS；
- DB-012 approver policy / field permission / post field / Webhook：PASS；
- 9.4A Condition / DEFAULT graph contract 与 runtime：PASS；
- Root `pnpm smoke`：**227/227 PASS**；
- API Rules：**141/141 PASS**。

## 6. 空库与静态封板

- `pnpm smoke:w366-empty-db`：**68/68 migrations + Seed 2/2 PASS**；`seedCountsStable=true`。
- workspace `pnpm typecheck`：PASS。
- `pnpm lint`：PASS。
- Shared + API + Web production build：PASS。
- Web production build：**4145 modules transformed**。
- `pnpm --filter @micromatrix/api exec prisma validate`：PASS。
- `git diff --check`：PASS。

## 7. 结论

W3.7-9.4F 的实现、Browser、HTTP/runtime、空库和静态检查均已满足关闭条件。DB-012 的 9.4A～9.4F 至此全部完成，可以从 `IN_PROGRESS` 切换为 `VERIFIED`。

下一执行单元：**W3.7-9.5 最终验收与文档封板**。
