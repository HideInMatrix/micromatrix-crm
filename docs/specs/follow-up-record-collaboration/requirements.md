# FOLLOW-001 跟进记录协同闭环需求

状态：`VERIFIED`

## 1. 目标

FORM-001 已完成公共 Form Engine 后，下一执行单元按既定收口顺序进入“协同闭环”。本单元先关闭 Cordys 跟进记录（FollowUpRecord）的完整资源能力，再进入跟进计划评论等后续协同能力。

FOLLOW-001 立项时 MicroMatrix `follow-ups` 仍是早期简化实现，仅提供按目标查询、新建记录与通用附件上传。当前已经完成公共 ModuleForm / Field-Blob、统一 page/detail/create/update/delete、UserView/AdvancedFilter/sort、评论/@成员/通知/日志、ATTACHMENT/PICTURE 资源生命周期和 PC 共享 runtime，并完成最终 Service/Browser/baseline/root gates，规格状态封板为 `VERIFIED`。

## 2. Cordys 事实基线

- 跟进记录是独立 ModuleForm，统一接口前缀为 `/follow/record`，并提供 `/module/form / page / get / add / update / delete`。
- 主记录包含客户、商机、线索、内容、跟进时间、跟进方式、负责人、联系人和 `commentCount`；其它可配置字段进入 `follow_up_record_field / follow_up_record_field_blob`。
- 详情通过 ModuleForm 解析自定义字段，并返回附件字段对应的 `attachmentMap`；附件不是额外定义一套跟进记录文件模型。
- 跟进记录 UserView 使用独立 `FOLLOW_RECORD` resource type，支持新增、编辑、删除、详情、固定、启停和拖拽排序。
- 评论为两层结构：顶层评论分页，当前页顶层评论的回复一次装配；`commentCount` 统计一级评论和回复总数。
- 新增评论支持 `parentId / replyToUserId / mentionedUserIds`；编辑只更新正文和 @成员。
- 评论只有创建人可以编辑/删除；删除一级评论时同时删除它的二级回复及 @关系。
- 评论新增/编辑/删除进入跟进记录操作日志；新增/回复/@成员进入现有消息通知体系。
- 评论列表回传创建人、头像、被回复人、可编辑状态、回复数量和 @成员信息。

详细证据见 [source-audit.md](./source-audit.md)。

## 3. R1 FollowUpRecord 元数据与数据模型

- shall 新增 `followRecord` ModuleForm，并纳入公共 Metadata / ModuleFormsService。
- shall 为 FollowUpRecord 建立独立 Field / Blob 存储，动态字段保存、读取、唯一性、筛选与删除继续复用 `ResourceFieldValueService`。
- shall 保留现有主记录业务语义，同时补齐稳定的跟进时间、联系人、更新时间、评论数等资源字段；项目未正式发布，不为旧开发数据保留双写真相源。
- shall 在 Lead -> Customer 转换、Customer merge/delete、FollowUpPlan -> Record 转换等跨模块链路中保持记录和 Field/Blob 一致性。
- attachment/picture 字段 shall 走公共 Metadata attachment 生命周期；项目未正式发布，旧 `targetType=follow-up` 通用附件路径已从 FollowRecord 调用链删除，不保留迁移期兼容 facade 或双写真相源。

## 4. R2 CRUD、筛选、视图与权限

- shall 提供统一列表/分页、详情、创建、编辑、删除接口，而不是只有当前 targetId 下的 100 条时间线读取。
- shall 支持 lead / customer / opportunity 目标；MicroMatrix 既有其它扩展目标如仍被真实页面使用，可作为产品扩展保留，但不得混淆 Cordys parity 结论。
- shall 复用目标业务对象既有 DataScope / Customer collaboration / Pool 权限；无权访问目标对象时不可通过 FollowUpRecord 反查数据。
- shall 接入 AdvancedFilter / SavedView，SavedView 复用现有 `sys_user_view`，使用独立 `FOLLOW_RECORD` 命名空间。
- shall 支持系统字段与动态 Field/Blob 的筛选/排序边界；不为公式、附件等无稳定比较语义的字段伪造筛选。

## 5. R3 评论、回复与 @成员

- shall 提供评论分页、新增、编辑、删除 API。
- 顶层评论分页；二级回复归属顶层 `parentId`，回复二级评论时仍挂到原顶层，并通过 `replyToUserId` 标记被回复人。
- 内容后端上限 3000 字；Web 编辑器按 Cordys 当前交互限制 300 字。
- `mentionedUserIds` 最多 100 个，服务端 shall 去重并验证为当前租户有效成员。
- 评论编辑/删除仅创建人可操作；删除顶层评论同时删除直接回复和 mention 关系。
- `FollowUpRecord.commentCount` shall 在新增/删除后重新按资源真实计数，不采用客户端增减作为真相源。

## 6. R4 通知与日志

- 新增普通评论 shall 通知资源负责人；@成员与回复 shall 通知对应成员，并排除无效/重复收件人及当前操作者。
- 通知 shall 复用现有 `NotificationsService / MessageSettings`，并映射线索、客户、商机三类跟进记录评论事件。
- 评论新增/编辑/删除 shall 进入 FollowUpRecord 操作日志，日志 detail 保留评论变更摘要，不另建第二套审计表。

## 7. R5 PC 运行时

- 现有 `FollowUpDrawer.vue` shall 从“备注时间线 + 临时附件”升级为公共 FollowUpRecord 组件，而不是继续扩张单文件。
- 新建/编辑 shall 使用 `followRecord` ModuleForm + DynamicForm；附件字段复用公共 AttachmentFieldInput 生命周期。
- 列表/详情 shall 展示 commentCount，并接入可折叠评论面板；评论面板拆为独立组件/composable。
- 评论支持新增、回复、编辑、删除、@成员和分页加载。
- 客户 360、商机详情、线索相关入口复用同一 FollowUpRecord runtime，不复制评论实现。

## 8. R6 验收

- shall 增加 FollowUpRecord Service Smoke、Comment Service Smoke 与 Browser Smoke。
- shall 回归 FollowUpPlan 转记录、Lead -> Customer 复制、Customer merge/delete、客户 360 和商机详情。
- shall 通过 pre-release baseline reset + seed、Prisma validate/diff、API Rules、root typecheck/build/lint、当前变更集 Prettier 与 `git diff --check`。

## 9. 非目标

- 本单元不同时实现 FollowUpPlan 评论；跟进记录封板后进入下一协同执行单元。
- 不实现任意层级评论树；保持 Cordys 两层评论模型。
- 不新增独立评论附件模型；评论本身当前 Cordys 契约也没有附件字段。
- 不在本单元实现全局搜索、字段脱敏或新的第三方 provider。
