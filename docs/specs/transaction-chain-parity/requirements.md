# W3.6 交易链深度对齐需求

## 1. 目标

W3.6 在 W3.4 用户功能图与 W3.5 个人中心完成后，继续按 CordysCRM 源码逐模块收口销售交易链：商机、产品/价格表、报价、合同、回款、发票、订单。

本阶段不以“当前页面可运行”为完成标准，而以 Cordys 的页面、前端 API、Controller、Service、Domain/DTO/Mapper 与最终 DDL 为事实来源，破坏式替换 MicroMatrix 自定义契约，不保留旧 API、旧数据库模型或双写兼容层。

## 2. 全程强制约束

### R1 源码证据优先

- 每个大模块实施前必须形成“页面 → 前端 API → Controller → Service → Domain/DTO/Mapper → DDL”证据矩阵。
- 截图和当前 MicroMatrix 行为只用于验收与差异定位，不作为需求来源。

### R2 直接模型

- 商机、报价、产品、合同、回款、发票、订单的动态字段不得长期继续使用 `customData JSONB` 冒充 Cordys Field/Blob 直接表。
- 新增直接表时必须同步处理唯一约束、普通值/Blob、引用子表、事务、导入导出、批改、筛选和 Seed。
- 已执行的历史 migration 不再修改；所有修复使用 forward-only migration。

### R3 Cordys API 契约

- 目标 API 路径、HTTP 方法、DTO 形状和批量语义以 Cordys 源码为准。
- 完成目标模块后删除对应 MicroMatrix 自定义 REST 路径，不恢复兼容 Controller。

### R4 权限与数据范围

- 每个列表、详情、子资源、导入导出、批量操作和阶段/状态动作均执行目标模块权限和 DataScope。
- ID 直查、批量 ID、关联对象和第二租户必须 fail-closed。

### R5 系统模块设置闭环

- **每完成一个大模块，必须立即复核 `/system/modules` 对应 Cordys 模块卡片。**
- 当前大模块在 Cordys `configCard.vue` 中出现的表单、阶段/状态流、规则、原因、价格表、发票等设置入口必须在同一执行单元内补齐并通过 Browser Smoke；不能留到整轮结束再补。
- 若某设置依赖明确属于后续大模块，可保留入口并在任务清单写明依赖，但完成后续模块时必须回到该卡片关闭缺口。

### R6 操作日志、通知与自动任务

- Cordys 有系统模块操作日志或业务操作日志的配置与动作必须保留等价审计。
- 商机关闭、到期提醒等自动能力只有存在 Cordys Listener/Job 证据时才实现，且必须租户隔离、幂等。

### R7 页面与验证

- PC 页面按 Cordys 结构、操作和详情子资源重建；Mobile 已存在相同模块时同步迁移 API。
- 每个大模块必须有专项 API/数据库 Smoke、Browser Smoke，并复跑根 Smoke、rules、typecheck、ESLint、production build、Prisma 和 `git diff --check`。
- 数据模型有变更时必须增加隔离空库 migration + 双次 Seed 验收。

## 3. 商机模块目标

### R8 商机直接模型

- 对齐 Cordys `opportunity`、`opportunity_field`、`opportunity_field_blob`、`opportunity_stage_config`、`opportunity_rule`。
- 商机覆盖客户、联系人、金额、可能性、意向产品、当前/上一阶段、负责人、创建/更新人、计划/实际结束时间、失败原因、最新跟进人与时间。
- `customer_id`、`contact_id` 按 Cordys 最终 migration 的 nullable 语义执行。

### R9 商机 API

- 主契约切换到 `/opportunity/*`：表单、分页、统计、新增、更新、删除、批量转移/删除/更新、详情、更新阶段、Tab、联系人、导入导出、模板、看板排序和图表。
- 商机 User View、跟进记录/计划继续使用 Cordys 对应分域路径和现有公共底座。

### R10 商机阶段

- 对齐 `/opportunity/stage/get|add|delete|update-rollback|update|sort`。
- 阶段支持 `AFOOT/END`、赢率、排序、进行中回退和完结回退；最多 15 个阶段，进行中阶段至少保留一个。

### R11 商机关闭规则

- 对齐 `/opportunity-rule/page|add|update|switch|delete` 与 `opportunity_rule`。
- 规则包含管理员、Scope、启停、自动关闭、AND/OR 条件及审计；多规则命中按 Cordys 创建时间优先。
- 自动关闭把命中商机迁入组织失败终态，并写 `lastStage` 与 `failureReason=system`。

### R12 商机失败原因

- 复用已落地的 `sys_dict/sys_dict_config`，模块为 `OPPORTUNITY_FAIL_RS`。
- 用户手工进入失败终态时按全局开关执行原因校验；系统自动关闭使用保留值 `system`。

### R13 `/system/modules` 商机卡片

同一商机执行单元必须关闭以下五个入口：商机表单设置、报价表单设置、商机阶段设置、商机关闭规则、商机失败原因设置及开关。

## 4. 后续交易链

- 产品/价格表：直接字段、产品状态、价格表表单与引用语义。
- 报价：`opportunity_quotation`、Field/Blob、审批/快照、作废、导出/PDF、User View 与报价表单。
- 合同：合同直接字段、审批/快照、阶段、作废/归档、工商抬头与模块设置。
- 回款：计划、记录、负责人/部门、到期提醒及表单设置。
- 发票：申请/记录、审批、作废、抬头关联与发票表单设置。
- 订单：直接字段、状态流、合同/报价/产品关系和订单模块设置。
