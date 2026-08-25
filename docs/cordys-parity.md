# CordysCRM 功能对齐总表

> 本文档用于追踪 MicroMatrix CRM 与 `CordysCRM/` 的功能一致性。CordysCRM 仅作为功能、业务规则、接口行为和数据关系的参考基准；MicroMatrix CRM 继续采用 NestJS + Prisma + PostgreSQL + Redis 的独立实现。

## 对齐原则

1. **功能优先**：先确认 CordysCRM 的真实业务能力，再决定 MicroMatrix CRM 的实现范围。
2. **语义迁移**：迁移业务规则、状态机、数据关系、权限语义与接口行为，不做 Java → TypeScript 的机械逐行翻译。
3. **技术栈保持独立**：Spring/MyBatis/Shiro/Spring Cache 等分别映射到 NestJS/Prisma/Guard/Redis 等当前技术方案。
4. **商业能力单独判断**：DataEase、AI、MCP、第三方商业数据等不因 CordysCRM 存在就自动纳入。
5. **不实现 Cordys 授权体系**：MicroMatrix CRM 不设计 Cordys 的 License/CE/EE 机制。
6. **许可证边界**：若直接复用、翻译或形成 CordysCRM 源码的衍生实现，需要继续遵守其许可证及附加条款；若未来需要独立闭源商业发行，应以功能规格/行为为依据重新实现，避免直接复制源码表达。
7. **源码驱动探测**：先从 Cordys 页面源码与 API 封装定位能力，再沿接口阅读 Controller、Service、Domain、DTO 和 Mapper XML；运行页面仅用于确认实例状态与最终验证，禁止从静态菜单、路由或截图反推功能。
8. **公共底座优先**：跨页面的组织、角色权限、模块配置、元数据、流程和消息能力先独立对齐并验收，业务模块在其依赖就绪后逐页闭环。

## 状态定义

- `✅`：功能及核心业务规则已实现并完成验收
- `🟡`：已有实现，但与 CordysCRM 仍存在能力差距
- `🚧`：正在迁移
- `❌`：尚未实现
- `⛔`：明确不纳入 MicroMatrix CRM

## 核心业务模块

| CordysCRM 模块 | 关键参考实现                                                                                          | MicroMatrix CRM         | 状态 | 后续动作                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------- | ----------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 线索           | `clue/*`、`ClueService`、`PoolClueService`                                                            | `modules/leads`         | ✅   | R1/R2/R4 已完成多池、领取/回收/库容、SavedView、负责人历史、批量、xlsx 导入导出与三条客户转换路径；FollowUpPlan/显式 FormLinkScenario 属平台后续能力                           |
| 客户           | `customer/*`、`CustomerService`、`customerOverviewDrawer.vue`、Mobile `customer/index.vue/detail.vue` | `customers`             | ✅   | R5 已完成客户概览和 Mobile 详情；W2.2 已继续补齐 PC/Mobile 跟进计划 Tab，并复用协作/只读语义                                                                                   |
| 联系人         | `CustomerContactController/Service`、`contact.vue`、`contactTable.vue`                                | `modules/contacts`      | ✅   | R3 已对齐独立列表/数据视图、客户内嵌列表、动态字段、启停、商机关联删除保护、批改、xlsx 导入导出与 Cordys 工具条交互；R5 已接入 PC/Mobile 客户 360 与 Mobile 客户模块联系人页签 |
| 商机           | `opportunity/*`、`OpportunityService`                                                                 | `modules/opportunities` | 🟡   | 补齐关闭规则、阶段高级配置、负责人/跟进联动                                                                                                                                    |
| 报价           | `OpportunityQuotation*`                                                                               | `modules/quotes`        | 🟡   | 对齐审批、快照、联系人、用户视图、操作日志                                                                                                                                     |
| 产品           | `product/*`、`ProductService`                                                                         | `modules/products`      | 🟡   | 补齐产品价格/价格表、日志、导出                                                                                                                                                |
| 合同           | `contract/*`、`ContractService`                                                                       | `modules/contracts`     | 🟡   | 补齐可配置阶段、快照、用户视图、完整审批语义                                                                                                                                   |
| 回款计划       | `ContractPaymentPlanService`                                                                          | `modules/contracts`     | 🟡   | 对齐字段、视图、导出、权限与审批联动                                                                                                                                           |
| 回款记录       | `ContractPaymentRecordService`                                                                        | `modules/contracts`     | 🟡   | 对齐字段、视图、导出、权限与审批联动                                                                                                                                           |
| 发票           | `ContractInvoiceService`                                                                              | `modules/contracts`     | 🟡   | 补齐开票明细、视图、导出、快照/审批                                                                                                                                            |
| 工商抬头       | `BusinessTitleService`                                                                                | `modules/contracts`     | 🟡   | 对齐配置、导出和业务规则                                                                                                                                                       |
| 订单           | `order/*`、`OrderService`                                                                             | `modules/orders`        | 🟡   | 补齐可配置阶段、快照、产品明细、收货信息                                                                                                                                       |

## 协同与流程

| CordysCRM 模块 | 关键参考实现                                        | MicroMatrix CRM                                      | 状态 | 后续动作                                                                                                                                                                                 |
| -------------- | --------------------------------------------------- | ---------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 跟进记录       | `FollowUpRecordService`                             | `modules/follow-ups`                                 | 🟡   | 对齐评论、@成员、附件、字段、日志、视图                                                                                                                                                  |
| 跟进计划       | `FollowUpPlanService`、`FollowUpPlanRemindListener` | `modules/follow-up-plans`                            | 🟡   | W2.2 已完成 CRUD、四态、数据范围、客户协作、原子转记录、到期提醒、我的计划、PC/Mobile、顶部 event 和客户 360；评论/评论计数与动态表单配置后续独立迁移                                    |
| 审批流         | `approval/*`                                        | `modules/approvals`                                  | 🟡   | W2.5 已完成流程列表、独立权限、软删除、不可变版本、基础线性图、实例版本绑定和 Vue Flow 设计器；发票运行时、更新/删除触发、条件/加签/退回/抄送/字段权限/Webhook 见 DB-003、DB-010～DB-012 |
| 站内通知       | `NotificationService`、`notice/*`、`MessageTask*`   | `modules/notifications` + `modules/message-settings` | 🟡   | W2.4 已完成统一分发、范围解析和 32/35 个真实触发链路；剩余合同归档/作废、发票审批及其数据模型缺口见暂缓台账，邮件/第三方发送器后置                                                       |
| 定时任务       | `schedule/*`、`job/*`                               | Nest Schedule                                        | 🟡   | 统一任务注册、回收、提醒、清理策略                                                                                                                                                       |

## 平台能力

| CordysCRM 模块 | 关键参考实现                                                          | MicroMatrix CRM                                                       | 状态 | 后续动作                                                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 动态字段       | `ModuleFieldService`、`resolver/field/*`                              | `modules/metadata`                                                    | 🟡   | 对齐全部字段类型、数据源字段、LOCATION、图片、附件、公式                                                                                                                                     |
| 动态表单       | `ModuleFormService`                                                   | Web form-engine                                                       | 🟡   | 对齐布局、显隐、联动、子表、数据源                                                                                                                                                           |
| 自定义表单     | `form/*`                                                              | -                                                                     | ❌   | 后续迁移                                                                                                                                                                                     |
| 用户视图       | `UserViewService` + `CrmViewSelect`                                   | `modules/saved-views` + `SavedViewBar`                                | 🟡   | Lead/Customer/池/协作的 CRUD/固定/启停/排序、active view 与 per-view 列偏好已验收；其它业务模块后续扩展                                                                                      |
| 高级搜索       | `search/*`                                                            | 部分列表筛选                                                          | 🟡   | 对齐组合条件、数据范围、字段掩码                                                                                                                                                             |
| 全局搜索       | `GlobalSearchController`                                              | -                                                                     | ❌   | 迁移全局跨模块搜索                                                                                                                                                                           |
| 数据权限       | `DataScopeService`、`permission/*`                                    | `DataScopeService` + `ScopeResolverService` + `ResourceAccessService` | ✅   | R7 已完成多角色功能权限并集、按权限码筛选角色后的数据范围合并、无关角色范围隔离和权限维度授权上限；后续审批待办特例随审批重构处理                                                            |
| 字段脱敏       | `UserDesensitizationInterceptor`                                      | -                                                                     | ❌   | 后续迁移                                                                                                                                                                                     |
| 操作日志       | `BaseModuleLogService` 等                                             | `modules/logs` + `BusinessChangeLogService`                           | 🚧   | 通用递归字段 diff 已接 Lead/Customer 更新与合并；继续扩对象和时间线 UI                                                                                                                       |
| 登录日志       | `SysLoginLogService`                                                  | `modules/logs`                                                        | 🟡   | 对齐筛选与审计能力                                                                                                                                                                           |
| 附件           | `AttachmentService`                                                   | `modules/attachments`                                                 | ✅   | 后续仅补对象接入覆盖面和存储 Provider                                                                                                                                                        |
| 导入导出       | `excel/*`、`BaseExportService`                                        | `SpreadsheetService` + Lead/Customer/Pool xlsx API                    | 🟡   | R2 已完成 xlsx ADD/UPDATE、预检、字段选择、全量/选中导出；R4 已补客户/联系人核心系统字段 `unique` 规则，剩余 `.xls` 与更完整字段规则体系                                                     |
| 异步导出中心   | `ExportTaskCenterService`                                             | `ExportTask` + `ExportTasksService`                                   | 🟡   | R2 已落任务契约、24h 保留与创建者隔离；当前同步生成文件，Wave 6 再切 BullMQ 异步执行                                                                                                         |
| API Key        | `UserKeyService`、`ApiKeyFilter`                                      | API Token                                                             | 🟡   | 对齐权限、生命周期和调用审计                                                                                                                                                                 |
| 部门           | `DepartmentService`、`views/system/org`                               | `modules/departments`                                                 | ✅   | 已对齐根节点保护、同级唯一、循环保护、部门主管、空子树整体删除与部门树/成员同页入口                                                                                                          |
| 成员           | `OrganizationUserService`、`views/system/org/components/orgTable.vue` | `modules/members` + `modules/organization-sync` + `modules/wecom-sso` | 🟡   | 已完成同页成员 CRUD、多角色、企微组织同步及 W3.3 统一登录/身份管理；性别、工作城市、入职日期、会话失效和多部门仍待迁移                                                                       |
| 角色           | `RoleService`、`views/system/role`                                    | `modules/roles`                                                       | ✅   | 已对齐 canonical 权限树、授权上限、内置角色保护、CUSTOM 下级语义，以及角色列表 + 权限/成员页签                                                                                               |
| 模块配置       | `SystemModuleService`、`views/system/module`                          | `modules/module-configs` + Pinia                                      | 🟡   | 租户级模块启停、主导航排序、固定模块校验与动态菜单已完成；W2.1 已对齐 Cordys 当前顶部导航“列表+排序”边界并驱动 Header，源码虽有 `enable` 字段但无开关 UI/API；各业务模块专属设置仍需逐项迁移 |
| 消息设置       | `views/system/message`、`MessageTaskController/Service`               | `modules/message-settings` + `modules/notifications`                  | 🟡   | W2.3/W2.4 设置与触发已完成，W3.3 已接企微文本消息、重试和投递审计；公告、邮件、钉钉/飞书及暂缓台账中的 3 个领域事件后续独立对齐                                                              |
| 系统设置       | `OrganizationConfigService`、`IntegrationConfigService`               | `modules/settings` + `modules/enterprise-integrations`                | 🟡   | W3.1-W3.3 已完成企业信息/集成/API 分区、企微配置、加密凭据、连接测试、组织同步、统一登录和企微消息；其他企业平台仍待独立迁移                                                                 |
| 公告           | `AnnouncementService`                                                 | -                                                                     | ❌   | 后续判断是否纳入                                                                                                                                                                             |
| 数据字典       | `DictService`                                                         | -                                                                     | ❌   | 后续迁移                                                                                                                                                                                     |

## 第三方与明确排除项

| 能力                                  | 状态 | 说明                                                                         |
| ------------------------------------- | ---- | ---------------------------------------------------------------------------- |
| Cordys License / CE / EE              | ⛔   | MicroMatrix CRM 不实现该授权体系                                             |
| DataEase                              | ⛔   | 继续使用 ECharts 自建报表                                                    |
| SQLBot / MaxKB / WorkBuddy 等 AI 能力 | ⛔   | 不属于当前 CRM 核心复刻范围                                                  |
| Cordys MCP / Skills                   | ⛔   | 当前不纳入                                                                   |
| 商业标讯 API                          | ⛔   | 仅保留演示源 + 手动录入 + 转线索                                             |
| 企微 / 钉钉 / 飞书                    | 🟡   | W3.3 已完成企微配置、同步、统一登录和文本消息；钉钉/飞书仍待迁移             |
| SSO / 用户同步                        | 🟡   | 企微同步、统一登录、身份管理和登录审计已完成；其他 provider 与多部门仍待迁移 |

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
