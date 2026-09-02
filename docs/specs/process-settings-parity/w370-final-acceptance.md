# W3.7 高级审批深化最终验收与封板

日期：2026-09-02

## 1. 封板范围

W3.7 依次关闭三组审批深化缺口：

- **DB-010 / W3.7-9.2**：通用审批资源快照、UPDATE 变更上下文、reject/cancel 恢复与 DELETE 延迟执行；
- **DB-011 / W3.7-9.3**：稳定 task node/round/action、ApprovalRecord、BEFORE/AFTER 加签、节点退回、审批人任务撤回、requireComment 与动作附件；
- **DB-012 / W3.7-9.4**：Condition/DEFAULT、审批人异常策略与动态方向、duplicate rule、字段权限、pass/reject 后置字段、Webhook 安全发送/审计，以及 Vue Flow 高级流程设计器和统一 `nodes + links` 图写契约。

W3.7-9.5 不新增业务 migration；最终数据库基线保持 **68 migrations**。

## 2. Prisma / migration 封板

正式执行：

- Prisma Client generate：PASS；
- `prisma validate`：PASS；
- `prisma migrate status`：**68 migrations / Database schema is up to date**；
- `prisma migrate deploy`：**No pending migrations to apply**；
- 隔离空库 replay：**68/68 migrations PASS**；
- 同库 Seed #1 / #2：PASS，`seedCountsStable=true`。

## 3. DB-010 / DB-011 / DB-012 最终专项

最终按当前源码重新执行完整审批专项链，组合命令 exit 0：

### DB-010

- generic resource snapshot lifecycle：PASS；
- quotation / invoice / order approval regression：PASS；
- legacy `business_snapshot` column absent；
- UPDATE reject/revoke rollback、DELETE delayed execution、跨租户 restore fail-closed 均保持。

### DB-011

- task-record migration smoke：PASS；
- add-sign HTTP：PASS；
- return-back HTTP：PASS；
- approver-revoke HTTP：PASS；
- attachment / requireComment HTTP：PASS。

### DB-012

- Condition / DEFAULT HTTP：PASS；
- approver policy HTTP：PASS；
- field permission HTTP：PASS；
- post-field HTTP：PASS；
- Webhook HTTP：PASS。

所有 isolated runtime 均从当前 **68 migration** schema 起跑。

## 4. Browser 最终验收

### 流程设置

- 9.4F Advanced Designer：**25/25 PASS**；
- 9.4A Condition editable graph：**18/18 PASS**；
- 9.4C Field Permission PC/Mobile：**21/21 PASS**。

高级流程 Browser 已真实验证：

- Vue Flow 节点与 links 编辑；
- CONDITION / DEFAULT；
- 审批人异常策略；
- 字段 HIDDEN/VIEW/EDIT；
- pass/reject post-field；
- Webhook 配置与安全连接测试；
- duplicate approver rule；
- 统一 nodes+links PUT 和不可变 FlowVersion；
- API 非预期 5xx = 0；
- Runtime exception = 0。

### 审批中心

- Add Sign：**18/18 PASS**；
- Return Back：**17/17 PASS**；
- Approver Revoke：**24/24 PASS**；
- Attachment / requireComment：**28/28 PASS**。

### `/system/modules`

- 最终模块设置 Browser：**47/47 PASS**；API 5xx=0、Runtime exception=0。

## 5. Root / Rules / workspace

最终封板批次整体 exit 0：

- Root `pnpm smoke`：**227/227 PASS**；
- API Rules：**141/141 PASS**；
- `pnpm smoke:w366-empty-db`：68/68 + 双 Seed PASS；
- workspace `pnpm typecheck`：PASS；
- `pnpm lint`：PASS；
- Shared/API/Web production build：PASS；
- Web production build：**4145 modules transformed**；
- Prisma validate：PASS；
- `git diff --check`：PASS。

## 6. runtime legacy / deferred scan

production roots `apps/api/src`、`apps/web/src`、`packages/shared/src` 精确扫描结果：

```text
createLinearGraph=0
isExplicitGraph=0
当前版本禁止线性覆盖保存=0
createNodes-only=0
businessSnapshot=0
```

Prisma `ApprovalTask` 当前不存在旧 `comment` 字段；审批动作意见由独立 ApprovalRecord 承担。

流程设置高级开关最终状态：

- 发起人撤回：REAL；
- 审批人撤回：REAL；
- 审批人加签：REAL；
- 审批意见必填：REAL；
- duplicate approver rule：REAL；
- 节点条件/字段权限/post-field/Webhook：REAL；
- `allowBatchProcess`：仍显式 disabled，并标注等待任务中心批量处理能力接入；未把未实现能力伪装成完成。

DB-007/008/015 的 `DISCOVERED` 与 DB-023 `DEFERRED` 属于 W3.7 之外的全项目后续范围，均已有明确 backlog 去向，不影响 DB-010/011/012 的 `VERIFIED` 结论。

## 7. 结论

W3.7-9.2、9.3、9.4、9.5 的业务实现、数据模型、API/runtime、Browser、空库、静态检查与 legacy scan 已全部满足关闭标准。

**W3.7 高级审批深化正式完成。DB-010、DB-011、DB-012 均保持 `VERIFIED`。**

W3.7 之后尚未冻结新的正式 task 编号；后续应从 `project-progress.md` 与 `cordys-parity.md` 的剩余协同/元数据/搜索/平台治理差异中重新立项，不在本封板单元中臆造 W3.8 范围。
