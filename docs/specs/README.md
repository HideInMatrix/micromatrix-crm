# 领域规格索引

本目录描述招生CRM 当前代码仍然提供的长期业务和平台能力。需求文档记录必须满足的业务约束，设计文档记录领域边界与关键实现原则；具体接口、字段和行为以当前代码及 Prisma contract 为准。

## 产品主线

| 主题                                                      | 需求                                                            | 设计                                                |
| --------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------- |
| 招生CRM：线索、客户、公海、转化及产品边界                 | [requirements](./admissions-crm-transformation/requirements.md) | [design](./admissions-crm-transformation/design.md) |
| Pool Recycle：线索池/客户公海动态过期、延迟任务与自动回收 | [requirements](./pool-recycle/requirements.md)                  | [design](./pool-recycle/design.md)                  |
| 线索/客户快捷搜索：PC 配置、PC/H5 查询语义与服务端校验    | —                                                               | [design](./module-quick-search.md)                  |

Pool Recycle 当前状态：核心实现已完成；线索池真实 2 分钟后端闭环已通过。客户公海真实闭环、PC 页面视觉验收及故障恢复/并发专项测试仍待完成，详见 [Pool Recycle 设计中的验收状态](./pool-recycle/design.md#8-验收状态)。

## 平台领域

| 领域                                                                         | 需求                                                     | 设计                                         |
| ---------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| Platform Foundation：组织、成员、RBAC、DataScope、模块配置、个人账号/API Key | [requirements](./platform-foundation/requirements.md)    | [design](./platform-foundation/design.md)    |
| Form Engine：ModuleForm、动态字段、Data Source、子表、联动、自定义表单       | [requirements](./form-engine/requirements.md)            | [design](./form-engine/design.md)            |
| Follow-up：跟进计划、跟进记录、评论、提醒、计划转记录                        | [requirements](./follow-up/requirements.md)              | [design](./follow-up/design.md)              |
| Enterprise Platform：企业设置、WeCom/DingTalk/Lark、组织同步、SSO、外部消息  | [requirements](./enterprise-platform/requirements.md)    | [design](./enterprise-platform/design.md)    |
| Infrastructure Runtime：Redis、缓存、SSE、协调、BullMQ Worker                | [requirements](./infrastructure-runtime/requirements.md) | [design](./infrastructure-runtime/design.md) |
| Messaging：业务事件、模板/i18n、Notification、公告                           | [requirements](./messaging/requirements.md)              | [design](./messaging/design.md)              |
| Operation Log：审计、详情 Blob、Retention、清理、客户端 IP                   | [requirements](./operation-log/requirements.md)          | [design](./operation-log/design.md)          |

## 维护规则

- 已完成的改造计划、任务清单、一次性审计和验收记录不长期保留在规格目录。
- 业务能力退出时，同步清理领域规格、导航、权限、API 和测试引用。
- 不要把历史页面、残留代码或已经退出的 CRM 模块当作当前实现要求。
- 历史决策和实施细节通过 Git 历史追溯；不要在长期规格中记录易过期的测试数量、迁移阶段或临时环境状态。
