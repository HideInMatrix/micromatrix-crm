# Cordys 用户功能图收口计划

本计划用于收口用户确认的功能图：工作台、线索/线索池、客户/联系人/公海、仪表板，以及系统下的组织架构、角色权限、企业设置/企微配置。实施仍以 `CordysCRM/` 源码为第一事实来源，运行页面只用于交互验收。

## 当前结论

- 基础公共能力：组织架构、角色权限、租户隔离、数据权限、操作日志、模块菜单底座已具备。
- 图中销售模块：已有可运行页面和 API，但“存在”不等于与 Cordys 完整一致，仍需按模块逐页读取源码后复查字段、操作、权限、状态与关联数据。
- 企业设置：W3.1 配置、W3.2 组织同步和 W3.3 统一登录/企微消息渠道均已完成；下一步进入图中业务模块逐页复查。

## 执行顺序

| 阶段 | 范围                    | 完成标准                                                                               | 状态       |
| ---- | ----------------------- | -------------------------------------------------------------------------------------- | ---------- |
| W3.1 | 企业设置 → 企微配置底座 | 配置、AES-GCM 安全存储、连接测试、权限、审计、页面和自动化验收                         | `VERIFIED` |
| W3.2 | 企微组织同步            | 部门/成员差异预览、外部 ID 映射、冲突策略、同步执行与记录、失败重试和页面闭环          | `VERIFIED` |
| W3.3 | 企微统一登录与消息渠道  | 外部身份/OAuth state、绑定与解绑、登录审计；消息渠道开关、发送器、重试与投递审计       | `VERIFIED` |
| W3.4 | 图中业务模块逐页复查    | 首页、线索/池、客户/联系人/公海、仪表板逐页完成源码→API→Service→数据模型→页面→测试闭环 | `IN_PROGRESS` |

## W3.2 验收结论

1. 已读取 Cordys 组织同步入口及 `ThirdDepartmentService`、`WeComDepartmentService`、`UserSyncController`、`DataHandleUtils` 全链路源码。
2. 已落地部门/成员外部映射、同步批次、差异项、冲突 resolution、凭据版本和活动批次并发约束，DB-013 标记为 `VERIFIED`。
3. 同步复用 W3.1 加密凭据，浏览器、批次快照、日志和错误响应均不保存或回显 Secret/token。
4. 隔离租户已验证新增、更新、禁用、重复应用、邮箱冲突绑定、默认角色、部门主管、权限拒绝、日志和通知；W3.3 可以开始。

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
6. 任务 1.2～1.3 已完成 [直接模型与破坏性迁移审计](./specs/business-module-page-parity/schema-migration-audit.md)：Prisma 已建立 32 张目标表并删除旧模型，破坏性迁移已通过隔离空库全部 30 个 migration 复放；主开发库尚未应用，下一步执行 1.4 模块表单与动态字段底座。
7. 任务 1.4 的 [模块表单与动态字段公共底座](./specs/business-module-page-parity/field-foundation-audit.md) 已实现并通过 `77/77` 规则测试及真实 PostgreSQL 12 项 Smoke；目标业务列表/详情/导入导出仍待 1.7 接入，因此 1.4 暂不整体关闭。下一独立执行单元为 1.5 用户视图直接模型与公共 Service。

## 长期完成约束

- 每个页面先读 Cordys 对应 Vue/API，再沿接口读取 Controller/Service/Domain/Mapper/迁移；公共依赖先于业务页面对齐。
- 当前阶段不实施但已发现的数据结构必须登记到 [暂缓能力与数据模型缺口台账](./cordys-deferred-backlog.md)，不能只写在聊天或提交说明中。
- 只有迁移、API、页面、权限、审计、自动化和浏览器验收均通过，阶段才能标记 `VERIFIED`。
