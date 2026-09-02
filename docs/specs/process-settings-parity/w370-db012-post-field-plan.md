# W3.7-9.4D DB-012 pass/reject 后置字段更新实施计划

计划日期：2026-09-02

## 1. 数据与契约

1. Migration 67 为 `ApprovalNodeApprover` 增加 `passPostConfig` / `rejectPostConfig` JSONB。
2. Shared 增加 `ApprovalFieldUpdateConfig`、`ApprovalPostConfig`，并挂入 Flow node input/detail 与实例 `ApprovalNodeConfig`。
3. DTO 接收同样字段；9.4D 只接受 `fieldUpdateConfigs`，Webhook 延后到 9.4E。

## 2. 配置校验

1. 复用当前 form metadata。
2. fieldId 必须存在且同一动作内唯一。
3. enabled 项必须有非 null 值。
4. enabled 项必须属于 9.4C 安全可编辑字段集合。
5. normalize 时保持 disabled 配置，但清理 fieldId，并稳定排序，确保版本比较稳定。

## 3. Runtime

1. 提取 `applyNodePostFieldUpdates(instance, nodeIndex, action, operatorId)`。
2. 只读取 `instance.nodesSnapshot[nodeIndex]`。
3. APPROVE：仅在 APPROVER 节点真正完成时执行一次，然后推进下一节点。
4. 自动 APPROVE：自动通过节点写完 task/record/currentNodeIndex 后执行 pass config，再继续循环。
5. REJECT：完成状态落库和 DB-010 restore 后执行 reject config，保证后置动作是最终业务状态。
6. SIGN 不直接执行；根节点完成时沿正常 APPROVER 完成路径执行。
7. 更新后刷新实例 targetName/summary。

## 4. 测试

1. Rules：配置 normalize/validation/版本 round-trip。
2. isolated HTTP：66→67 migrations + Seed，验证 pass/reject、自定义字段、系统字段、disabled/null/reference gate、ANY/ALL 单次执行、自动通过、冻结版本、UPDATE reject restore 后最终 post value。
3. 回归：9.4A/9.4B/9.4C、DB-010、DB-011 A～E。
4. Root、空库双 Seed、typecheck/lint/build、Prisma validate、`git diff --check`。

## 5. 文档关闭条件

全部证据真实通过后：

- 勾选 `tasks.md` 9.4D；
- 新增 acceptance；
- 更新 project-progress / alignment-log / deferred backlog / parity；
- 下一执行指针切换到 9.4E Webhook。
