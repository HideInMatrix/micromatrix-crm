# W3.7-9.4F DB-012 高级流程设计器与统一图写契约实施计划

## 1. Shared / API 契约收口

1. `ApprovalFlowWriteInput.createLinks` 改为必填。
2. Create/Update DTO 的 `createLinks` 改为必填数组。
3. `ApprovalFlowConfigService` 删除 `isExplicitGraph / createLinearGraph` 和高级图特殊锁；所有 create/update 一律执行 `validateGraph + createGraph`。
4. 新增完整 graph equality，避免统一显式图后每次保存都无条件新建版本。
5. API Rules 增加 legacy payload rejection、无变化不增版本、link 变化增版本覆盖。

## 2. 调用方迁移

1. 建立测试/脚本共享的显式图 helper：
   - legacy 线性夹具在调用端转换成 START/APPROVER/END + links；
   - detail round-trip 必须保留完整节点类型、节点高级配置和 links。
2. 迁移 root Smoke、W3.6 交易链审批 Smoke、DB-010/011/012 Smoke 与 Browser fixture。
3. 最终 grep 不允许生产 Service 继续存在后端线性推导兼容。

## 3. Vue Flow 图编辑器

1. `ApprovalFlowDrawer` 的 form 同时持有 `createNodes/createLinks`，新建默认生成三节点显式图。
2. `ApprovalFlowCanvas` 改为 nodes/links 双 v-model，并渲染 START/APPROVER/CONDITION/DEFAULT/END。
3. 提供 APPROVER / CONDITION / DEFAULT 添加、节点删除、连线创建/删除、拖动画布布局。
4. 节点/边操作只修改业务 graph model；position 不写入 API。
5. 保存前运行与后端一致的 graph validator，并给出可操作错误提示。

## 4. 节点高级配置

1. APPROVER：审批对象、动态层级/方向、多人审批、抄送、空审批人、同提交人策略。
2. 字段权限：加载对应 metadata，逐字段 HIDDEN/VIEW/EDIT；EDIT 选项只对与服务端一致的安全字段开放。
3. pass/reject 后置字段：字段、值、enable。
4. pass/reject Webhook：enable/url/method/header/body/describe + `/approvals/flows/webhook/test`。
5. CONDITION：AND/OR、字段、operator、value；DEFAULT 无条件配置。
6. 流程级开放 duplicateApproverRule；`allowBatchProcess` 保持禁用。

## 5. 专项验收

1. 新增/改造 API graph contract Smoke：legacy reject、线性显式图、条件图、版本判定。
2. 改造 9.4A Browser：高级图可编辑、真实 PUT、条件/DEFAULT/link 保留，不再检查只读锁。
3. 新增 9.4F Browser：从 UI 新建/编辑显式条件图并覆盖节点高级设置、字段权限、post config 与 webhook test。
4. 回归 DB-010、DB-011 A～E、9.4A～E、Root、Rules、空库双 Seed、typecheck/lint/build、Prisma validate、`git diff --check`。

## 6. 文档与状态

证据齐全后：

- `tasks.md` 标记 9.4F 完成；
- DB-012 deferred backlog 标记 `VERIFIED`；
- parity/alignment/project-progress 切换到 W3.7-9.5；
- 输出 9.4F acceptance；
- 不在 9.4F 提前执行 W3.7 总提交，scoped commit 留到 9.5 按任务要求统一处理。

关闭证据：[W3.7-9.4F DB-012 高级流程设计器与统一图写契约专项验收](./w370-db012-advanced-designer-acceptance.md)。9.4F 已完成，DB-012 已 `VERIFIED`，执行指针进入 W3.7-9.5。
