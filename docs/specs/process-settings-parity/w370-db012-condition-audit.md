# W3.7-9.4A DB-012 Condition / DEFAULT 源码审计

审计日期：2026-09-01

## 1. 审计范围

本单元只关闭 DB-012 的第一段：Condition / DEFAULT 图结构、条件 DTO、分支顺序和 `updateFields` 条件运行时。动态审批人、fallback/sameSubmitter、字段权限、pass/reject 后置更新、Webhook 与完整 Vue Flow 条件设计器继续分别留在 9.4B～9.4F。

第一事实来源：

- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/constants/ApprovalNodeTypeEnum.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/domain/ApprovalNodeCondition.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/dto/request/ApprovalNodeConditionRequest.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/service/ApprovalFlowService.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/common/dto/condition/CombineSearch.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/common/dto/condition/FilterCondition.java`
- `CordysCRM/backend/crm/src/main/resources/migration/1.7.0/ddl/V1.7.0_2__ga_ddl.sql`
- `CordysCRM/frontend/packages/web/src/views/system/process/process/components/approval-flow/flow/transform.ts`

## 2. Cordys 图模型事实

Cordys 的节点类型是正式枚举：`START / APPROVER / CONDITION / DEFAULT / END / EXCEPTION`。其中 CONDITION 与 DEFAULT 都是真实节点，不是 link 上的临时标记。

条件节点扩展表：

```text
approval_node_condition
  id                // 与 approval_node.id 相同
  flow_version_id
  condition_config  // JSON
```

`ApprovalNodeConditionRequest` 继承公共 Node Request，只增加 `CombineSearch conditionConfig`。

`approval_node_link` 保持唯一连线真相源，并保存 `sort`；`getNextNodes()` 按 link.sort 升序取目标节点。因此同一父节点的多个 CONDITION 分支具有稳定优先级。

## 3. CONDITION / DEFAULT 选择语义

`ApprovalFlowService.getNextNode()` 的当前源码语义：

1. 若下一层没有 CONDITION，通常只有一个后继，直接进入第一个；
2. 若下一层存在 CONDITION，则按 link.sort 顺序逐个评估 CONDITION；
3. 第一条匹配的 CONDITION 立即命中；
4. DEFAULT 不参与条件求值，只作为 fallback 暂存；
5. 所有 CONDITION 都不匹配后才返回 DEFAULT；
6. CONDITION / DEFAULT 本身不是审批任务节点，`getNextNodeWithExceptionHandler()` 会继续递归向下，直到 APPROVER 或 END。

这意味着 MicroMatrix 不能把 DEFAULT 实现成“最后一条条件 `true`”，也不能把多个分支并行执行。

## 4. 条件 DTO

Cordys `CombineSearch`：

```text
searchMode: AND | OR
conditions: FilterCondition[]
```

`FilterCondition` 运行时关注：

- `name`：系统字段使用字段名，动态字段使用字段 ID；子表字段使用 `parentFieldId.childFieldId`；
- `value`；
- `multipleValue`；
- `operator`；
- `type`；
- `containChildIds`。

当前 `matchFieldValue()` 真正支持：

- `EQUALS / NOT_EQUALS`
- `CONTAINS / NOT_CONTAINS`
- `IN / NOT_IN`
- `GT / LT / GE / LE`
- `BETWEEN`
- `EMPTY / NOT_EMPTY`
- `NOT_EQUAL_ORIGINAL`

`DYNAMICS` 在 FilterCondition 层先转换为 BETWEEN / GT / LT 和动态日期值，再进入上述比较路径。

## 5. updateFields 语义

`NOT_EQUAL_ORIGINAL` 不读取旧值进行二次比较，而是直接检查实例 `updateFields`：

- 普通字段：判断 `updateFields` 是否包含当前字段 ID/字段名；
- 子表 `parent.child`：Cordys 取 child ID 判断；
- CREATE/DELETE 或无修改字段时恒为 false。

MicroMatrix DB-010 已在 UPDATE 提交时通过编辑前通用快照计算 `updateFields`，因此 9.4A 必须复用这一事实源，不能重新猜测“原值是否变化”。

## 6. 字段值语义

Cordys 条件运行时接收资源的 `BaseModuleFieldValue` 集合：

- 普通系统字段/动态字段按 fieldId 取值；
- 子表字段先取父字段列表，再在每行 Map 中读取 child field；任意一行满足即认为该条件满足；
- EMPTY 只判断 null，NOT_EMPTY 只判断非 null；
- 比较异常、未知 operator 均返回 false，不抛出导致流程越权跳转。

MicroMatrix 四个审批资源已有通用 capture：主表字段位于 quotation/contract/invoice/order 根对象，动态值位于 `fields/fieldBlobs`。9.4A 将由 ApprovalResourceService 把该 capture 规范化为条件值 Map，继续保持资源白名单边界。

## 7. MicroMatrix 现状与兼容边界

当前 Prisma `ApprovalNodeType` 已预留 CONDITION / DEFAULT，`ApprovalNodeLink` 也已有 sort，但：

- 没有 `ApprovalNodeCondition`；
- write DTO 仍只有 approver node；
- `createLinearGraph()` 只会 START → APPROVER... → END；
- submit 直接把所有 APPROVER 按 sort 冻结为 `nodesSnapshot`，没有条件求值；
- PC 当前仍是受控线性 ApprovalFlowCanvas。

9.3B/C/D 已把 `nodesSnapshot` 定义为稳定的“实际审批人路径”，退回和撤回依赖它的 nodeIndex/nodeId。9.4A 不把该字段破坏式改成图 JSON。

## 8. 9.4A 运行时映射

本单元采用：

1. FlowVersion 继续保存完整不可变图；
2. 提交实例时读取该不可变版本；
3. 获取当前业务字段值，并复用 DB-010 `updateFields`；
4. 从 START 开始按 link.sort 解析 CONDITION/DEFAULT，跳过分支节点，得到唯一 APPROVER 路径；
5. 把解析后的 APPROVER 路径继续冻结为现有 `nodesSnapshot`；
6. 后续 9.3B/C/D runtime 不需要改写历史语义。

在 9.4D 后置字段更新尚未开放前，审批节点不会修改业务字段，因此提交时解析出的路径在当前能力边界内与 Cordys 后续逐节点求值一致。9.4D 实施时必须重新审计是否需要把分支求值移动到每次 advance。

## 9. UI 边界

Cordys 前端将后端平铺的 CONDITION / DEFAULT 分支组装成一个条件组；保存时再展开为真实分支节点和 link。

完整 Vue Flow 条件编辑属于 9.4F。本单元只开放后端 DTO/API/runtime：

- 现有线性 payload 在 9.4A～9.4E 继续过渡兼容；
- 高级图 payload 必须显式提交 nodeType + links；
- 当前线性 PC 编辑器读取到高级图时禁止用线性 payload覆盖保存，避免把条件图压扁；
- 9.4F 再把 UI 从 fail-closed 升级为真实条件设计器，并迁移全部调用方到统一 `nodes + links` 写契约；DB-012 封板前删除旧线性 payload 的自动图推导分支。历史线性 FlowVersion 本身已保存为真实 node/link 图，不做数据迁移。

## 10. 结论

9.4A 需要 **Migration 64** 新增 `approval_node_conditions`，并扩展流程写 DTO/Detail、图校验、条件解析和提交实例路径冻结。完成本单元不代表 DB-012 关闭；下一执行单元仍是 **9.4B empty approver / fallback / sameSubmitter / 动态审批方向与 duplicate rule**。
