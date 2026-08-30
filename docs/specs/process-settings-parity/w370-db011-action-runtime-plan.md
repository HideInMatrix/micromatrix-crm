# W3.7-9.3 DB-011 高级审批任务与动作实施计划

源码证据：[DB-011 高级审批任务与动作源码审计](./w370-db011-action-runtime-audit.md)

## 9.3A Task / Record 基座

1. 新增 forward migration，不修改 59 个既有 migration。
2. `ApprovalTask` 增加稳定节点标识、`nodeRound`、高级 `taskType` 与 `action`；现有 task 数据回填 round=1、普通审批保持 APPROVAL、CC 保持 CC。
3. 新增 `ApprovalRecord`，动作完成后追加不可变执行事实；先覆盖 approve/reject，保证旧 API 行为不变。
4. instance detail 返回 task round/type/action 与 records，但不提前暴露未实现动作按钮。
5. Rules + API Smoke 验证 owner/tenant/status/repeat protection。

关闭 9.3A 后才进入加签。

## 9.3B BEFORE / AFTER 加签

1. 新增 `ApprovalAddSignTask` relation。
2. 新增 add-sign DTO/API；只允许当前 PENDING task owner 操作。
3. flow `allowAddSign` 作为服务端硬 gate。
4. 实现 BEFORE / AFTER 与 `rootTaskId + sort` 嵌套链；加签任务类型为 SIGN/SN 语义。
5. 加签专项覆盖普通任务、BEFORE、AFTER、二级嵌套、跨租户、非 owner、重复提交。
6. 只有专项全绿后才允许流程设置保存 `allowAddSign=true`，并开放 UI 操作入口。

## 9.3C 节点退回

1. 新增 `ApprovalReturnBackRecord`。
2. 以 nodeRound 追加目标节点新一轮任务，不覆盖旧轮次。
3. 只允许退回到当前实例已经执行过且属于同一冻结流程版本的历史审批节点。
4. 清理区间内活动待办，但保留 task/record 历史。
5. instance current node/index 回到目标节点。
6. 专项覆盖非法目标、当前节点、已结束实例、跨租户、重复 back 和 round 递增。

## 9.3D 审批人任务撤回

1. 新建与 submitter cancel 完全分离的 task revoke API。
2. flow `allowWithdraw` 硬 gate；必须由原 task approver 执行。
3. 只允许撤回最近仍可逆的已通过 task；下游已形成不可逆执行时 fail-closed。
4. 撤回后恢复该 task 为待办、清理需要重建的下游活动任务，实例 current node 回到目标节点。
5. 写独立撤回记录/动作事实，不调用 submitter cancel 的实例 CANCELED 语义。
6. 当前 MicroMatrix 未实现的 DB-012 SEQUENTIAL/条件分支场景保持不可执行，不臆造等价规则。

## 9.3E requireComment / Attachment / UI 与关闭验收

1. approve/reject/sign/back 按 flow `requireComment` 校验非空意见；batch 行为按 Cordys 当前源码再次核对后接入。
2. 新增 `ApprovalInstanceAttachment`，element 指向具体 action record / add-sign / return-back 元素。
3. 接入现有 Attachment 资源的 tenant 归属校验，不复制附件实体。
4. 审批详情展示 records、动作、轮次和附件；按钮按 runtime capability + task 状态显示。
5. 流程设置只开放已经验收完成的 `allowAddSign / allowWithdraw / requireComment / allowBatchProcess`，不能因同属 DB-011 一次性全开。
6. DB-011 专项 Rules/API/Browser、四业务审批回归、Root Smoke、空库全 migration + 双 Seed、workspace typecheck/lint/build 全绿后更新 backlog 为 `VERIFIED`。

## Forward-only 原则

- migration 60 起只追加，不回改 migration 58/59；
- 历史 ApprovalTask 必须可升级，不能因新 NOT NULL 字段导致已有实例失效；
- task 是工作项，ApprovalRecord 是动作事实，两者不做长期双真相源；
- DB-012 完成前，条件节点、SEQUENTIAL、动态审批人、字段权限和 Webhook 继续保持关闭。
