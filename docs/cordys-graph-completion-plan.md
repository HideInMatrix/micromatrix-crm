# Cordys 用户功能图收口计划

本计划用于收口用户确认的功能图：工作台、线索/线索池、客户/联系人/公海、仪表板，以及系统下的组织架构、角色权限、企业设置/企微配置。实施仍以 `CordysCRM/` 源码为第一事实来源，运行页面只用于交互验收。

## 当前结论

- 基础公共能力：组织架构、角色权限、租户隔离、数据权限、操作日志、模块菜单底座已具备。
- 图中销售模块：已有可运行页面和 API，但“存在”不等于与 Cordys 完整一致，仍需按模块逐页读取源码后复查字段、操作、权限、状态与关联数据。
- 企业设置：W3.1 配置、W3.2 组织同步、W3.3 统一登录/企微消息渠道以及后续 W3.4-S 六页签领域化/登录品牌/前端目录收口均已完成；当前主线是 W3.4 图中业务模块逐页复查，W3.4.1 首页与 W3.4.2 线索/线索池均已关闭，W3.4.3 客户域 task 4.4 已完成，当前执行 task 4.5.0 模块设置三个客户公海入口。

## 执行顺序

| 阶段   | 范围                    | 完成标准                                                                               | 状态          |
| ------ | ----------------------- | -------------------------------------------------------------------------------------- | ------------- |
| W3.1   | 企业设置 → 企微配置底座 | 配置、AES-GCM 安全存储、连接测试、权限、审计、页面和自动化验收                         | `VERIFIED`    |
| W3.2   | 企微组织同步            | 部门/成员差异预览、外部 ID 映射、冲突策略、同步执行与记录、失败重试和页面闭环          | `VERIFIED`    |
| W3.3   | 企微统一登录与消息渠道  | 外部身份/OAuth state、绑定与解绑、登录审计；消息渠道开关、发送器、重试与投递审计       | `VERIFIED`    |
| W3.4-D | Docker 发布链路         | API/Web 双镜像、Prisma migration、Nginx runtime proxy、Tag→GHCR 多架构自动发布         | `VERIFIED`    |
| W3.4   | 图中业务模块逐页复查    | 首页、线索/池、客户/联系人/公海、仪表板逐页完成源码→API→Service→数据模型→页面→测试闭环 | `IN_PROGRESS` |

## W3.2 验收结论

1. 已读取 Cordys 组织同步入口及 `ThirdDepartmentService`、`WeComDepartmentService`、`UserSyncController`、`DataHandleUtils` 全链路源码。
2. 已落地部门/成员外部映射、同步批次、差异项、冲突 resolution、凭据版本和活动批次并发约束，DB-013 标记为 `VERIFIED`。
3. 同步复用 W3.1 加密凭据，浏览器、批次快照、日志和错误响应均不保存或回显 Secret/token。
4. 隔离租户已验证新增、更新、禁用、重复应用、邮箱冲突绑定、默认角色、部门主管、权限拒绝、日志和通知；该验收随后进入 W3.3。

## W3.3 验收结论

1. 已按 Cordys 登录页、OAuth state、SSO、MessageTask、NoticeSendService 和 WeComNoticeSender 源码固化行为边界；W3.2 成员映射是唯一账号识别来源，未知成员不会自动注册。
2. 已落地一次性 OAuth state、HttpOnly 浏览器 nonce、外部身份状态、企微登录审计、事件企微开关和持久化投递 outbox；DB-006、DB-014 均为 `VERIFIED`。
3. PC 点击企微图标后直接使用 `@wecom/jssdk` 官方扫码组件；工作台 WebView 由 `wxwork` 环境判断进入独立 `snsapi_privateinfo` 网页 OAuth，两个流程使用不同 state 前缀、数据库 flow、nonce cookie、回调接口和登录审计类型。
4. 用户/OAuth 模型已直接改为 Cordys 语义，本地开发库从零应用全部迁移并 Seed 成功；规则测试 `66/66`、19 条专项 Smoke、API/Web 类型检查、Lint 与生产构建全部通过。浏览器已验证 PC 直接扫码入口、工作台失败/回退页及回调错误页均无 console error/warn；真实企微扫码回调仍要求部署域名加入企微信任域名。

## W3.4 需求与设计阶段结论

1. 已从 Cordys 首页、线索/线索池、客户/联系人/公海和仪表板页面入口沿 API 定位到对应 Controller、Service 与 Domain；需求基线见 [W3.4 图中业务模块逐页对齐需求](./specs/business-module-page-parity/requirements.md)。
2. 现有 `/dashboard` 是 MicroMatrix 自定义销售大屏，与 Cordys 普通工作台不一致；W3.4 将按 Cordys 改为数据概览、快捷入口、我的计划、审批待办和消息通知。
3. 现有 `/reports` 是 MicroMatrix ECharts 报表，与 Cordys 仪表板目录/外部资源管理不一致；W3.4 将直接替换，不保留旧页面兼容入口。
4. 线索、客户、联系人主链路虽已多轮验收，W3.4 仍先执行直接数据模型和公共列表底座复查；新发现的数据模型差异已登记为 DB-016～DB-020。
5. W3.4 需求、技术设计和任务清单均已确认，阶段进入 `IN_PROGRESS`。任务 1.1 已完成 [直接模型与调用方影响审计](./specs/business-module-page-parity/model-impact-audit.md)，锁定 32 张 Cordys 直接表、旧模型调用方、禁止兼容路径和一次性替换顺序。
6. 任务 1.2～1.3 已完成 [直接模型与破坏性迁移审计](./specs/business-module-page-parity/schema-migration-audit.md)：Prisma 已建立 32 张目标表并删除旧模型，破坏性迁移已通过隔离空库全部 30 个 migration 复放；该历史节点随后进入 1.4 模块表单与动态字段底座。
7. 任务 1.4 的 [模块表单与动态字段公共底座](./specs/business-module-page-parity/field-foundation-audit.md) 已实现并通过 `77/77` 规则测试及真实 PostgreSQL 12 项 Smoke；目标业务列表/详情/导入导出仍待 1.7 接入，因此 1.4 暂不整体关闭。
8. 任务 1.5 的 [用户视图直接模型](./specs/business-module-page-parity/user-view-foundation-audit.md) 已完成：五类资源切换到 Cordys View API、条件文本序列化和三重隔离，旧 SavedView 数据库访问已删除；全量规则测试 `84/84` 和真实 PostgreSQL 12 项 Smoke 通过。
9. 任务 1.6 的 [分域池、容量与负责人历史 Repository](./specs/business-module-page-parity/pool-repository-foundation-audit.md) 已完成：Clue/Customer 独立 Repository、共享无状态规则计算器、Owner 生命周期和 PostgreSQL 并发锁已落地；全量规则测试 `95/95`，隔离空库 30 migration 与 9 项真实库 Smoke 通过。该历史节点随后进入 1.7 业务调用方迁移和旧代码删除。
10. 任务 1.7 的 [业务调用方直接模型迁移](./specs/business-module-page-parity/business-caller-migration-audit.md) 已完成：线索、客户、联系人、360、协作、关系、合并、跟进、商机联系人、通知、统计和自动回收已切换到 Cordys 直接模型，旧通用池 Controller/Service/DTO 已删除；生产 API 构建和 `95/95` 规则测试通过。该历史节点随后进入 1.8 Seed 与空库启动验收。
11. 任务 1.8 的 [Seed 与空库启动验收](./specs/business-module-page-parity/seed-empty-db-audit.md) 经复核并修正完成：补齐 HiddenField、Owner History、协作、关系、转化关系及联系人/线索 Blob 值，审计加强为 23 个关键索引和完整直接关系断言；本地开发库已用最终修正版从零复放全部 30 个 migration，双次 Seed、增强审计、`95/95` 规则测试、类型检查、Lint、构建、API/Web 启动与 HTTP 200 均通过；随后进入 1.9。
12. 任务 1.9 的 [公共底座最终专项验收](./specs/business-module-page-parity/foundation-validation-audit.md) 已完成：Prisma、`97/97` 规则测试、三类 W3.4 真实库 Smoke、隔离库 30 migration、Shared/API/Web 类型与构建、全仓 Lint 均通过；根关键链路 `219/219`、W3.2 `23/23`、W3.3 `19/19` 全绿。验收同时收口 Pool Options 只读 facade、负责人历史序列化、直接字段别名、关联客户候选范围、关键词 contains 语义和交易链 Customer `organizationId` 遗漏。W3.4.0 正式关闭，随后进入 W3.4.1 首页。
13. W3.4.1 的 [首页最终专项验收](./specs/business-module-page-parity/home-validation-audit.md) 已完成：独立 Home 统计与跨页筛选、Cordys 普通工作台、真实快捷入口、默认密码状态和审批 CC 数据源全部闭环；`108/108` 规则测试、首页 API/数据库 Smoke `17/17`、Chrome Browser Smoke `12/12`、根 Smoke `219/219`、W3.2 `23/23`、W3.3 `19/19` 全绿，Shared/API/Web typecheck、Lint 和三端 production build 通过。W3.4.1 正式关闭，下一独立执行单元为 W3.4.2 线索与线索池。
14. 2026-08-27 企业设置 W3.4-S 与前端目录最终收口已完成：六页签领域化继续保持，未登录登录页可按 tenant/email 获取公开品牌并同步桌面/Mobile 标题，登录页配置移除模拟预览；前端路由页面统一归档到 `src/views/<业务模块>/`，移动页面进入模块 `mobile/` 子目录，旧 `src/mobile` 根目录删除。最终 `114/114` 规则测试、企业设置 Smoke `23/23`、根 Smoke `219/219`、Shared/API/Web typecheck、全仓 ESLint 和三端 production build 全绿。该收口不改变 W3.4 业务执行顺序，当前正式从 W3.4.2 task 3.1 开始。
15. 在进入 W3.4.2 前插入的 [W3.4-D Docker 发布链路](./specs/docker-release/tasks.md) 已完成：API/Web 独立 multi-stage image、生产 Prisma migration、Nginx SPA + runtime `/api` proxy、release compose 与 GHCR tag workflow 均已落地；本地 release Smoke 从零应用 34 个 migration 后验证 API/Web runtime 通过。`git push origin v0.0.1`（本地 tag 已存在时）会触发发布；当前执行指针恢复为 W3.4.2 task 3.1。
16. W3.4.2 的 [线索与线索池最终专项验收](./specs/business-module-page-parity/clue-validation-audit.md) 已完成：普通 `/lead/*`、三条转换、多 `/pool/lead/*`、分域 Pool/Capacity 配置、User View、Owner History 和 PC 双页面全部按 3.1 源码矩阵闭环；连续生命周期 `17/17`、普通 API `18/18`、转换 `21/21`、多 Pool `32/32`、Browser `20/20`、规则 `114/114`、首页 `17/17`、根关键链路 `219/219` 全绿，typecheck、ESLint、production build、Prisma validate/generate 与 diff 检查通过。该节点曾关闭 W3.4.2，随后在进入客户域前因模块设置三个入口遗漏重新打开 task 3.7。
17. W3.4.2 task 3.7 的 [线索模块设置补漏源码与实施审计](./specs/business-module-page-parity/clue-module-settings-audit.md) 已完成：`sys_dict/sys_dict_config` 与 `/dict/*`、线索退池原因强校验/Owner History 名称、角色 Scope、模块设置 Pool/Capacity/Move Reason 三个真实 Drawer 全部闭环；新增 migration 后本地 migration 总数为 35。专项 API `22/22`、模块设置 Browser `17/17`，并复跑连续生命周期 `17/17`、普通 API `18/18`、转换 `21/21`、多 Pool `32/32`、线索 Browser `20/20`、首页 `17/17`、rules `114/114`、根 Smoke `219/219` 全绿。验收中同时修复 Pool Drawer 异步初始化覆盖用户输入 race 与 demo Seed 默认密码幂等缺口；typecheck、ESLint、production build、Prisma validate/generate、diff 检查均通过。W3.4.2 现再次正式关闭，执行指针恢复到 **W3.4.3 task 4.1**。
18. W3.4.3 task 4.1 的 [客户、联系人和客户公海源码与 API 证据矩阵](./specs/business-module-page-parity/customer-source-api-audit.md) 已完成：锁定 `/account`、`/account/contact`、`/pool/account`、`/account-pool`、`/account-capacity` 与 `CUSTOMER_POOL_RS` 分域契约，明确普通数据范围、`COLLABORATION`、`READ_ONLY` 和 Pool Scope 四类边界，并确认联系人 `customerId` 最终可空、公海进入时间使用 `Customer.updateTime`。现有直接模型覆盖 Cordys 最终 DDL，本任务无 migration；当前进入 **W3.4.3 task 4.2：重建客户 API 与客户 360**。
19. W3.4.3 task 4.2 已完成普通客户 `/account/*` 与客户 360 后端收口：旧 `/api/customers` 移除，商机/合同/回款/发票/订单叠加各自 DataScope，负责人变更与联系人/Owner History/动态字段事务一致，删除链补齐动态字段/Blob/跟进计划清理。专项 Smoke `22/22`、rules `114/114`、Shared/API/Web typecheck 与受影响文件 ESLint 全绿。
20. W3.4.3 task 4.3 已完成联系人 `/account/contact/*` 破坏式切换：旧 `/api/contacts` 移除，独立联系人支持 nullable `customerId`，Contact SELF/部门/全部 DataScope 与 Customer 360 READ_ONLY/COLLABORATION 子资源边界分离，动态字段/唯一性、启停原因、批改、导入导出、图表和商机关联拒删全部落地；删除事务清理动态字段/Blob/附件。专项 Smoke `18/18`、rules `114/114`、Shared/API/Web typecheck、本批 ESLint、API/Web production build 与 `git diff --check` 全绿。
21. W3.4.3 task 4.4 已完成客户协作、关系和合并深层规则：协作管理不再被协作关系越权；关系整组保存强制单集团、最多 10 子公司、重复/防环和失败保留；合并恢复 Cordys 三字段并按联系人 unique 自动去重，补齐商机/FollowUpPlan 引用转挂、报价/合同/工商抬头、协作继承、主客户联系人负责人和 Owner History。专项 Smoke `30/30`，回归客户 `22/22`、联系人 `18/18`、rules `114/114`，typecheck/build/lint 全绿；当前进入 **W3.4.3 task 4.5.0：`/system/modules` 客户公海三个设置入口**。

## 长期完成约束

- 每个页面先读 Cordys 对应 Vue/API，再沿接口读取 Controller/Service/Domain/Mapper/迁移；公共依赖先于业务页面对齐。
- 当前阶段不实施但已发现的数据结构必须登记到 [暂缓能力与数据模型缺口台账](./cordys-deferred-backlog.md)，不能只写在聊天或提交说明中。
- 只有迁移、API、页面、权限、审计、自动化和浏览器验收均通过，阶段才能标记 `VERIFIED`。
