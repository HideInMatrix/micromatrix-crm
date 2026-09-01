# W3.7-9.3E DB-011 requireComment / ApprovalInstanceAttachment 专项验收

验收日期：2026-09-01

## 1. 关闭范围

本轮关闭 DB-011 最后一个执行单元 **9.3E**：

- `ApprovalFlow.requireComment` 真实进入 approve/reject runtime；
- `ApprovalInstanceAttachment` 动作级附件关系；
- approve/reject、SIGN、BACK 附件绑定；
- 审批人撤回后同 task/node/round 重审时 record/attachment 一致性；
- PC/Mobile 上传、必填提示和历史附件展示；
- DB-011 9.3A～9.3D 全量相邻回归。

源码审计：[w370-db011-attachment-comment-audit.md](./w370-db011-attachment-comment-audit.md)。

实施计划：[w370-db011-attachment-comment-plan.md](./w370-db011-attachment-comment-plan.md)。

## 2. Migration 63 / 数据模型

新增 migration：

`20260901143000_w370_approval_instance_attachments`

建立 `approval_instance_attachments`：

- `tenantId`
- `instance_id`
- `element_id`
- `attachment_id`
- `created_at`

约束：

- `instance_id -> approval_instances.id ON DELETE CASCADE`；
- `attachment_id -> attachments.id ON DELETE RESTRICT`；
- `(instance_id, element_id, attachment_id)` 唯一；
- tenant/instance、element、attachment 均有索引。

当前 `default`：**63 migrations / no pending migrations**。

## 3. requireComment runtime

`ApprovalFlowConfigService` 已只解除 `requireComment` 的未实现门禁；`allowBatchProcess` 和非 `FIRST_ONLY` duplicate rule 继续 fail-closed。

服务端行为：

- `requireComment=true`：approve/reject 空白意见均返回 400；
- `requireComment=false`：approve/reject 均允许空意见；
- UI capability 只用于展示，服务端每次动作重新读取实例所属 flow；
- PC/Mobile 同步展示必填状态并在发请求前阻止空意见。

这同时删除了 MicroMatrix 早期“reject 无条件强制意见”的简化差异，恢复到 Cordys 配置语义。

## 4. 动作级附件语义

动作 DTO 均支持 `attachmentIds?: string[]`：

- approve / reject：绑定 `ApprovalRecord.id`；
- BACK：绑定 `ApprovalReturnBackRecord.id`；
- SIGN：绑定 `ApprovalAddSignTask.id`；
- AFTER SIGN 同时产生原审批人的 ApprovalRecord，因此同一附件按 Cordys 同时绑定 record element 与 add-sign element。

服务端绑定前强制：

- 当前 tenant；
- 当前 uploader；
- 附件尚未绑定其它业务对象；
- 附件尚未进入其它审批动作历史；
- 单次最多 20 个；
- 重复 ID 去重。

进入审批历史后，通用 `DELETE /attachments/:id` 会返回 400，数据库 FK 同时提供最后一道 `RESTRICT` 保护。

## 5. 撤回后重审

沿用 9.3D 的 Cordys 同槽位语义并补齐附件：

- 原 task/node/round 已有 APPROVE record；
- 重审时没有新 comment、没有新 attachment：保留旧 record 和旧 relation；
- 出现新 comment、新 attachment 或 result 改变：先删除旧 element relation，再 delete+create ApprovalRecord，再把新附件绑定到新 record id；
- 不产生同一 task/node/round 的重复 ApprovalRecord。

## 6. 9.3E HTTP Smoke

命令：

`pnpm smoke:w370-db011-attachment-comment`

结果：**PASS**。

隔离环境：**63/63 migrations + Seed + Shared/API build**。

覆盖结果：

- `requireCommentConfig=true`
- `requireCommentGate=true`
- `optionalComment=true`
- `optionalRejectComment=true`
- `crossTenantAttachmentGate=true`
- `mountedAttachmentGate=true`
- `approvalRecordAttachment=true`
- `boundAttachmentDeleteGate=true`
- `addSignAttachment=true`
- `addSignAfterDualRelation=true`
- `backAttachment=true`
- `revokeReapproveAttachmentReplacement=true`
- `detailAttachmentVo=true`
- `finalApproval=true`

## 7. 9.3E Browser Smoke

命令：

`pnpm smoke:w370-db011-attachment-comment-browser`

结果：**28/28 PASS**。

真实浏览器链路覆盖：

- PC `requireComment` 必填展示；
- PC 空意见不发送 approve；
- PC 通过真实 `<input type=file>` 调用 `/attachments/upload`；
- PC 携带附件 approve 成功；
- PC 后端 detail 返回动作附件；
- PC 已处理时间线重新展示历史附件；
- Mobile `requireComment` 必填展示；
- Mobile 空意见不发送 approve；
- Mobile 真实上传文件并携带附件 approve；
- Mobile detail 返回动作附件；
- Runtime exception = 0；
- API 5xx = 0。

Browser 脚本首轮曾因把 textarea placeholder 当 `innerText` 检测而超时，第二轮又因多个可见 popup 选择了错误 textarea；两处均属于验收脚本定位问题。修正 DOM 断言后同一业务现场最终 28/28，全程没有业务 runtime exception 或 API 5xx。

## 8. DB-011 相邻回归

Browser：

- 9.3B BEFORE/AFTER 加签：**17/17**；
- 9.3C 节点退回：**17/17**；
- 9.3D 审批人任务撤回 PC/Mobile：**24/24**。

HTTP / DB：

- 9.3A task/record migration smoke：PASS；
- 9.3B add-sign HTTP：PASS，实际 deploy 为 **63 migrations**；
- 9.3C return-back HTTP：PASS，实际 deploy 为 **63 migrations**；
- 9.3D approver-revoke HTTP：PASS，实际 deploy 为 **63 migrations**；
- DB-010 approval regression：PASS，**63 migrations**。

9.3B/C/D Smoke 的结果摘要中旧硬编码 migration 数字已同步修正为 63，防止后续验收日志与实际 migrate deploy 数量不一致。

## 9. 全局封板门槛

- Rules：**127/127**；
- Root Smoke：**227/227**；
- `/system/modules` Browser：**47/47**，API 5xx=0、Runtime exception=0；
- 空库：**63/63 migrations + Seed #1 + Seed #2**；
- Seed counts stable：PASS；
- workspace typecheck：PASS；
- ESLint：PASS；
- Shared/API/Web production build：PASS，Web **4144 modules transformed**；
- Prisma validate：PASS。

空库最终关键计数保持：

- tenant 1；
- department 4；
- role 3；
- user 4；
- module form 8；
- module field 68；
- module field blob 68；
- contract stage 7；
- sales order stage 7。

## 10. 关闭结论

DB-011 五个子单元全部完成：

- 9.3A ✅ task nodeId/nodeRound/type/action + ApprovalRecord
- 9.3B ✅ BEFORE/AFTER + nested add-sign
- 9.3C ✅ node return-back + ReturnBackRecord + round rebuild
- 9.3D ✅ approver task revoke
- 9.3E ✅ requireComment + ApprovalInstanceAttachment + PC/Mobile

因此 **W3.7-9.3 / DB-011 可以正式更新为 `VERIFIED`**。

下一执行单元：**W3.7-9.4A / DB-012：Condition / DEFAULT 图结构、条件 DTO 与 updateFields runtime**。
