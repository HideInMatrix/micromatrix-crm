# W3.7-9.3E DB-011 requireComment / ApprovalInstanceAttachment 实施计划

## 1. Schema

1. Migration 63 新增 `approval_instance_attachments`。
2. Prisma 增加 `ApprovalInstanceAttachment`，关系指向 `ApprovalInstance` 与现有 `Attachment`，不复制附件实体。
3. 建立 tenant/instance/element/attachment 索引与 element+attachment 唯一约束；已归档附件使用 FK `RESTRICT` 防止历史文件被物理删除。

## 2. Runtime

1. `HandleTaskDto / AddSignTaskDto / ReturnBackTaskDto` 增加 `attachmentIds`。
2. approve/reject 读取 flow `requireComment` 并服务端校验。
3. 抽取 attachment tenant/uploader/未归档校验与关系写入函数，单次最多 20 个附件。
4. `saveApprovalRecord()` 返回最终 record，并把 attachmentIds 纳入撤回重审判断；delete+create 时先清旧 relation。
5. SIGN 绑定 `ApprovalAddSignTask.id`。
6. BACK 绑定最新 `ApprovalReturnBackRecord.id`。
7. 详情按 instance 一次读取 attachment relations + attachments，组装动作级附件 VO。

## 3. API / UI

1. 解除 `requireComment` 的 422 未实现门禁。
2. ApprovalInstanceVO 返回 `requireComment` 和 `approvalAttachments`。
3. PC 审批详情支持附件上传、删除待提交附件、必填意见提示。
4. Mobile 审批详情实现同一能力。
5. 只在动作成功后清空临时选择；上传失败保持当前表单。

## 4. 专项验收

HTTP Smoke：

- 63/63 migrations + Seed；
- requireComment=true 时 approve/reject 空意见 400；
- requireComment=false 时 approve/reject 空意见都可通过；
- 跨租户 attachmentId fail-closed；
- 已归档审批附件不能删除或重复绑定；
- approve/reject record attachment relation；
- 撤回后无新 comment/attachment 保留旧 record/relation；
- 撤回后新增附件触发 record delete+create，新 relation 指向新 record；
- SIGN relation elementId=ApprovalAddSignTask.id；
- BACK relation elementId=ApprovalReturnBackRecord.id；
- detail 返回附件元数据。

Browser Smoke：

- PC requireComment 必填提示；
- PC 上传附件并 approve；
- Mobile requireComment 必填提示；
- Mobile 上传附件并 approve/reject；
- 详情时间线可看到附件；
- API 5xx=0 / Runtime exception=0。

## 5. 回归与关闭

- Rules；
- 9.3A task/record；
- 9.3B add-sign HTTP/Browser；
- 9.3C return-back HTTP/Browser；
- 9.3D revoke HTTP/Browser；
- DB-010 regression；
- Root Smoke 227/227；
- `/system/modules` Browser；
- clean DB 63/63 + 双 Seed；
- workspace typecheck/lint/build；
- Prisma validate；
- `git diff --check`。

全部通过后：

- 9.3E 标记完成；
- W3.7-9.3 DB-011 父项关闭；
- backlog DB-011 -> `VERIFIED`；
- 下一执行指针 -> W3.7-9.4A。

关闭证据：[W3.7-9.3E DB-011 requireComment / ApprovalInstanceAttachment 专项验收](./w370-db011-attachment-comment-acceptance.md)
