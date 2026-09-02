# W3.7-9.4C DB-012 节点字段权限实施计划

## 1. Schema / 契约

1. Migration 66：`ApprovalNodeApprover.fieldPermissions Json?`。
2. Shared：新增 `ApprovalFieldPermissionMode`、`ApprovalFieldPermission`，扩展 Flow node、detail、frozen node 与 `ApprovalInstanceVO`。
3. API DTO：增加字段权限 DTO，限制 `HIDDEN / VIEW / EDIT`。

## 2. Flow 保存校验

1. 根据 formType 映射 ModuleForm：quotation→quote、contract→contract、invoice→invoice、order→order。
2. 只允许当前租户该表单真实字段 ID。
3. 同一节点 fieldId 不得重复。
4. metadata `hidden=true` 的字段只能 HIDDEN；`formula / picture / member / dept` 等 9.4C 不支持审批内编辑的字段不能配置 EDIT。
5. fieldPermissions 进入版本差异比较，修改权限必须生成新 FlowVersion。

## 3. Runtime / 审批详情

1. `nodesSnapshot` 冻结 fieldPermissions。
2. `ApprovalInstanceVO` 返回 `currentNodeFieldPermissions` 和审批字段列表。
3. 当前普通 APPROVAL 待办：HIDDEN 不返回字段值，VIEW 只读，EDIT 可编辑。
4. SIGN 待办：原 HIDDEN/EDIT 全部降为 VIEW。
5. 无当前待办：全部字段只读。

## 4. 审批字段写 API

新增审批专用字段更新 API，由 `taskId` 锚定：

- task 必须 tenant + owner + PENDING；
- taskType 必须 APPROVAL；
- instance 必须 PENDING 且 task 位于当前 node/round；
- 请求 fieldId 必须在冻结节点 permission=EDIT 白名单；
- 只更新当前业务对象 ModuleForm 顶层字段；
- HIDDEN / VIEW / 未知字段 fail-closed；
- 更新后刷新业务 snapshot，保证后续审批详情和最终业务对象一致。

## 5. UI / 验收

- PC/Mobile 审批详情展示业务字段；HIDDEN 不渲染，VIEW 文本展示，EDIT 使用受控输入；
- 字段修改先保存，再 approve/reject；
- 9.4F 前不在流程设计器开放字段权限配置 UI，专项 Smoke 通过 API 创建带权限的流程夹具；
- Rules 覆盖 normalize/reference/edit gate/sign downgrade；
- isolated HTTP 覆盖字段权限 round-trip、冻结、hidden/view/edit、跨 task/跨租户/非当前节点 gate；
- Browser 覆盖 PC/Mobile 实际隐藏/只读/编辑与无 5xx/runtime exception；
- 回归 9.4A/9.4B、DB-010、DB-011 A～E、Root、空库、typecheck/lint/build/Prisma。
