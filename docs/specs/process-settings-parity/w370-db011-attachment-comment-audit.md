# W3.7-9.3E DB-011 审批意见必填与附件源码审计

审计日期：2026-09-01

## 1. 审计范围

本单元关闭 DB-011 的最后一段：`requireComment`、`ApprovalInstanceAttachment`、审批动作附件 API/VO/UI，以及 DB-011 最终专项回归。

第一事实来源：

- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/domain/ApprovalInstanceAttachment.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/dto/request/ApprovalActionRequest.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/service/ApprovalActionService.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/service/ApprovalInstanceService.java`
- `CordysCRM/frontend/packages/web/src/components/business/crm-approval/components/crm-approval-detail.vue`
- `CordysCRM/frontend/packages/mobile/src/views/workbench/approval/approvalPopup.vue`

## 2. requireComment 事实

Cordys 的 `ApprovalFlow.requireComment` 表示审批意见必填。PC `crm-approval-detail.vue` 与 Mobile `approvalPopup.vue` 都把该配置直接传给输入组件的 `required` / rules，并在提交前阻止空意见。

后端 `ApprovalActionService.saveActionTask()` 本身没有再次读取 `requireComment` 做硬校验，因此 Cordys 当前实现主要依赖客户端约束。

MicroMatrix 9.3E 保持同一产品语义，同时采用更严格的 fail-closed：

- PC/Mobile 显示必填标记并阻止空意见；
- approve/reject API 在服务端读取实例关联 flow 的 `requireComment`，开启时再次拒绝空白 comment；
- `requireComment=false` 时 approve/reject 都允许空意见，不继续保留 MicroMatrix 早期“驳回固定必填”的简化规则。

## 3. ApprovalInstanceAttachment 数据模型

Cordys `approval_instance_attachment` 只有三个业务字段：

- `instanceId`：审批实例；
- `elementId`：本次审批动作生成的 element；
- `attachmentId`：附件实体。

它不是附件实体本身，而是审批实例与附件之间的动作级关系。

MicroMatrix 已有通用 `attachments` 表和本地存储服务，因此 9.3E 不复制附件二进制/元数据模型，只新增独立关系表，并同时建立到 `ApprovalInstance` / `Attachment` 的真实 FK：

```text
ApprovalInstanceAttachment
  id
  tenantId
  instanceId
  elementId
  attachmentId
  createdAt
```

同时保留 tenant/index/unique 约束，避免跨租户绑定和同一 element 重复挂同一附件。已进入审批历史的附件使用 `ON DELETE RESTRICT`，不能再由通用附件删除接口破坏历史事实。

## 4. elementId 绑定语义

Cordys `ApprovalActionService` 的真实绑定目标：

- approve / reject：`saveApprovalRecord()` 创建 `ApprovalRecord` 后，以 `record.id` 作为 `elementId`；
- BACK：以 `ApprovalReturnBackRecord.id` 作为 `elementId`；
- SIGN：以 `ApprovalAddSignTask.id` 作为 `elementId`。

因此 MicroMatrix 不把附件直接绑定 taskId，也不把所有附件粗暴挂到 instanceId。审批详情按 elementId 聚合后再映射回对应 record / back record / add-sign relation。

## 5. 撤回后重审与附件

Cordys `saveApprovalRecord()` 对“审批人撤回后同 task/node/round 再执行”做特殊处理：

- 如果已有 record，且新 comment 为空、attachmentIds 为空，则直接保留旧 record；
- 如果出现新意见或新附件，则删除旧 record，再创建新 record，并把新附件绑定到新 record.id。

MicroMatrix 9.3D 已实现 comment 侧 delete+create；9.3E 必须把附件也纳入同一判断，否则会出现“新附件提交但旧 record 被错误保留”的偏差。

删除旧 ApprovalRecord 时，还必须同步删除该 record 对应的 `ApprovalInstanceAttachment` 关系；附件实体本身是否删除由通用附件生命周期处理，不在审批 record 替换事务里直接物理删除文件。

## 6. 上传与绑定边界

现有 `/attachments/upload` 支持先上传未挂载附件。9.3E 动作 API 接收 `attachmentIds[]`，服务端绑定前必须校验：

- attachment 属于当前 tenant；
- attachment 存在；
- attachment 由当前操作人上传；
- attachment 尚未绑定到其它业务对象或审批动作，已经归档的附件不能被再次复用；
- 单次动作最多 20 个附件；
- 同一动作 element 不重复创建相同关系。

审批动作不要求附件必填；`requireComment` 只约束文字意见。

## 7. API / VO / UI

动作 DTO 扩展：

```text
attachmentIds?: string[]
```

覆盖：

- approve
- reject
- sign
- back

审批详情 VO 增加：

- flow `requireComment` capability；
- `approvalAttachments[]`，每项包含 relation/elementId + AttachmentVO。

PC/Mobile 在审批意见区域复用现有 attachment upload API，先上传临时附件，再随动作请求发送 attachmentIds。

## 8. 结论

9.3E 需要 **Migration 63**。正确实现是：**独立 ApprovalInstanceAttachment 关系表 + requireComment 双端/服务端硬约束 + approve/reject/SIGN/BACK 动作级附件绑定 + 撤回重审 record/attachment 一致性 + PC/Mobile 上传与详情展示**。

本单元全部通过后，DB-011 才能从 `IN_PROGRESS` 更新为 `VERIFIED`，下一执行单元切换到 **W3.7-9.4A DB-012 Condition / DEFAULT 图结构与条件 runtime**。
