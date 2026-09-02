# W3.7-9.4D DB-012 pass/reject 后置字段更新源码审计

审计日期：2026-09-02

## 1. Cordys 事实源

本单元仅覆盖字段更新，不提前实现 9.4E Webhook。

关键源码：

- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/service/ApprovalActionService.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/service/ApprovalFlowService.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/service/ApprovalResourceService.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/dto/ApprovalPostConfigDTO.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/dto/ResourceApprovalFieldUpdateParam.java`
- `CordysCRM/frontend/packages/lib-shared/models/system/process.ts`

## 2. 配置模型

Cordys 在 APPROVER 节点同时保存：

- `passPostConfig`
- `rejectPostConfig`

其中 `ApprovalPostConfig` 包含 `fieldUpdateConfigs` 和 `webHookConfig`。9.4D 只实现 `fieldUpdateConfigs`：

```text
fieldId
fieldValue
enable
```

未启用或 `fieldValue == null` 的配置运行时不执行。

## 3. 运行时顺序

### 3.1 人工同意

Cordys 只有在当前 APPROVER 节点真正满足“节点通过”条件时才执行 `passPostConfig`，随后才解析并进入下一节点。ANY 节点不会因为同节点其它未决任务存在而重复执行；ALL/顺序审批只在最后满足节点完成时执行一次。

### 3.2 人工驳回

Cordys 在实例进入 REJECTED、业务审批状态同步后执行当前节点 `rejectPostConfig`，然后才执行 UPDATE 审批的快照恢复。

这个顺序会导致“驳回后字段更新”在 UPDATE 审批场景中可能被旧快照恢复覆盖。MicroMatrix 不复制这个有歧义的副作用，9.4D 采用最终业务语义：先完成 DB-010 快照恢复，再执行 reject 后置字段更新，使明确配置的驳回后动作成为最终状态。

### 3.3 自动通过

Cordys 在 empty approver、same submitter、duplicate 等自动通过节点上同样调用 `updateApprovalPostField(... APPROVE ...)`，因此 9.4B 自动通过路径也必须执行 pass 后置字段更新。

### 3.4 加签

加签任务本身不是独立流程节点。只有根 APPROVER 节点真正完成并进入下一节点时才执行该节点 pass 后置字段更新；SIGN task 自身不单独执行 post config。

## 4. MicroMatrix 当前差异

9.4C 之前：

- `ApprovalNodeApprover` 没有 pass/reject post config；
- Flow DTO/Shared/snapshot 没有相关字段；
- `approveTask/rejectTask/advance` 不执行节点后置字段更新；
- 已具备 9.4C 的安全字段写入边界，可复用为 post-field runtime。

## 5. 安全与一致性决定

9.4D 必须满足：

1. Flow 保存时 fieldId 必须属于当前 formType；
2. 同一 post config 不允许重复 fieldId；
3. disabled 配置允许保留但不执行；
4. enabled 配置必须有非 null `fieldValue`；
5. 只允许 9.4C `isApprovalEditableField()` 同一安全字段集合，避免 post action 绕过服务端 whitelist；
6. 运行时只使用实例冻结 `nodesSnapshot` 中的 post config，不读取后来修改的当前 FlowVersion；
7. 自定义字段继续走 `ResourceFieldValueService`，系统字段继续走显式 whitelist；
8. post update 后同步 `ApprovalInstance.targetName/summary`，避免审批中心显示旧名称/金额；
9. DELETE 审批最终通过后资源会被删除，最终节点 pass post update 若资源已不存在必须通过执行顺序避免“先删后改”。

## 6. 本单元边界

9.4D 不做：

- Webhook 配置、测试连接、发送与安全审计（9.4E）；
- 流程设计器 after-approval UI（统一在 9.4F 开放高级配置面）；
- 旧未发布数据 backfill。

结论：9.4D 应先补 schema/契约/冻结配置，再复用 9.4C 安全资源写入层实现人工 APPROVE、REJECT 和自动 APPROVE 的节点完成后字段动作。
