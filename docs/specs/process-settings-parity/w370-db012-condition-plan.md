# W3.7-9.4A DB-012 Condition / DEFAULT 实施计划

## 1. Schema / DTO

1. Migration 64 新增 `ApprovalNodeCondition`，ID 与 ApprovalNode ID 一致，并记录 flowVersionId + conditionConfig JSON。
2. Shared 增加 CombineSearch / FilterCondition / operator 类型。
3. `ApprovalFlowNodeInput` 扩展 nodeType / conditionConfig；新增可选 `createLinks`。
4. 9.4A～9.4E 过渡期暂时保持旧线性 payload：未显式提供高级 nodeType/link 时继续使用原 START→APPROVER→END 生成逻辑；这不是长期 API 契约。

## 2. Graph persistence

1. 高级图节点必须有唯一 clientId。
2. 精确校验一个 START、一个 END、引用完整、无自环、无环、全部节点从 START 可达并可到 END。
3. 普通节点只能单后继；出现 CONDITION 分支时同一父节点的所有后继只能是 CONDITION/DEFAULT，且至少一个 CONDITION、恰好一个 DEFAULT。
4. link.sort 决定 CONDITION 优先级。
5. CONDITION 保存独立 conditionConfig；DEFAULT 不保存伪条件。
6. 新版本继续 forward-only，不改历史 version。

## 3. Runtime

1. ApprovalResourceService 提供当前资源 condition field values。
2. submit 在 DB-010 `updateFields` 计算完成后解析不可变 FlowVersion 图。
3. CONDITION 支持 AND/OR、EQUALS/NOT_EQUALS、CONTAINS/NOT_CONTAINS、IN/NOT_IN、GT/LT/GE/LE、BETWEEN、EMPTY/NOT_EMPTY、NOT_EQUAL_ORIGINAL；未知/异常比较 fail-closed=false。
4. 子表 `parent.child` 按任一行满足处理。
5. 全部 CONDITION 不匹配才走 DEFAULT。
6. CONDITION/DEFAULT 不生成 ApprovalTask，只把最终 APPROVER 路径冻结进现有 nodesSnapshot。

## 4. UI 安全边界

1. 9.4F 前不实现完整条件画布。
2. 现有线性编辑器对高级图只读/禁止保存，防止丢分支。
3. API detail 必须完整回显 node conditionConfig 和 links，供 9.4F 直接消费。
4. 9.4F 条件图编辑器接管写入后，所有调用方统一改为显式 `nodes + links` 图契约；DB-012 封板前删除 `createLinearGraph()` 自动推导入口、`isExplicitGraph()` 双协议判断，并将 links 升级为正式写入契约。历史已保存的线性 FlowVersion 不迁移，因为数据库内本来就是标准 node/link 图。

## 5. 验收

专项 Rules：

- graph shape / cycle / DEFAULT；
- AND/OR；
- 比较操作符；
- NOT_EQUAL_ORIGINAL；
- link.sort 首命中；
- DEFAULT fallback；
- 子表字段；
- 旧线性 payload regression（仅作为 9.4F 前过渡回归）。

隔离 HTTP Smoke：

- 64/64 migrations + Seed；
- API 创建/读取条件图；
- UPDATE changed field 命中 NOT_EQUAL_ORIGINAL；
- 未修改字段走 DEFAULT；
- 数值条件按 sort 首命中；
- CONDITION/DEFAULT 不产生 task；
- nodesSnapshot 只冻结实际 APPROVER 路径；
- flow version 修改后历史 instance path 不变化；
- tenant/reference fail-closed。

最终回归：DB-010、DB-011 A～E、Root Smoke、Rules、空库 64/64 + 双 Seed、workspace typecheck/lint/build、Prisma validate、git diff --check。

完成后仅关闭 9.4A，DB-012 保持 `IN_PROGRESS`，执行指针进入 9.4B。
