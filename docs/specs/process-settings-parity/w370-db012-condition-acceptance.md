# W3.7-9.4A DB-012 Condition / DEFAULT 专项验收

验收日期：2026-09-01

## 1. 关闭范围

本次只关闭 DB-012 的 9.4A：

- `ApprovalNodeCondition` 独立模型；
- CONDITION / DEFAULT 真实图结构与 link.sort；
- CombineSearch / FilterCondition DTO；
- 基于当前资源字段和 DB-010 `updateFields` 的条件求值；
- 提交实例时解析唯一实际 APPROVER 路径并冻结 `nodesSnapshot`；
- 9.4F 前现有线性 PC 编辑器对高级图 fail-closed，禁止覆盖保存。

9.4B～9.4F 的动态审批人、fallback/sameSubmitter、duplicate rule、字段权限、后置字段更新、Webhook 与完整 Vue Flow 条件设计器不在本单元关闭范围内。DB-012 因此保持 `IN_PROGRESS`。

## 2. 数据库与图契约

- Migration 64 新增 `approval_node_conditions`。
- `ApprovalNodeCondition.id` 与 `ApprovalNode.id` 一一对应，同时保存 `flowVersionId + conditionConfig JSON`。
- CONDITION 与 DEFAULT 都是正式 ApprovalNode；DEFAULT 不伪造永真条件。
- 高级图写入使用稳定 `clientId + createLinks`，服务端校验 START/END 唯一、引用完整、无自环/循环、全图可达、条件分支至少一个 CONDITION 且恰好一个 DEFAULT、同层 `link.sort` 唯一。
- API detail 完整回显真实 node type、conditionConfig 和 links。

旧 `createNodes-only` 线性 payload 本阶段仍作为过渡兼容；9.4F 条件图编辑器接管全部写入后必须迁移调用方到统一 `nodes + links` 契约，并在 DB-012 封板前删除 `createLinearGraph()` / `isExplicitGraph()` 双协议入口。历史 FlowVersion 不迁移，因为历史线性配置本身已经保存为标准 node/link 图。

## 3. Runtime 语义

- 提交时从不可变 FlowVersion 的 START 开始解析图。
- 同一条件层严格按 `link.sort` 评估，第一条 CONDITION 命中即停止；全部不命中才走 DEFAULT。
- CONDITION / DEFAULT 不创建 ApprovalTask。
- 实际经过的 APPROVER 节点继续冻结到原有 `nodesSnapshot`，因此 DB-011 的退回、nodeRound、撤回语义不需要破坏式改造。
- `NOT_EQUAL_ORIGINAL` 直接消费 DB-010 已保存的 `updateFields`，不重新猜测旧值。
- 子表 `parent.child` 按任意一行满足处理。
- 未实现 operator / 比较异常 fail-closed=false。
- EQUALS / IN 按 Cordys `Objects.equals` 语义保持类型严格；GT/LT/GE/LE 等比较操作才进行可比较数字转换。

当前 9.4D 尚未开放审批节点后的字段更新，因此“提交时一次解析并冻结路径”在当前能力边界内成立；9.4D 实施时必须重新审计是否需要把条件求值移动到每次 advance。

## 4. 专项 HTTP Smoke

`pnpm --filter @micromatrix/api smoke:w370-db012-condition` 在隔离 PostgreSQL 中从零执行 **64/64 migrations + Seed + Shared/API build**，结果 PASS：

```text
graphRoundTrip              PASS
legacyPayloadTransition     PASS
graphValidationGate         PASS
referenceGate               PASS
linkSortFirstMatch          PASS
secondConditionMatch        PASS
defaultFallback             PASS
conditionNodesNoTasks       PASS
frozenHistoricalPath        PASS
notEqualOriginal            PASS
unchangedFieldDefault       PASS
finalApproved               PASS
```

其中真实覆盖：

- 创建并读取 CONDITION/DEFAULT 图；
- 无 DEFAULT / 非法成员引用 fail-closed；
- 多 CONDITION 按 sort 第一命中；
- 未命中进入 DEFAULT；
- CONDITION/DEFAULT 不产生 task；
- 流程版本更新后，已创建实例仍使用原冻结路径；
- UPDATE 修改字段命中 `NOT_EQUAL_ORIGINAL`；
- UPDATE 未修改该字段时进入 DEFAULT。

## 5. Browser Smoke

新增 `pnpm smoke:w370-db012-condition-browser`，使用临时停用 quotation 条件流程验收，完成后删除夹具；默认库复核 quotation flow 数量恢复为 0。

最终结果：**14/14 PASS**。

```text
API 已创建真实 CONDITION / DEFAULT 图
流程设置列表可读取高级图流程
高级图流程可进入编辑抽屉
高级图详情加载完成
编辑抽屉可切换到流程设计
页面明确显示高级图只读警告
线性画布不提供添加审批节点
点击保存被前端明确阻止
高级图编辑未发出 PUT 覆盖请求
高级图版本未被线性编辑器改写
高级图 links 保持不变
Browser API 5xx = 0
Browser Runtime exception = 0
```

Browser 验收还发现并修复了一个既有抽屉初始化缺陷：`ApprovalFlowDrawer` 由 `v-if` 在 visible=true 时挂载，但内部 watch 原先没有 `immediate`，导致首次挂载不会执行 `initialize()`。现已改为 immediate watch，并用真实 detail API 验证编辑抽屉初始化完成。

## 6. 回归与封板门槛

- API Rules：**130/130 PASS**。
- DB-010 regression：PASS（实际 deploy 64 migrations）。
- DB-011 9.3A migration smoke：PASS。
- DB-011 9.3B / 9.3C / 9.3D / 9.3E HTTP：PASS（64 migrations；B/C 初次并发执行时发生共享 `dist` build 竞争，改为串行后均 PASS，确认非业务回归）。
- Root Smoke：**227/227 PASS**。
- `/system/modules` Browser：第二个全新 Chrome profile **47/47 PASS**，API 5xx=0、Runtime exception=0；第一轮单项 `contractPaymentPlan` 网络监听假阴性同时由 API 直测 200 排除业务失败。
- 空库：**64/64 migrations + Seed 2/2 + 计数幂等 PASS**。
- workspace typecheck：PASS。
- ESLint：PASS。
- Shared/API/Web production build：PASS；Web **4144 modules transformed**。
- Prisma validate：PASS。

## 7. 结论

W3.7-9.4A 已满足 schema、DTO、API、runtime、Browser、相邻回归、空库和静态封板要求，可以标记完成。

DB-012 继续保持 `IN_PROGRESS`。

下一执行单元：**W3.7-9.4B empty approver / fallback / sameSubmitter / 动态审批方向与 duplicate rule**。
