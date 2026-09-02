# W3.7-9.4D DB-012 pass/reject 后置字段更新专项验收

验收日期：2026-09-02

## 1. 关闭范围

本次关闭 DB-012 9.4D：

- APPROVER 节点 pass/reject 后置字段配置持久化；
- Flow write/detail、FlowVersion 内容比较与实例 `nodesSnapshot` 冻结；
- 人工 APPROVE 节点真正完成时执行 pass 后置字段；
- REJECT 在 DB-010 UPDATE 快照恢复后执行 reject 后置字段，使显式 reject 配置成为最终业务值；
- AUTO_PASS 节点执行 pass 后置字段；
- ANY/ALL 节点只在节点真正完成时执行一次；
- 自定义字段复用 `ResourceFieldValueService`，系统字段复用 9.4C 安全白名单；
- 后置更新后同步审批实例 `targetName/summary`；
- DELETE 审批保持“节点 pass 后置字段先执行，最终审批完成后才删除资源”的既有顺序。

9.4E Webhook 与 9.4F 完整 Vue Flow 高级编辑器仍未关闭，因此 DB-012 继续保持 `IN_PROGRESS`。

## 2. Cordys 对齐结论与一致性决定

- Cordys APPROVER 节点保存 pass/reject 两组字段更新配置，并按 `enable && fieldValue != null` 执行。
- 人工通过只有在当前节点真实完成时才触发 pass；ALL 节点中第一个审批人通过不会提前执行。
- 自动通过仍属于节点完成动作，因此必须执行 pass 后置字段。
- SIGN 加签任务本身不独立执行 post config；回到根 APPROVER 节点真正完成时再执行。
- Cordys reject 链路存在“先 post、后恢复 UPDATE 快照”导致显式 reject 值可能被旧快照覆盖的顺序。MicroMatrix 按 DB-010 的资源恢复语义收紧为“先恢复、后 reject post”，保证流程配置的 reject 后置值是最终业务状态。

## 3. Schema 与配置契约

- Migration 67 为 `ApprovalNodeApprover` 新增 `pass_post_config JSONB` 与 `reject_post_config JSONB`。
- Shared/DTO 新增 `ApprovalFieldUpdateConfig` / `ApprovalPostConfig`，当前 9.4D 只实现字段更新配置；Webhook 留到 9.4E。
- Flow 保存校验：
  - fieldId 必须属于当前 formType；
  - 同一 action 内 fieldId 不得重复；
  - disabled 配置允许保存但不执行；
  - enabled 配置必须有非 null 值；
  - enabled 字段必须属于 9.4C 的安全可编辑字段集合。
- normalize 会裁剪 fieldId、保留 disabled 配置并按 fieldId 稳定排序，避免仅配置顺序变化产生无意义 FlowVersion。
- 新实例只冻结创建当时实际 path 的 post config；后续修改 Flow 不影响已在途实例。

项目没有发布历史数据，本次 migration 不做旧配置或旧 `nodesSnapshot` backfill。

## 4. Runtime

- 普通 APPROVAL 的通过动作在 ANY/ALL 完成判定之后调用统一 post-field helper，因此每个节点只在真实完成点执行一次。
- REJECT 路径先执行 DB-010 `restorePreUpdateSnapshot()`，随后执行 reject post；HTTP 专项已验证主字段恢复、显式 reject 自定义字段成为最终值且资源快照被消费。
- AUTO_PASS 在自动任务/ApprovalRecord 审计事实写入后执行 pass post，再继续 advance。
- post runtime 只读取实例冻结 `nodesSnapshot`，不读取后来修改的当前 FlowVersion。
- 自定义字段沿用资源字段值服务的类型/唯一性/持久化规则；安全系统字段走显式 Prisma 白名单。
- post 后重新读取业务资源展示信息，并同步审批实例 `targetName/summary`。

## 5. Rules / isolated HTTP

完整 Rules 最终结果：**137/137 PASS**。新增覆盖 post config normalize/version compare，并保持既有审批规则全部通过。

`pnpm --filter @micromatrix/api smoke:w370-db012-post-field` 从隔离 PostgreSQL 执行 **67/67 migrations + Seed + Shared/API build**，最终稳定结果 PASS：

```text
flowRoundTrip                PASS
referenceGate                PASS
duplicateGate                PASS
enabledValueGate             PASS
safeFieldGate                PASS
frozenPostVersion            PASS
manualPass                   PASS
disabledNoop                 PASS
manualReject                 PASS
updateRejectRestoreThenPost  PASS
allNodeCompletionOnly        PASS
autoPassPostUpdate           PASS
systemFieldPostUpdate        PASS
instanceDisplaySync          PASS
```

其中 `updateRejectRestoreThenPost` 专门验证 UPDATE 审批驳回：编辑后的主字段先恢复到审批前快照，自定义字段最终为 reject post 显式值，`ApprovalResourceSnapshot` 同时被消费为 0。

## 6. 相邻审批回归

- DB-010 regression：PASS，当前 isolated 数据库使用 **67 migrations**；通用 snapshot lifecycle、quotation/invoice/order 审批回归全部保持。
- DB-011 9.3A task/record migration smoke：PASS。
- DB-011 9.3B add-sign、9.3C return-back、9.3D approver revoke、9.3E attachment/comment HTTP：全部 PASS，当前业务 Smoke 使用 **67 migrations**。
- DB-012 9.4A Condition HTTP：PASS，**67 migrations**。
- DB-012 9.4B approver policy HTTP：PASS，**67 migrations**。
- DB-012 9.4C field permission HTTP：PASS，**67 migrations**。

9.4D 没有新增 PC/Mobile UI；流程设计器对 post config 的可视化编辑继续按 9.4F 边界不提前开放。9.4C 已有审批中心 Field Permission Browser **21/21**、9.3E Browser **28/28**、9.4A Condition Browser **14/14** 与 `/system/modules` **47/47** 仍作为最近相邻 UI 基线。

## 7. 全局封板证据

- Root Smoke：**227/227 PASS**。
- Rules：**137/137 PASS**。
- 隔离空库：**67/67 migrations + Seed 2/2**，Seed 计数稳定，空库最终验证 **14/14 PASS**。
- workspace typecheck：PASS。
- ESLint：PASS。
- Shared/API/Web production build：PASS；Web **4144 modules transformed**。
- Prisma validate：PASS。
- `git diff --check`：PASS。

验证期间确认 live API `tsc --watch` 与 isolated Smoke 都会重建 `apps/api/dist`，并发时可能产生瞬时 `TS6053` 或 `dist/main.js` 缺失。最终回归阶段仅临时暂停该 API 编译 watcher，保留原开发进程链，全部隔离 Smoke 稳定通过；验证结束后恢复 watcher。该现象属于验证环境对同一 build 目录的并发竞争，不是 9.4D runtime 失败。

## 8. 结论

W3.7-9.4D 已满足 schema、FlowVersion 契约、实例冻结、人工/自动通过、驳回恢复顺序、自定义/系统字段安全边界、相邻审批回归、Root、Rules、空库与静态构建封板要求，可以标记完成。

DB-012 继续 `IN_PROGRESS`。

下一执行单元：**W3.7-9.4E Webhook 安全 client、测试连接、运行时发送与审计**。
