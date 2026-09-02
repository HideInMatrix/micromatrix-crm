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

> W3.4 用户确认功能图（首页、线索/线索池、客户/联系人/客户公海、仪表板）已于 2026-08-28 完成 W3.4.0～W3.4.5 最终验收并标记 `VERIFIED`。W3.6.0～W3.6.6 随后已关闭商机、产品/价格表、报价、合同、回款计划/记录、发票、工商抬头和订单交易链；2026-08-30 又完成 DB-021 FollowUpPlan 独立 Field/Blob。下表仍保留其它尚未完成的 Cordys 能力，不能把交易链/DB-021 完成误解为整个 CordysCRM 已 100% 复刻。
>
> 2026-09-02 **W3.7 高级审批深化已完成最终封板**。DB-010、DB-011、DB-012 均为 `VERIFIED`；9.5 已重新执行 DB-010/011/012 专项、审批流程/审批中心 Browser、Root/Rules、68 migrations 空库双 Seed、workspace 静态构建和 legacy scan，全部通过。服务端旧 `createNodes-only` 线性自动推导已删除，流程设置高级节点/字段/post/Webhook/duplicate 配置均进入真实业务契约；当前没有尚未执行的 W3.7 task。销售核心业务表 12/12 均为 ✅，剩余差异主要集中在协同深度、元数据/表单/搜索、审计/异步导出和少量平台/第三方能力。整体路线见 [project-progress.md](./project-progress.md)。

| CordysCRM 模块 | 关键参考实现                                                                                          | MicroMatrix CRM         | 状态 | 后续动作                                                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------- | ----------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 线索           | `clue/*`、`ClueService`、`PoolClueService`                                                            | `modules/leads`         | ✅   | W3.4.2 已完成普通 `/lead/*`、三条转换、多线索池、Owner History、User View、PC 页面及模块设置中的 Pool/Capacity/Move Reason；task 3.7 API `22/22`、Browser `17/17` 与原专项/根 Smoke 全绿 |
| 客户           | `customer/*`、`CustomerService`、`customerOverviewDrawer.vue`、Mobile `customer/index.vue/detail.vue` | `customers`             | ✅   | W3.4.3 task 4.1～4.7 已完成客户/联系人/公海直接模型、分域 API、360、协作/关系/合并、Pool/Capacity/Reason、桌面与 Mobile 页面最终对齐；W3.4.5 最终客户 Browser 23/23、根级 Smoke 223/223 |
| 联系人         | `CustomerContactController/Service`、`contact.vue`、`contactTable.vue`                                | `modules/contacts`      | ✅   | W3.4.3 task 4.3 已切换 `/account/contact/*`，完成 nullable `customerId`、Contact DataScope、Customer 子资源裁剪、动态字段/唯一性、启停、批改、导入导出、图表与关联商机拒删；专项 Smoke `18/18` |
| 商机           | `opportunity/*`、`OpportunityService`                                                                 | `modules/opportunities` | ✅   | W3.6.0 已完成 direct model、Field/Blob、阶段/失败原因、关闭规则与自动关闭、User View、列表/看板/详情/联系人/跟进及 `/system/modules` 阶段/规则入口；Browser 18/18、根 Smoke 224/224、Rules 114/114 |
| 报价           | `OpportunityQuotation*`                                                                               | `modules/quotes`        | ✅   | W3.6.2 已完成 `opportunity_quotation` direct model、Field/Blob/Snapshot、CREATE/UPDATE/DELETE Approval、User View、作废/批量、PDF/Download 与商机→报价→合同深链；Browser 28/28，模块设置 5/5 |
| 产品           | `product/*`、`price/*`、`ProductService`、`ProductPriceService`                                      | `modules/products`      | ✅   | W3.6.1 已完成 Product/Price direct model、PICTURE、SUB_PRODUCT、二级表头导入导出和页面；W3.6.2 已关闭“价格表被报价引用时禁止删除”跨域保护，Product/Price Browser 19/19 |
| 合同           | `contract/*`、`ContractService`                                                                       | `modules/contracts`     | ✅   | W3.6.3 已完成 `contract + field/blob + snapshot + stage_config`、Saved View、NORMAL/ADVANCED 阶段、CREATE/UPDATE/DELETE Approval、列表/看板/详情、`fromQuote` 与 `/system/modules` 合同表单/阶段；Browser 56/56，模块设置 14/14 |
| 回款计划       | `ContractPaymentPlanService`                                                                          | `modules/contracts`     | ✅   | W3.6.4 已完成 direct model、独立负责人、Field/Blob、CRUD/批改、DataScope、合同关联与到期通知；W3.6.6 权限矩阵和空库最终复验通过                                                         |
| 回款记录       | `ContractPaymentRecordService`                                                                        | `modules/contracts`     | ✅   | W3.6.4 已完成 direct model、Field/Blob、银行/账号等真实 metadata、CRUD/合同关联/汇总与页面；最终交易链、权限矩阵和空库复验通过                                                        |
| 发票           | `ContractInvoiceService`                                                                              | `modules/contracts`     | ✅   | W3.6.4 已完成 direct Invoice、Field/Blob/Snapshot、CREATE/UPDATE/DELETE Approval、统一审批资源、工商抬头关联与页面；`INVOICE_APPROVAL` 已闭环并进入最终 Rules/Root 回归                 |
| 工商抬头       | `BusinessTitleService`                                                                                | `modules/contracts`     | ✅   | W3.6.4 已完成 direct Business Title、必填配置、CRUD、发票关联及 `/system/modules` 工商抬头必填设置；W3.6.6 最终模块设置 Browser 继续通过                                             |
| 订单           | `order/*`、`OrderService`                                                                             | `modules/orders`        | ✅   | W3.6.5 已完成 direct Order、Field/Blob、产品信息、Snapshot、状态流、CREATE/UPDATE/DELETE Approval、列表/详情/看板与 `/system/modules`；W3.6.6 最终权限/空库/Browser/Root 回归通过       |

## 协同与流程

| CordysCRM 模块 | 关键参考实现                                        | MicroMatrix CRM                                      | 状态 | 后续动作                                                                                                                                                                                                                                     |
| -------------- | --------------------------------------------------- | ---------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 跟进记录       | `FollowUpRecordService`                             | `modules/follow-ups`                                 | 🟡   | 对齐评论、@成员、附件、字段、日志、视图                                                                                                                                                                                                      |
| 跟进计划       | `FollowUpPlanService`、`FollowUpPlanRemindListener` | `modules/follow-up-plans`                            | 🟡   | W2.2 已完成 CRUD、四态、数据范围、客户协作、原子转记录、到期提醒、我的计划、PC/Mobile、顶部 event 和客户 360；DB-021 已完成 `followPlan` ModuleForm、独立 Field/Blob、筛选/复制链及 PC/Mobile 动态字段往返。剩余差异主要是评论/评论计数与 Cordys 三套 CUSTOMER/BUSINESS/CLUE FormDesign 上下文布局等更大表单设计能力 |
| 审批流         | `approval/*`                                        | `modules/approvals`                                  | ✅   | W2.5 基础版本图、DB-010 通用资源快照/UPDATE/DELETE 上下文、DB-011 高级 task/record/action/附件、DB-012 9.4A～F 条件图/异常策略/字段权限/post-field/Webhook/Vue Flow 高级编辑与统一 `nodes + links` 写契约均已真实完成；旧线性 payload 自动推导已删除，W3.7-9.5 最终封板已通过。 |
| 站内通知       | `NotificationService`、`notice/*`、`MessageTask*`   | `modules/notifications` + `modules/message-settings` | 🟡   | W2.4 已完成统一分发与范围解析；W3.6.3 已接合同阶段作废/归档通知，剩余发票审批等领域触发随 W3.6.4 direct model 关闭，邮件/第三方发送器后置                                                                                                                   |
| 定时任务       | `schedule/*`、`job/*`                               | Nest Schedule                                        | 🟡   | 统一任务注册、回收、提醒、清理策略                                                                                                                                                                                                           |

## 平台能力

| CordysCRM 模块 | 关键参考实现                                                            | MicroMatrix CRM                                                       | 状态 | 后续动作                                                                                                                                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 动态字段       | `ModuleFieldService`、`resolver/field/*`                                | `modules/metadata`                                                    | 🟡   | 对齐全部字段类型、数据源字段、LOCATION、图片、附件、公式                                                                                                                                                                                                                     |
| 动态表单       | `ModuleFormService`                                                     | Web form-engine                                                       | 🟡   | 对齐布局、显隐、联动、子表、数据源                                                                                                                                                                                                                                           |
| 自定义表单     | `form/*`                                                                | -                                                                     | ❌   | 后续迁移                                                                                                                                                                                                                                                                     |
| 用户视图       | `UserViewService` + `CrmViewSelect`                                     | `modules/user-views` + `SavedViewBar`（内部使用 UserView API）        | 🟡   | W3.4.0 已将线索、线索池、客户、联系人、客户公海切到 Cordys 资源级 UserView API 与 `sys_user_view(_condition)` 直接模型；CRUD/固定/启停/排序和业务筛选已验收，其它业务模块随逐页复刻扩展                                                                                      |
| 高级搜索       | `search/*`                                                              | 部分列表筛选                                                          | 🟡   | 对齐组合条件、数据范围、字段掩码                                                                                                                                                                                                                                             |
| 全局搜索       | `GlobalSearchController`                                                | -                                                                     | ❌   | 迁移全局跨模块搜索                                                                                                                                                                                                                                                           |
| 数据权限       | `DataScopeService`、`permission/*`                                      | `DataScopeService` + `ScopeResolverService` + `ResourceAccessService` | ✅   | R7 已完成多角色功能权限并集、按权限码筛选角色后的数据范围合并、无关角色范围隔离和权限维度授权上限；后续审批待办特例随审批重构处理                                                                                                                                            |
| 字段脱敏       | `UserDesensitizationInterceptor`                                        | -                                                                     | ❌   | 后续迁移                                                                                                                                                                                                                                                                     |
| 操作日志       | `BaseModuleLogService` 等                                               | `modules/logs` + `BusinessChangeLogService`                           | 🚧   | 通用递归字段 diff 已接 Lead/Customer 更新与合并；继续扩对象和时间线 UI                                                                                                                                                                                                       |
| 登录日志       | `SysLoginLogService`                                                    | `modules/logs`                                                        | 🟡   | 对齐筛选与审计能力                                                                                                                                                                                                                                                           |
| 附件           | `AttachmentService`                                                     | `modules/attachments`                                                 | ✅   | 后续仅补对象接入覆盖面和存储 Provider                                                                                                                                                                                                                                        |
| 导入导出       | `excel/*`、`BaseExportService`                                          | `SpreadsheetService` + Lead/Customer/Pool xlsx API                    | 🟡   | R2 已完成 xlsx ADD/UPDATE、预检、字段选择、全量/选中导出；R4 已补客户/联系人核心系统字段 `unique` 规则，剩余 `.xls` 与更完整字段规则体系                                                                                                                                     |
| 异步导出中心   | `ExportTaskCenterService`                                               | `ExportTask` + `ExportTasksService`                                   | 🟡   | R2 已落任务契约、24h 保留与创建者隔离；当前同步生成文件，Wave 6 再切 BullMQ 异步执行                                                                                                                                                                                         |
| API Key        | `UserKeyService`、`UserKeyController`、个人中心 `apiKey.vue`             | `UserApiKey` + `PersonalApiKeyService` + `AuthGuard`                  | ✅   | W3.5 已对齐个人中心条件式 API Key Tab、`PERSONAL_API_KEY:*`、最多 5 个、描述/有效期/启停/删除、AK/SK 认证与调用审计；删除企业设置中重复的 365 天 JWT 开放 API 旧链路                                                                                                    |
| 部门           | `DepartmentService`、`views/system/org`                                 | `modules/departments`                                                 | ✅   | 已对齐根节点保护、同级唯一、循环保护、部门主管、空子树整体删除与部门树/成员同页入口                                                                                                                                                                                          |
| 成员           | `OrganizationUserService`、`views/system/org/components/orgTable.vue`   | `modules/members` + `modules/organization-sync` + `modules/wecom-sso` | 🟡   | 已完成同页成员 CRUD、多角色、企微组织同步及 W3.3 统一登录/身份管理，工作台 OAuth 可补全性别/头像；工作城市、入职日期、会话失效和多部门仍待迁移                                                                                                                               |
| 角色           | `RoleService`、`views/system/role`                                      | `modules/roles`                                                       | ✅   | 已对齐 canonical 权限树、授权上限、内置角色保护、CUSTOM 下级语义，以及角色列表 + 权限/成员页签                                                                                                                                                                               |
| 模块配置       | `SystemModuleService`、`views/system/module`                            | `modules/module-configs` + Pinia                                      | 🟡   | DB-022 已验证当前业务模块专属入口均为 REAL：线索/客户、商机/报价、产品/价格表、合同/回款计划/回款记录/工商抬头必填/发票/合同阶段、订单表单/状态流均消费 direct API/metadata；其它尚未迁移的 Cordys 平台级模块仍按本总表独立推进 |
| 消息设置       | `views/system/message`、`MessageTaskController/Service`                 | `modules/message-settings` + `modules/notifications`                  | 🟡   | W2.3/W2.4 设置与触发已完成，W3.3 已接企微文本消息、重试和投递审计；公告、邮件、钉钉/飞书及暂缓台账中的 3 个领域事件后续独立对齐                                                                                                                                              |
| 系统设置       | `OrganizationConfigService`、`IntegrationConfigService`、企业设置六页签 | `modules/enterprise-settings` + `modules/enterprise-integrations`     | 🟡   | W3.4-S 已按 Cordys 重建界面设置、第三方、邮件设置、模型设置、术语设置、全局任务六页签并删除旧 `SystemSetting`/`/settings` KV 链；企微继续走独立集成域，SMTP/AI 凭证加密、术语发现和任务执行记录均已闭环。钉钉/飞书 provider 继续由 DB-015 跟踪，不以通用 KV 兼容层代替       |
| 公告           | `AnnouncementService`                                                   | -                                                                     | ❌   | 后续判断是否纳入                                                                                                                                                                                                                                                             |
| 数据字典       | `DictService`                                                           | `modules/dictionaries`                                                | 🟡   | W3.4.2 task 3.7 已建立 `sys_dict/sys_dict_config` 与 `CLUE_POOL_RS` 的 get/add/update/delete/switch/sort/config；其它 Cordys 字典类型随对应模块逐项接入，不把当前线索原因实现误标为全量完成                                                                                  |

## 第三方与明确排除项

| 能力                                  | 状态 | 说明                                                                                                                    |
| ------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------- |
| Cordys License / CE / EE              | ⛔   | MicroMatrix CRM 不实现该授权体系                                                                                        |
| DataEase                              | ⛔   | 不内置 DataEase 服务端；W3.4.4 已完成 Cordys 仪表板目录/资源/收藏、通用安全嵌入与 `/reports` 页面替换，DataEase provider/token 由 DB-023 deferred |
| SQLBot / MaxKB / WorkBuddy 等 AI 能力 | ⛔   | 不属于当前 CRM 核心复刻范围                                                                                             |
| Cordys MCP / Skills                   | ⛔   | 当前不纳入                                                                                                              |
| 商业标讯 API                          | ⛔   | 仅保留演示源 + 手动录入 + 转线索                                                                                        |
| 企微 / 钉钉 / 飞书                    | 🟡   | 企微配置、同步、统一登录、文本消息和相关数据模型已验收；钉钉/飞书仍待迁移                                               |
| SSO / 用户同步                        | 🟡   | 企微同步、统一登录、身份管理和登录审计已完成；其他 provider 与多部门仍待迁移                                            |

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
