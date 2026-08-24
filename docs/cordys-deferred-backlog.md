# Cordys 暂缓能力与数据模型缺口台账

本台账记录源码对齐过程中已经确认、但当前阶段尚未实施的能力。目的不是描述模糊的“以后再做”，而是保证整体复刻结束时每个已发现缺口都有明确去向。

最近复查：2026-08-24（W2.5 实施完成）。DB-009 的流程版本与基础线性图结构已闭环；条件节点及高级审批配置继续由 DB-012 跟踪，DB-003、DB-010、DB-011 保持未完成。

## 管理规则

- 新发现的 Cordys 能力只要当前不实施，就必须先登记再结束当前阶段。
- 数据库缺少模型、字段、枚举、关系或审计信息时，必须在“数据模型缺口”列写明。
- 状态只允许 `DISCOVERED`、`PLANNED`、`IN_PROGRESS`、`VERIFIED`、`NOT_APPLICABLE`；不得通过删除条目表示完成。
- 只有源码、迁移、API、页面、权限和测试均完成时才能标记 `VERIFIED`。
- `cordys-parity.md` 只有在关联条目全部 `VERIFIED` 或有证据标记 `NOT_APPLICABLE` 后，才允许把对应模块标为完整对齐。

## 当前台账

| ID     | 能力/事件                        | Cordys 源码依据                                                                                                                 | 当前实现缺口                                                                                                   | 数据模型缺口                                                                                                                                    | 进入实施的前置条件                                              | 状态         |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------ |
| DB-001 | 合同作废 `CONTRACT_VOID`         | `ContractStage.VOID`、`ContractStageRequest.voidReason`、`ContractService.updateStage`                                          | 当前合同只有 `TERMINATED`，没有 Cordys 作废动作、原因校验和独立权限语义                                        | `ContractStatus` 缺少明确 `VOID` 阶段；`Contract` 缺少 `voidReason`、`voidedAt/voidedById` 等审计字段；若继续采用可配置阶段，还缺合同阶段配置表 | 先按合同页面与 API 全链路对齐阶段模型，再接消息事件             | `DISCOVERED` |
| DB-002 | 合同归档 `CONTRACT_ARCHIVED`     | `ContractStage.ARCHIVED`、`ContractService.updateStage`                                                                         | 当前没有归档/完结动作及状态流转                                                                                | `ContractStatus` 缺少 `ARCHIVED`；`Contract` 缺少 `archivedAt/archivedById`；动态合同阶段配置尚未建模                                           | 与 DB-001 一并完成合同阶段设计                                  | `DISCOVERED` |
| DB-003 | 发票审批 `INVOICE_APPROVAL`      | `ApprovalActionService.sendFinishNotice` 的 `FormKey.INVOICE` 分支、`DictModule.INVOICE_APPROVAL`                               | 当前 `InvoiceRecord` 只有待开票/已开票/作废，没有提交审批入口；审批引擎把回款记录作为独立对象，不能冒充发票    | `InvoiceRecord` 缺少 `approvalStatus`、`deptId`、审批关联信息；`ApprovalModule`/审批流缺少 `invoice` 模块                                       | 先完成发票申请页面、审批状态和流程接入                          | `DISCOVERED` |
| DB-004 | 配置范围中的创建人 `CREATE_USER` | `CommonNoticeSendService.getNoticeReceiveUserIds`、Cordys `BaseModel.createUser`                                                | W2.4 解析器可识别占位符，但部分业务对象无法提供创建人上下文                                                    | `Quote`、`Contract`、`ReceivablePlan` 等缺少 `createdById`；相关创建接口未写入创建人                                                            | 在对应模块页面/API对齐时统一补审计字段并迁移历史数据            | `DISCOVERED` |
| DB-005 | 回款计划独立负责人               | `ContractPaymentPlan.owner`、`NoticeExpireJob.buildPaymentPlanNoticeContext`                                                    | 当前回款计划到期通知只能暂用合同负责人                                                                         | `ReceivablePlan` 缺少 `ownerId`、`deptId`、`createdById`                                                                                        | 对齐回款计划新增/编辑页面和负责人字段                           | `DISCOVERED` |
| DB-006 | 消息第三方渠道                   | `MessageTask` 的 DingTalk/WeCom/Lark 开关、消息设置页面按组织同步平台显示列                                                     | 当前仅有系统消息与未启用的邮件字段，无第三方发送器和组织平台绑定                                               | `message_task_settings` 缺少第三方渠道开关；缺少企业集成账号、组织同步平台和发送凭据模型                                                        | 先对齐企业集成/组织同步公共底座                                 | `DISCOVERED` |
| DB-007 | 公告                             | `views/system/message/index.vue` 公告 Tab 及公告后端模块                                                                        | 当前消息设置只实现消息通知 Tab                                                                                 | 缺少公告、公告接收范围、已读状态及附件关系模型                                                                                                  | 独立读取公告页面、API、Service、Domain、Mapper 后立项           | `DISCOVERED` |
| DB-008 | 消息模板与多语言资源             | `MessageTemplateUtils`、后端 i18n 资源                                                                                          | 当前通知正文由业务 Service 中文字符串生成，尚未完全复刻 Cordys 模板变量和多语言渲染                            | 若沿用资源文件无需业务表；如需租户自定义模板，必须先确认 Cordys 是否存在对应能力，禁止臆造模板表                                                | 完成国际化公共底座源码对齐                                      | `DISCOVERED` |
| DB-009 | 审批流版本与基础图结构           | `ApprovalFlowVersion`、`ApprovalNode`、`ApprovalNodeApprover`、`ApprovalNodeLink`                                               | W2.5 已完成主记录、不可变版本、起止/审批节点、线性连接、实例版本引用及旧线性配置迁移                           | 已补 `currentVersionId/number/formType/execute flags/deleted/audit`、版本、审批节点扩展和连接；条件节点结构归 DB-012                            | 源码、迁移、API、页面、权限、规则测试、Smoke 和浏览器验收均通过 | `VERIFIED`   |
| DB-010 | 编辑/删除审批的变更暂存与回放    | `HitApprovalAspect`、`ApprovalResourceService`、`ApprovalResourceSnapshot`、`approval_instance.execute_time/update_fields`      | 当前审批只在业务主动提交时创建实例，不能拦截编辑/删除，也没有审批通过后的变更回放和删除执行                    | 审批实例缺 `executeTime/comment/updateFields`；缺资源快照/暂存模型及业务处理器映射                                                              | 先完成 W2.5 版本化结构，再逐模块接入更新/删除触发               | `DISCOVERED` |
| DB-011 | 高级审批任务、记录与附件         | `ApprovalAddSignTask`、`ApprovalReturnBackRecord`、`ApprovalRecord`、`ApprovalInstanceAttachment`、任务 `type/action/nodeRound` | 当前任务只支持普通通过/驳回，缺加签、退回、撤回记录、抄送任务类型、节点轮次与附件                              | 缺加签关系、退回记录、独立审批记录和实例附件表；`ApprovalTask` 缺 `nodeRound/type/action`                                                       | 完成高级审批动作与审批中心页面源码对齐后实施                    | `DISCOVERED` |
| DB-012 | 高级审批节点配置                 | `ApprovalNodeApprover`、`ApprovalNodeCondition` 及流程设计器配置                                                                | 缺自动通过/拒绝、连续上级/部门负责人、空审批人兜底、同提交人策略、抄送、条件分支、后置动作、字段权限和 Webhook | 审批节点缺 approver/cc 方向与列表、fallback、sameSubmitter、条件 JSON、通过/驳回配置、字段权限；缺 Webhook 配置/执行审计                        | W2.5 完成基础图结构后分阶段接入设计器与运行时                   | `DISCOVERED` |

## W2.4 关闭条件

W2.4 完成时允许 DB-001、DB-002、DB-003 保持 `DISCOVERED`，但对应三个事件不得标记为已接入；DB-004、DB-005 必须在实现说明中明确当前回退语义。其余本阶段新发现的数据库差异必须在提交前追加到本台账。
