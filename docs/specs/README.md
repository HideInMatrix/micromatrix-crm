# 规格文档索引

本目录按当前长期领域组织，不再按历史任务编号、`*-parity`、Wave 或验收阶段拆分。实施过程、完成状态、一次性 audit/acceptance/plan 由 Git 历史追溯。

当前业务边界、最新验收状态和剩余事项只以 `admissions-crm-transformation` 为主线任务源。

## 当前主线

| 主题                        | 需求                                                            | 设计                                                | 当前任务                                          |
| --------------------------- | --------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------- |
| ADMISSIONS-001 通用招生 CRM | [requirements](./admissions-crm-transformation/requirements.md) | [design](./admissions-crm-transformation/design.md) | [tasks](./admissions-crm-transformation/tasks.md) |

## 长期领域规格

| 领域                                                                         | 需求                                                     | 设计                                         |
| ---------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| Platform Foundation：组织、成员、RBAC、DataScope、模块配置、个人账号/API Key | [requirements](./platform-foundation/requirements.md)    | [design](./platform-foundation/design.md)    |
| Form Engine：ModuleForm、动态字段、Data Source、子表、联动、自定义表单       | [requirements](./form-engine/requirements.md)            | [design](./form-engine/design.md)            |
| Follow-up：跟进计划、跟进记录、评论、提醒、计划转记录                        | [requirements](./follow-up/requirements.md)              | [design](./follow-up/design.md)              |
| Approval Engine：流程、版本、任务、动作、快照、Webhook                       | [requirements](./approval-engine/requirements.md)        | [design](./approval-engine/design.md)        |
| Enterprise Platform：企业设置、WeCom/DingTalk/Lark、组织同步、SSO、外部消息  | [requirements](./enterprise-platform/requirements.md)    | [design](./enterprise-platform/design.md)    |
| Infrastructure Runtime：Redis、缓存、SSE、协调、BullMQ Worker                | [requirements](./infrastructure-runtime/requirements.md) | [design](./infrastructure-runtime/design.md) |
| Messaging：MessageTaskEvent、模板/i18n、Notification、公告                   | [requirements](./messaging/requirements.md)              | [design](./messaging/design.md)              |
| Operation Log：审计、详情 Blob、Retention、清理、真实客户端 IP               | [requirements](./operation-log/requirements.md)          | [design](./operation-log/design.md)          |

## 审计文档

`admissions-crm-transformation` 下仍保留两份专项 audit：

- `external-financial-integration-audit.md`：外部财务事件 API、幂等与安全边界审计。
- `legacy-module-dependency-audit.md`：旧销售链物理删除和 destructive migration 依赖审计；正式环境 migration precheck 完成前必须保留。

## 文档保留规则

- `requirements.md` 描述当前必须满足的业务/安全约束。
- `design.md` 描述当前实现边界、数据流和维护原则。
- 只有仍在推进的主线保留 `tasks.md`；完成专项任务日志不长期保留。
- 历史阶段编号、VERIFIED/PASS 数量、当时的 migration 数量、一次性 Smoke 结果不进入长期领域文档。
- 删除业务能力时同步清理领域规格、事件、导航和 API 文档；需要历史证据时使用 Git。
