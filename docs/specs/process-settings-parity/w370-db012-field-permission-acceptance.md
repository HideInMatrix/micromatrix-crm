# W3.7-9.4C DB-012 节点字段权限专项验收

验收日期：2026-09-02

## 1. 关闭范围

本次关闭 DB-012 9.4C：

- APPROVER 节点 `HIDDEN / VIEW / EDIT` 字段权限持久化；
- Flow write/detail 与 FlowVersion 版本比较中的字段权限契约；
- 实例创建时把实际审批 path 的字段权限冻结进 `nodesSnapshot`；
- 审批详情按当前审批节点真实裁剪业务字段；
- 普通当前审批人可修改明确标记为 EDIT 的字段；
- VIEW / HIDDEN / 未配置字段在服务端禁止绕过写入；
- SIGN 加签任务全部降级为 VIEW；
- PC / Mobile 审批中心真实消费字段权限并保存允许修改的字段。

9.4D pass/reject 后置字段更新、9.4E Webhook、9.4F 完整 Vue Flow 条件编辑仍未关闭，因此 DB-012 继续保持 `IN_PROGRESS`。

9.4F 前不开放流程设计器中的字段权限配置 UI；9.4C 先关闭 schema、API、runtime 与审批处理界面，避免把“能在 UI 里点选配置”和“运行时已经受约束”混为一个执行单元。

## 2. Cordys 对齐结论与安全边界

- Cordys `ApprovalNodeApproverRequest.fieldPermissions` 保存 `fieldId + HIDDEN/VIEW/EDIT`。
- Cordys 审批详情只向当前 `APPROVING` 审批人应用当前节点字段权限；加签节点把原权限降级为 VIEW。
- Cordys 表单详情组件用 HIDDEN 排除字段、VIEW 只读、EDIT 切换编辑控件。
- Cordys 业务更新旁路主要依赖 `approvalTaskId`/资源关系 gate，没有形成足够严格的逐字段服务端 whitelist。

MicroMatrix 按 R11 额外收紧服务端约束：前端是否渲染输入框不构成授权依据，最终写权限只认实例冻结节点中的 EDIT permission，并再次校验 tenant、task owner、PENDING/current node、字段所属 formType 与字段可编辑能力。

## 3. Schema 与配置契约

- Migration 66：`approval_node_approver.field_permissions JSONB`。
- `ApprovalFieldPermissionType = HIDDEN | VIEW | EDIT` 与 `ApprovalFieldPermission` 已进入 Shared 契约。
- Flow DTO、write/detail、`ApprovalFlowNodeInput`、`ApprovalFlowNodeDetail` 和冻结 `ApprovalNodeConfig` 已支持 `fieldPermissions`。
- 字段权限参与 FlowVersion 内容比较，并按 `fieldId` 稳定排序，避免仅顺序变化产生无意义版本。
- 未配置字段权限时保持属性缺省，不给历史线性 payload 强行补 `fieldPermissions: []`。
- 流程保存时校验：
  - fieldId 必须属于当前 formType；
  - 同节点 fieldId 不得重复；
  - metadata hidden 字段不能配置 VIEW/EDIT；
  - formula / picture / member / dept 等不安全类型不能配置 EDIT；
  - 系统字段只有显式安全白名单允许 EDIT。

项目没有发布历史数据，本次 migration 不做历史字段权限 backfill，也不为旧 `nodesSnapshot` 臆造权限；旧实例没有配置时按只读语义处理。

## 4. Runtime 与审批详情

- `resolveApprovalPath()` 在真实 APPROVER path 冻结 `fieldPermissions`，条件分支和 9.4A path 冻结语义不变。
- 新增 `GET /api/approvals/instances/:id`：审批列表不承担业务字段详情 N+1，打开详情时再读取当前实例字段视图。
- 审批详情只允许提交人或实例参与人读取；不是当前待审批人的查看场景全部只读。
- 当前普通 APPROVAL 待办使用冻结节点 HIDDEN/VIEW/EDIT：HIDDEN 不返回，VIEW 返回只读，EDIT 返回可编辑。
- SIGN 待办即使来源节点原为 EDIT，也统一降为 VIEW。
- 新增 `PATCH /api/approvals/tasks/:id/fields`：
  - 必须属于当前租户和当前用户；
  - task/instance 必须仍为 PENDING；
  - task 必须是当前 node/round 的普通 APPROVAL；
  - SIGN 明确拒绝修改；
  - 仅实例冻结节点显式 EDIT 的字段可写；
  - VIEW / HIDDEN / 未配置字段 fail-closed；
  - 自定义字段复用 `ResourceFieldValueService` 的类型、唯一性和持久化规则；
  - 可编辑系统字段使用显式 Prisma 白名单更新，并同步实例 `targetName/summary`。

## 5. 9.4C Rules / isolated HTTP

字段权限专项 Rules 覆盖：

- normalize/version compare；
- EDIT eligibility；
- HIDDEN/VIEW/EDIT detail projection；
- SIGN 全部降为 VIEW。

完整 Rules 最终结果：**136/136 PASS**。

`pnpm --filter @micromatrix/api smoke:w370-db012-field-permission` 从隔离 PostgreSQL 执行 **66/66 migrations + Seed + Shared/API build**，结果 PASS：

```text
flowRoundTrip            PASS
referenceGate            PASS
editEligibilityGate      PASS
hiddenFieldGate          PASS
duplicatePermissionGate  PASS
hiddenViewEditDetail     PASS
nonCurrentReadOnly       PASS
taskOwnerGate            PASS
viewWriteGate            PASS
editWrite                PASS
systemFieldWrite         PASS
signDowngrade            PASS
signWriteGate            PASS
frozenPermissionVersion  PASS
```

## 6. Browser 证据

新增 `scripts/w370-db012-field-permission-browser-smoke.mjs`，使用独立 invoice 测试夹具，不覆盖已有 contract/order 流程配置；执行结束自动撤销实例并清理 invoice、临时 flow 和 metadata fields。

结果：**21/21 PASS**，覆盖：

- PC 待我审批读取真实实例并打开详情；
- PC EDIT 字段出现输入控件、VIEW 只读、HIDDEN 不进入 DOM；
- PC 系统 `name` 安全字段可编辑；
- PC 自定义字段和系统字段保存后真实写回后端；
- Mobile 路由进入移动审批中心；
- Mobile EDIT / VIEW / HIDDEN 行为与 PC 一致；
- Mobile 修改后真实写回；
- Browser API 5xx = 0；
- Runtime exception = 0；
- console error = 0。

受影响审批中心相邻回归：

- DB-011 9.3E requireComment / Attachment PC+Mobile Browser：**28/28 PASS**。旧夹具显式补 `sameSubmitterAction=ALLOW`，避免 9.4B 默认 SKIP 改变附件专项的测试业务意图。
- DB-012 9.4A Condition Browser：**14/14 PASS**，高级图只读 fail-closed、无 PUT 覆盖、版本和 links 不变。
- `/system/modules` Browser 在干净 desktop CDP 环境：**47/47 PASS**。一次受前一条 mobile emulation 残留影响的无效运行已丢弃，重启桌面 Chrome 后全绿。

## 7. 相邻 API 回归

- DB-010 regression：PASS；当前 isolated 数据库使用 66 migrations。
- DB-011 9.3A migration smoke：PASS。
- DB-011 9.3B add-sign、9.3C return-back、9.3D approver revoke、9.3E attachment/comment HTTP：PASS。
- DB-012 9.4A Condition HTTP：PASS，**66 migrations**；graph round-trip、link.sort、DEFAULT、`NOT_EQUAL_ORIGINAL`、path 冻结均保持。
- DB-012 9.4B approver policy HTTP：PASS，**66 migrations**；empty/fallback/sameSubmitter、动态方向与三种 duplicate rule 均保持。
- 9.4A / 9.4B 旧 Smoke 中“当前 migration 总数”从 65 同步为 66；这只是当前 schema 基线更新，不改变历史单元语义。

## 8. 全局封板证据

- Root Smoke：**227/227 PASS**。
- Rules：**136/136 PASS**。
- `/system/modules` Browser：**47/47 PASS**。
- 9.4C Field Permission Browser：**21/21 PASS**。
- 9.3E 审批中心 Browser：**28/28 PASS**。
- 9.4A Condition Browser：**14/14 PASS**。
- 隔离空库：**66/66 migrations + Seed 2/2**，Seed 幂等；空库最终验证 **14/14 PASS**。
- workspace typecheck：PASS。
- ESLint：PASS。
- Shared/API/Web production build：PASS；Web **4144 modules transformed**。
- Prisma validate：PASS。
- `git diff --check`：PASS。

## 9. 结论

W3.7-9.4C 已满足 schema、FlowVersion 契约、服务端权限 gate、审批详情读模型、审批态字段更新、PC/Mobile Browser、专项 HTTP、相邻审批回归、Root、Rules、空库与静态构建封板要求，可以标记完成。

DB-012 继续 `IN_PROGRESS`。

下一执行单元：**W3.7-9.4D pass/reject 后置字段更新**。
