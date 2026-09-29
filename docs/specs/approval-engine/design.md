# Approval Engine 当前设计

## 1. 核心模型

```text
ApprovalFlow
  └── ApprovalFlowVersion
        └── frozen graph / nodes
              ↓ submit
ApprovalInstance
  ├── ApprovalTask
  ├── ApprovalRecord
  ├── ResourceSnapshot
  └── WebhookDelivery
```

Flow 是配置入口；Version 冻结执行定义；Instance 是一次业务审批；Task 是当前审批人工作项；Record 是不可替代的动作审计事实。

## 2. NestJS 边界

- `ApprovalFlowConfigService` 负责 Flow/Version/Node 配置、规范化和版本比较。
- `ApprovalsService` 负责实例、任务与动作状态机。
- Resource Snapshot 与 Webhook 使用独立服务，避免把资源恢复和外部投递塞进主状态机。
- 数据访问统一使用 Prisma ORM 8 `PrismaService.client`，动作链在 transaction 中执行。

## 3. 图执行

流程图提交前转换成项目自己的节点/边契约；前端画布库只负责交互，不是数据库真相源。

条件节点根据冻结的字段条件决定分支；DEFAULT 必须唯一。执行器防止循环，并在自动节点/空审批人策略下按照配置推进到下一个可执行节点。

## 4. Task / Record

Task 表示当前可操作工作项；approve/reject/sign/back/revoke 等动作都先校验 task 的 tenant、owner、状态、node 和 round，再写 ApprovalRecord。

重新进入同一节点时创建新 round，不覆盖上一轮记录。撤销或退回产生的旧 task 通过明确状态失效，不能再次出现在待办查询中。

## 5. Resource adapter

Approval Engine 不直接假设 Customer/Lead 或其它业务表结构。需要把某类业务资源接入审批时，适配器负责：

- 提交前资源读取与权限。
- UPDATE 前快照。
- approve 后业务副作用。
- reject/cancel/revoke 时必要的资源恢复。
- 面向审批 UI 的 target info。

当前招生 CRM 没有注册已删除报价、合同、发票、订单资源的产品适配器。历史 `ApprovalFormType` 值仍存在于兼容层时，不应作为恢复这些模块的依据。

## 6. Webhook 安全

Webhook 的请求方法、URL、Header 与 body 在保存时校验；发送时继续执行公网地址分类、DNS/IP 安全边界和错误分类。投递状态单独持久化，失败不能篡改审批主事务已经确定的业务状态。

## 7. UI

`/approvals` 用于待办、已办、我发起等当前审批中心读写体验。流程图配置属于基础设施能力，只有未来有当前业务资源需要配置审批时才重新提供对应产品入口。

## 8. 维护原则

- 引擎测试证明的是通用状态机能力，不代表任何已删除交易模块仍是当前产品。
- 新增业务适配器必须有独立需求、权限、DataScope、资源快照和端到端测试。
- 不新增并行审批引擎；继续扩展当前 Flow/Version/Instance/Task/Record 模型。
