# Approval Engine 当前需求

## 1. 定位

审批模块是当前系统保留的通用流程基础设施与待办中心。它负责流程版本、审批实例、任务、记录、条件、加签/退回/撤回、附件、字段权限与 Webhook 等通用语义。

当前审批引擎只保留中性的 `generic` 资源槽位。任何具体业务对象都必须通过独立资源适配器显式接入，审批基础设施本身不预置业务模块类型。

## 2. 流程与版本

- Flow 配置按 tenant 隔离，支持启停、软删除、编号、版本和节点图。
- 实例提交后冻结对应流程版本；后续编辑 Flow 不得改变在途实例语义。
- 节点至少支持 START / APPROVER / CONDITION / DEFAULT / END。
- 高级图必须由后端校验唯一默认分支、条件结构和无环约束，不能直接信任前端画布状态。

## 3. 审批人策略

- 支持指定成员、角色、组织层级/主管等当前代码已实现策略。
- 会签/或签、重复审批人规则、审批人与提交人冲突策略按冻结节点配置执行。
- 审批人解析必须保持 tenant、成员状态和组织边界；解析异常按节点策略 fail-closed 或执行明确兜底。

## 4. 动作状态机

- approve / reject / cancel / add-sign / return-back / approver-revoke 等动作必须在 Prisma transaction 中原子更新 task、record、instance 及必要附件/快照。
- PENDING task 的 owner、tenant、round、node 和状态必须参与动作校验，不能对历史已执行任务重复操作。
- 节点再次进入时 round 单调递增；ApprovalRecord 保留每轮审计事实。
- `requireComment`、动作附件和节点字段权限必须在服务端执行。

## 5. 条件与字段权限

- 条件运行时支持 AND/OR 和当前实现的比较操作符；未知字段/操作符 fail-closed。
- 字段权限与动作后置字段配置属于流程版本内容，顺序规范化后参与版本比较。
- 业务字段更新必须由已注册资源适配器提供；审批核心不能直接依赖具体业务表。

## 6. Resource Snapshot / Webhook

- 更新类资源审批可以使用统一 Resource Snapshot 保存变更前状态；拒绝/撤销时由资源适配器负责恢复。
- Webhook 配置进入流程版本比较；仅允许受支持 HTTP method、合法 URL/Header/JSON body。
- Webhook 必须继续执行 SSRF、hop-by-hop header、重试/错误审计等安全边界。

## 7. 当前产品入口

- `/approvals` 作为 PC 待办/审批中心入口保留，顶部“待办”可跳转到该页面。
- 流程管理 API 作为通用引擎基础设施保留；当前 Web 不暴露尚未接入业务资源的“流程设置”产品入口。
- Mobile 不恢复已删除的移动审批主模块；如果未来招生业务需要移动审批，必须按新的业务资源需求重新定义。

## 8. 验收

- Flow config、图校验、条件运行时、动作事务、快照、Webhook、附件和审计测试持续通过。
- 跨租户、非任务 owner、历史 task、非法回退/撤回、无效附件和不安全 Webhook 必须拒绝。
- 文档与 UI 只使用中性审批资源语义，不预置具体交易业务类型。
