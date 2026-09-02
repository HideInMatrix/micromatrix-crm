# W3.7-9.4C DB-012 节点字段权限源码审计

审计日期：2026-09-02

## 1. 本单元范围

本单元只关闭 DB-012 的节点字段权限和审批详情约束：

- APPROVER 节点保存 `fieldId + HIDDEN / VIEW / EDIT`；
- 字段权限随 FlowVersion 冻结到实例节点快照；
- 当前普通审批人按节点权限查看/编辑审批详情字段；
- 加签任务把原节点字段权限全部降级为 VIEW；
- 非当前审批人只读；
- 服务端校验字段 ID 属于当前表单，并拒绝审批人修改 VIEW/HIDDEN 字段。

9.4D pass/reject 后置字段更新、9.4E Webhook、9.4F 流程设计器完整字段权限配置 UI 不在本单元范围。

## 2. Cordys 源码事实

主要依据：

- `ApprovalNodeApprover.fieldPermissions`：节点以 JSON 保存字段权限；
- `FieldPermissionDTO`：`fieldId + permissionType`；
- `FieldPermissionTypeEnum`：`HIDDEN / VIEW / EDIT`；
- `ApprovalFlowService`：创建版本时序列化 `fieldPermissions`，详情反序列化回显；
- `ApprovalInstanceService.setCurrentNodeFieldPermissions()`：普通审批返回当前节点权限；加签时把当前节点全部权限改为 VIEW；
- Web `formPermissionTab.vue`：未配置字段默认 VIEW，字段不可读则只能 HIDDEN，不可编辑字段不能配置 EDIT；只使用顶层字段；
- Web `crm-approval-detail.vue`：只有当前用户存在 `APPROVING` task 时才把 `currentNodeFieldPermissions` 传给业务详情，其它场景返回空权限即只读；
- Web `crm-form-description/index.vue`：HIDDEN 字段不渲染，只有 EDIT 字段进入编辑控件。

## 3. Cordys 后端约束缺口

Cordys `ResourcePermissionService` 在请求携带 `Approval-Task-Id / approvalTaskId` 时，只校验：

1. task 存在；
2. 当前用户是 task approver；
3. task instance 的 resourceId 与请求 resourceId 相同。

该路径没有再次按 `fieldPermissions` 对请求字段做白名单过滤。因此浏览器正常操作会受 UI 约束，但直接构造请求存在修改 VIEW/HIDDEN 字段的空间。

MicroMatrix 的 R11 明确要求“在审批详情/处理界面真实约束字段可见和可编辑行为”，所以 9.4C 在复刻 Cordys UI 语义的同时增加服务端 EDIT 白名单校验，不机械复制该薄弱点。

## 4. MicroMatrix 当前缺口

- `ApprovalNodeApprover` 尚无字段权限持久化；
- Shared/DTO/Flow detail/`nodesSnapshot` 尚无 fieldPermissions；
- `ApprovalInstanceVO` 尚无当前节点权限与可编辑资源字段；
- `/approvals` PC/Mobile 当前只有流程历史、意见、附件和动作，没有字段详情；
- 业务 update API 没有 approval task 上下文，也没有审批字段白名单校验。

## 5. 9.4C 设计结论

- Migration 66 在 `approval_node_approvers` 增加 JSON `field_permissions`；项目未发布，不做旧数据 backfill。
- 流程保存时使用当前租户对应 `quote / contract / invoice / order` ModuleForm 顶层字段校验 fieldId；重复字段拒绝。
- 未显式提供 fieldPermissions 时按 Cordys 语义视为“全部 VIEW”，不需要把所有 VIEW 项强制写入数据库。
- 实例冻结节点配置时同时冻结 fieldPermissions；后续流程版本或权限配置变化不影响在途实例。
- 审批详情由服务端返回当前用户的 effective field permissions：普通待办使用冻结节点配置；SIGN 全部 VIEW；无当前待办时不提供 EDIT。
- 审批字段编辑使用审批专用 task API，不让客户端通过普通业务 update 路径绕过字段权限；服务端只接受当前普通 APPROVAL task、当前 node/round、PENDING 状态且 permission=EDIT 的字段。
- 9.4C 只支持 ModuleForm 顶层字段；复杂产品子表等继续只读，与 Cordys `formPermissionTab.vue` 不展开 subFields 的行为一致。
