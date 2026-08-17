# CordysCRM 功能对齐总表

> 本文档用于追踪 MicroMatrix CRM 与 `CordysCRM/` 的功能一致性。CordysCRM 仅作为功能、业务规则、接口行为和数据关系的参考基准；MicroMatrix CRM 继续采用 NestJS + Prisma + PostgreSQL + Redis 的独立实现。

## 对齐原则

1. **功能优先**：先确认 CordysCRM 的真实业务能力，再决定 MicroMatrix CRM 的实现范围。
2. **语义迁移**：迁移业务规则、状态机、数据关系、权限语义与接口行为，不做 Java → TypeScript 的机械逐行翻译。
3. **技术栈保持独立**：Spring/MyBatis/Shiro/Spring Cache 等分别映射到 NestJS/Prisma/Guard/Redis 等当前技术方案。
4. **商业能力单独判断**：DataEase、AI、MCP、第三方商业数据等不因 CordysCRM 存在就自动纳入。
5. **不实现 Cordys 授权体系**：MicroMatrix CRM 不设计 Cordys 的 License/CE/EE 机制。
6. **许可证边界**：若直接复用、翻译或形成 CordysCRM 源码的衍生实现，需要继续遵守其许可证及附加条款；若未来需要独立闭源商业发行，应以功能规格/行为为依据重新实现，避免直接复制源码表达。

## 状态定义

- `✅`：功能及核心业务规则已实现并完成验收
- `🟡`：已有实现，但与 CordysCRM 仍存在能力差距
- `🚧`：正在迁移
- `❌`：尚未实现
- `⛔`：明确不纳入 MicroMatrix CRM

## 核心业务模块

| CordysCRM 模块 | 关键参考实现 | MicroMatrix CRM | 状态 | 后续动作 |
| --- | --- | --- | --- | --- |
| 线索 | `clue/*`、`ClueService`、`PoolClueService` | `modules/leads` | 🚧 | 多池/领取限制/库容/回收/SavedView/负责人历史/批量操作/xlsx 导入导出已验收；继续 R4 转化关系 |
| 客户 | `customer/*`、`CustomerService` | `customers` | 🚧 | 多公海/库容/协作/关系/合并/SavedView/批量操作/xlsx 导入导出已验收；继续 R3 联系人与 R5 360 |
| 联系人 | `CustomerContactService` | `modules/contacts` | 🚧 | 已补 ownerId/deptId 与客户协作资源权限；继续导入导出、操作日志、SavedView |
| 商机 | `opportunity/*`、`OpportunityService` | `modules/opportunities` | 🟡 | 补齐关闭规则、阶段高级配置、负责人/跟进联动 |
| 报价 | `OpportunityQuotation*` | `modules/quotes` | 🟡 | 对齐审批、快照、联系人、用户视图、操作日志 |
| 产品 | `product/*`、`ProductService` | `modules/products` | 🟡 | 补齐产品价格/价格表、日志、导出 |
| 合同 | `contract/*`、`ContractService` | `modules/contracts` | 🟡 | 补齐可配置阶段、快照、用户视图、完整审批语义 |
| 回款计划 | `ContractPaymentPlanService` | `modules/contracts` | 🟡 | 对齐字段、视图、导出、权限与审批联动 |
| 回款记录 | `ContractPaymentRecordService` | `modules/contracts` | 🟡 | 对齐字段、视图、导出、权限与审批联动 |
| 发票 | `ContractInvoiceService` | `modules/contracts` | 🟡 | 补齐开票明细、视图、导出、快照/审批 |
| 工商抬头 | `BusinessTitleService` | `modules/contracts` | 🟡 | 对齐配置、导出和业务规则 |
| 订单 | `order/*`、`OrderService` | `modules/orders` | 🟡 | 补齐可配置阶段、快照、产品明细、收货信息 |

## 协同与流程

| CordysCRM 模块 | 关键参考实现 | MicroMatrix CRM | 状态 | 后续动作 |
| --- | --- | --- | --- | --- |
| 跟进记录 | `FollowUpRecordService` | `modules/follow-ups` | 🟡 | 对齐评论、@成员、附件、字段、日志、视图 |
| 跟进计划 | `FollowUpPlanService` | - | ❌ | 完整迁移计划、提醒、评论、转记录、我的计划 |
| 审批流 | `approval/*` | `modules/approvals` | 🟡 | 重点重构：节点、条件、会签/或签、加签、退回、抄送、任务、快照、Webhook |
| 站内通知 | `NotificationService`、`notice/*` | `modules/notifications` | 🟡 | 对齐消息任务、模板、事件开关、SSE |
| 定时任务 | `schedule/*`、`job/*` | Nest Schedule | 🟡 | 统一任务注册、回收、提醒、清理策略 |

## 平台能力

| CordysCRM 模块 | 关键参考实现 | MicroMatrix CRM | 状态 | 后续动作 |
| --- | --- | --- | --- | --- |
| 动态字段 | `ModuleFieldService`、`resolver/field/*` | `modules/metadata` | 🟡 | 对齐全部字段类型、数据源字段、LOCATION、图片、附件、公式 |
| 动态表单 | `ModuleFormService` | Web form-engine | 🟡 | 对齐布局、显隐、联动、子表、数据源 |
| 自定义表单 | `form/*` | - | ❌ | 后续迁移 |
| 用户视图 | `UserViewService` + `CrmViewSelect` | `modules/saved-views` + `SavedViewBar` | 🟡 | Lead/Customer/池/协作的 CRUD/固定/启停/排序、active view 与 per-view 列偏好已验收；其它业务模块后续扩展 |
| 高级搜索 | `search/*` | 部分列表筛选 | 🟡 | 对齐组合条件、数据范围、字段掩码 |
| 全局搜索 | `GlobalSearchController` | - | ❌ | 迁移全局跨模块搜索 |
| 数据权限 | `DataScopeService`、`permission/*` | `DataScopeService` + `ScopeResolverService` + `ResourceAccessService` | 🚧 | 权限码+数据范围基础抽象已落地；审批状态权限与待办任务特例留 Wave 4 |
| 字段脱敏 | `UserDesensitizationInterceptor` | - | ❌ | 后续迁移 |
| 操作日志 | `BaseModuleLogService` 等 | `modules/logs` + `BusinessChangeLogService` | 🚧 | 通用递归字段 diff 已接 Lead/Customer 更新与合并；继续扩对象和时间线 UI |
| 登录日志 | `SysLoginLogService` | `modules/logs` | 🟡 | 对齐筛选与审计能力 |
| 附件 | `AttachmentService` | `modules/attachments` | ✅ | 后续仅补对象接入覆盖面和存储 Provider |
| 导入导出 | `excel/*`、`BaseExportService` | `SpreadsheetService` + Lead/Customer/Pool xlsx API | 🟡 | R2 已完成 xlsx ADD/UPDATE、预检、字段选择、全量/选中导出；剩余 `.xls` 兼容与字段 `unique` 规则 |
| 异步导出中心 | `ExportTaskCenterService` | `ExportTask` + `ExportTasksService` | 🟡 | R2 已落任务契约、24h 保留与创建者隔离；当前同步生成文件，Wave 6 再切 BullMQ 异步执行 |
| API Key | `UserKeyService`、`ApiKeyFilter` | API Token | 🟡 | 对齐权限、生命周期和调用审计 |
| 部门 | `DepartmentService` | `modules/departments` | 🟡 | 对齐部门主管等组织语义 |
| 成员 | `OrganizationUserService` | `modules/members` | 🟡 | 对齐扩展资料、状态、同步边界 |
| 角色 | `RoleService` | `modules/roles` | 🟡 | 对齐权限树、数据范围、自定义部门范围 |
| 系统设置 | `OrganizationConfigService` | `modules/settings` | 🟡 | 按实际功能逐项迁移 |
| 公告 | `AnnouncementService` | - | ❌ | 后续判断是否纳入 |
| 数据字典 | `DictService` | - | ❌ | 后续迁移 |

## 第三方与明确排除项

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| Cordys License / CE / EE | ⛔ | MicroMatrix CRM 不实现该授权体系 |
| DataEase | ⛔ | 继续使用 ECharts 自建报表 |
| SQLBot / MaxKB / WorkBuddy 等 AI 能力 | ⛔ | 不属于当前 CRM 核心复刻范围 |
| Cordys MCP / Skills | ⛔ | 当前不纳入 |
| 商业标讯 API | ⛔ | 仅保留演示源 + 手动录入 + 转线索 |
| 企微 / 钉钉 / 飞书 | 🟡 | 作为独立集成能力后置，不阻塞核心 CRM 对齐 |
| SSO / 用户同步 | ❌ | 企业部署阶段再迁移 |

## 每个模块的迁移验收模板

每个 CordysCRM 模块迁移时必须完成以下项目：

1. 列出 Controller API 与 MicroMatrix API 对照。
2. 列出 Domain/表关系与 Prisma Model 对照。
3. 提取 Service 中的状态机、校验规则、事务边界和副作用。
4. 提取 Mapper XML 中无法被普通 CRUD 覆盖的查询语义。
5. 提取权限、数据范围、字段脱敏和操作日志规则。
6. 提取定时任务、通知、审批、附件等跨模块联动。
7. 实现 NestJS/Prisma 版本，不照搬 Spring/MyBatis 结构。
8. 增加单元/集成/冒烟测试。
9. 更新本表状态和差异说明。
