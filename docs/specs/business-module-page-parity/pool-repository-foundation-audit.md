# W3.4.0 分域池、容量与负责人历史 Repository 实施记录

> 任务：1.6
>
> 日期：2026-08-25
>
> 状态：公共 Repository 与规则底座完成；业务 Controller/Service 切换属于任务 1.7

## 1. Cordys 源码证据

本单元先读取 Cordys 源码，再实现 NestJS/Prisma，不以截图或现有通用池代码作为需求真相。

| 能力         | 线索源码                                                             | 客户源码                                                                                                  | 已确认事实                                                                                        |
| ------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 池配置       | `clue/service/CluePoolService.java`                                  | `customer/service/CustomerPoolService.java`                                                               | Pool、PickRule、RecycleRule、HiddenField 分域保存；Scope/Owner/Condition 是 JSON 文本             |
| 库容配置     | `clue/service/ClueCapacityService.java`、`ExtClueCapacityMapper.xml` | `customer/service/CustomerCapacityService.java`、`ExtCustomerCapacityMapper.xml`                          | 同组织 Scope 不得命中重复成员；用户命中最新创建的规则                                             |
| 领取/分配    | `clue/service/PoolClueService.java`                                  | `customer/service/PoolCustomerService.java`                                                               | 池管理员仍受库容；领取执行每日上限、新数据保护、前负责人冷却；分配只执行库容                      |
| 负责人历史   | `clue/service/ClueOwnerHistoryService.java`                          | `customer/service/CustomerOwnerHistoryService.java`                                                       | Owner 表记录已经结束的负责人周期，保存原 owner、collectionTime、endTime、operator 和可选 reasonId |
| 手工退池     | `clue/service/ClueService.java#batchToPool`                          | `customer/service/CustomerService.java#batchToPool`                                                       | 先写 Owner 历史，再清空 owner/collectionTime 并进入目标池                                         |
| 自动回收     | `CluePoolRecycleListener.java`                                       | `CustomerPoolRecycleListener.java`                                                                        | 自动回收 reasonId 为 `system`；`system` 不进入 Owner 历史原因                                     |
| 客户排除库容 | 无                                                                   | `PoolCustomerService#validateCapacity`、`ExtCustomerMapper.xml#filterOwnerCount`、`capacitySetDrawer.vue` | 当前 Cordys 只支持按商机阶段 `IN/NOT_IN` 排除客户，不是任意客户动态字段筛选                       |

源码还存在一个必须保留的分域差异：`PoolClueService` 对池管理员仍执行前负责人冷却，`PoolCustomerService` 则让公海管理员跳过该限制。共享计算器通过显式策略参数表达该差异，没有把两类资源强制合并成同一行为。

## 2. 实现结构

- `CluePoolRepository` 只访问 `Clue/CluePool/CluePoolPickRule/CluePoolRecycleRule/ClueCapacity/ClueOwner/CluePoolHiddenField`。
- `CustomerPoolRepository` 只访问 `Customer/CustomerPool/CustomerPoolPickRule/CustomerPoolRecycleRule/CustomerCapacity/CustomerOwner/CustomerPoolHiddenField`。
- 两个 Repository 分别提供池配置增改、启停、删除，库容增改删，池/库容/Owner 历史查询，以及领取、分配、转移、手工退池和自动回收事务。
- `PoolRuleCalculator` 是无状态计算器，只接收规则与计数快照，不访问数据库或根据 module 选择表。
- `ResourceRecycleConditionEvaluator` 继续作为两域共享的无状态时间回收条件计算器；后续自动任务调用方在 1.7 切换到直接模型。
- `poolTransactionLockKeys/acquirePoolTransactionLocks` 使用 PostgreSQL transaction advisory lock，同时锁定资源和目标负责人，并按稳定顺序获取，防止并发重复领取和库容超卖。
- 库容 Scope 新增/修改使用组织级事务锁，并展开 user/department token 检查成员重叠。

## 3. 负责人历史语义

Cordys 的 `clue_owner/customer_owner` 是“已经结束的负责人周期”，不是操作日志：

1. 领取/分配从池中建立当前负责人事实，写主记录的 `owner + collectionTime`；此时周期尚未结束，不创建伪造的零时长历史。
2. 转移负责人时，先把旧 owner 周期写入对应 Owner 表，再建立新 owner 周期。
3. 手工退池和自动回收时，先结束当前周期并写 Owner 表，再清空 owner/collectionTime。
4. 自动回收的当前资源 `reasonId=system`，Owner 历史 `reasonId=null`；手工退池原因同时进入当前资源和历史。

这样满足所有负责人变更操作都维护分域历史生命周期，同时不偏离 Cordys 表意。

## 4. 规则与并发验证

- 专项规则/事务测试：18 条通过，覆盖每日领取上限、冷却边界、新数据保护、库容、客户排除数量、池管理员规则差异、分配仍受库容、稳定锁顺序、手工退池和自动回收历史。
- 全量公共规则测试：`95/95` 通过。
- 新增文件 TypeScript 定向审计无错误，改动文件 ESLint 通过。
- 隔离 PostgreSQL 从空库应用全部 30 个 migration 成功。
- 真实库 Smoke 9 项通过：
  - 直接 Repository 创建 Clue/Customer Pool、Rule、HiddenField 与 Capacity；
  - 等价 user Scope 重复容量配置被拒绝；
  - 两个并发领取请求只有一个成功；
  - 手工退池写 `clue_owner`；
  - 商机阶段命中的客户不计入客户库容；
  - 自动回收写 `customer_owner`，当前资源保留 `system` 原因。
- 临时数据库在验证后删除，未修改主开发数据库。

## 5. 当前边界与下一任务

任务 1.6 完成的是直接模型 Repository 和规则事务底座。以下内容明确属于 1.7，不能提前宣称 API 已恢复：

- 旧 `ResourcePoolsService/PoolRulesService/PoolRecycleService` 及其 Controller 仍引用已删除的通用模型；
- Leads、Customers、FollowUpPlans、CustomerAccess 等调用方仍需切换到两个分域 Repository；
- 主业务写操作还需接入联系人负责人、通知、操作日志、字段值事务等外围副作用；
- Seed 在 1.8 重写前，API 全量 typecheck、build 和启动仍会失败。

因此在该历史节点可标记任务 1.6 完成，但尚不能标记 W3.4.0 完成或声称版本已可启动。后续任务 1.7～1.9 已完成，W3.4.0 最终结果见 [foundation-validation-audit.md](./foundation-validation-audit.md)。
