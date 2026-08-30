# W3.7-9.3B DB-011 BEFORE / AFTER 加签源码审计

审计日期：2026-08-30

## 1. Cordys 第一事实来源

- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/service/ApprovalActionService.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/domain/ApprovalAddSignTask.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/dto/request/ApprovalAddSignRequest.java`

## 2. 服务端硬门禁

Cordys `sign()` 先按实例所属流程读取 `allowAddSign`。流程不存在或 `allowAddSign=false` 时直接拒绝，不能只依赖前端隐藏按钮。

MicroMatrix 9.3B 因此只允许在加签 runtime 完成后解除 `allowAddSign` 的配置 422；`allowWithdraw / requireComment / allowBatchProcess / SEQUENTIAL_ALL / EACH` 继续保持原门禁。

## 3. BEFORE / AFTER 状态语义

`saveActionTask(... SIGN ...)`：

- BEFORE：被加签任务保持 PENDING，`action=SIGN`，本次 BEFORE 动作不生成 ApprovalRecord；
- AFTER：被加签任务视为 APPROVED，`action=APPROVE`，并生成 ApprovalRecord；
- 新加签待办 `type=SN`，审批人来自 `signApprover`，nodeId / nodeRound 与源任务一致。

因此 MicroMatrix 不能把 BEFORE 简化为“多创建一个并行 PENDING task”。原任务虽然保持 PENDING，但必须处于挂起状态，直到前置加签链执行完才重新可执行。

## 4. 加签关系模型

Cordys `approval_add_sign_task` 保存：

- `task_id`：新增的加签任务；
- `sign_task_id`：本次被加签的源任务；
- `type`：BEFORE / AFTER；
- `root_task_id`：整条嵌套加签链的根普通任务；
- `sort`：链内执行顺序；
- `comment`。

普通任务首次加签时 `rootTaskId=sourceTaskId`。加签任务再次被加签时继承父加签记录的 rootTaskId。

## 5. 嵌套排序

Cordys 默认 sort 步长为 100：

- 普通任务首次加签：sort=100；
- 在加签任务上 BEFORE：`parentSort - 100`；
- 在加签任务上 AFTER：若存在下一个节点，取 `(parentSort + nextSort) / 2`；不存在则 `parentSort + 100`。

MicroMatrix 使用同样的 root + sort 语义。因为本实现不复制历史根 task，普通任务后续再次开启新加签链时应从该 root 已存在的最大 sort 后继续分配，避免与历史记录发生 sort 冲突。

## 6. 链路续跑

Cordys 加签任务完成后按同一 root、sort 升序寻找下一个加签任务；没有下一个时：

- 根任务仍 PENDING：恢复根任务继续审批，属于 BEFORE 链；
- 根任务已经 APPROVED：该节点的原审批事实已经成立，继续节点完成 / 后续节点推进，属于 AFTER 链。

MicroMatrix 不复制 task 历史实体，而是保留原 task + ApprovalRecord，并通过执行 gate 保证：

- `action=SIGN + status=PENDING` 的源任务不可直接 approve/reject/sign；
- SIGN task 只有在同 root 下不存在更早的 PENDING SIGN task 时才可处理；
- 前置链结束后清空挂起源任务的 SIGN action；
- 后置链结束后再执行现有 ANY / ALL 节点完成逻辑。

## 7. 9.3B 实施边界

- 新增 forward-only migration 61 与 `ApprovalAddSignTask`；
- 新增 `POST /approvals/tasks/:id/sign`；
- task source 仅允许 APPROVAL / SIGN，且必须 tenant + owner + instance PENDING + task PENDING + 当前链可执行；
- signApprover 必须是同 tenant 的有效成员；
- SIGN 纳入我的待办、已办和审批详情；CC 不变，BACK 仍不提前开放；
- reject SIGN 继续沿用当前 reject 语义，直接驳回整个实例；
- 9.3B 不实现附件、退回、审批人撤回和 requireComment。

## 8. 验收要求

专项至少覆盖：

- allowAddSign=false 服务端拒绝；
- 非 task owner / 跨 tenant / 已处理 task / 非当前可执行链拒绝；
- 普通 BEFORE、普通 AFTER；
- SIGN 上二级 BEFORE；
- SIGN 上二级 AFTER；
- 链路顺序与根任务恢复；
- AFTER 链结束后 ANY / ALL 不提前或重复推进；
- SIGN approve / reject 产生正确 record/action；
- 既有四业务审批、Rules、Root Smoke、60+ migrations 空库 replay 不回归。
