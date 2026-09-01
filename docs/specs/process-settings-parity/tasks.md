# W2.5 实施任务

- [x] 1. 完成 Cordys 流程设置全链路源码核对
  - 读取流程列表、新增/编辑/详情、基础信息、更多设置、流程设计器、前端 API/模型。
  - 读取 `ApprovalFlowController/Service`、流程/版本/节点/实例/任务 Domain、Mapper 与 1.7.0/1.7.2 迁移。
  - 确认独立“工作流”页面只是 Cordys 当前源码占位，不纳入实现。
  - _Requirements: R1-R8_

- [x] 2. 固化需求、技术设计与暂缓边界
  - 确认 W2.5 只交付流程设置管理底座和现有新建/提交审批兼容。
  - 确认发票可禁用配置但不可启用，回款记录退出新流程配置，更新/删除触发和高级节点后置。
  - 将版本图结构、变更暂存、高级任务和高级节点缺口登记为 DB-009～DB-012。
  - _Requirements: R1-R8_

- [x] 3. 升级审批流 Prisma 模型并编写兼容迁移
  - 扩展流程主表的编号、表单类型、当前版本、执行时机、更多设置、软删除和创建/更新审计字段。
  - 新增编号计数器、流程版本、审批节点扩展和节点连接模型；审批实例增加流程、版本和执行时机引用。
  - 建立租户内编号唯一、未删除表单类型唯一、版本序号唯一和必要索引/外键。
  - 把现有报价/合同/订单线性流程迁移为版本 1 图结构，保留实例 `nodesSnapshot`；停用并软删除回款记录配置。
  - 迁移旧 `approval:flowManage` 角色关系到新的四类流程设置权限，并保证迁移可重复检测。
  - _Requirements: R1, R2, R4, R5, R6_

- [x] 4. 重构共享审批契约和权限目录
  - 新增配置侧 `ApprovalFormType`、执行时机、节点类型、重复审批人规则、列表项、详情和写入契约。
  - 保留历史实例使用的 `ApprovalModule`，集中定义 `quotation -> quote` 等运行时映射。
  - 新增 `system:process / add / update / delete`，更新 canonical 权限树、默认角色、菜单和路由权限。
  - 在兼容期识别旧权限码，但新页面和新接口只使用新权限。
  - _Requirements: R1, R3, R5, R6_

- [x] 5. 实现流程配置 Service 与 REST API
  - 新增分页、关键字/类型/状态筛选、白名单排序和详情查询。
  - 实现事务式新增：校验租户引用、生成编号、创建主记录、版本 1、起止节点、审批节点和连接。
  - 实现更新：锁定表单类型，基础字段直接更新，仅节点定义变化时创建新版本并切换当前版本。
  - 实现独立启停；阻止发票、无节点或不支持执行时机的流程启用。
  - 实现仅禁用流程可软删除，并终止关联审批中实例、跳过待办、恢复业务审批状态。
  - 捕获并发唯一冲突，统一返回可理解的 `409/422/404`。
  - _Requirements: R1-R6_

- [x] 6. 让现有审批运行时读取当前流程版本
  - 提交时通过表单类型映射读取当前租户已启用、未删除流程和当前版本的 `CREATE` 审批节点。
  - 新实例写入 `flowId/flowVersionId/executeTiming`，继续冻结 `nodesSnapshot` 并以快照推进。
  - 验证流程配置更新不影响审批中的旧实例。
  - 保持报价、合同、订单的提交、会签/或签、通过、驳回、撤销和消息通知行为。
  - 拒绝新的回款记录审批提交，但保持历史实例详情可读。
  - _Requirements: R3, R4, R5_

- [x] 7. 实现 Cordys 信息架构对应的流程列表页
  - 将 `/system/approval-flows` 从模块单页表单改为真实分页列表。
  - 实现新建按钮、关键字、表单类型、启用状态、刷新、排序和分页。
  - 展示流程编号、类型、名称、状态、执行时机、创建/更新时间与人员信息。
  - 接入名称查看/快捷改名、启停确认、启用流程删除说明和按权限显示操作。
  - 发票流程明确显示“业务链路待接入”，不允许启用。
  - _Requirements: R1, R2, R6, R7_

- [x] 8. 实现新建、编辑和详情流程抽屉
  - 抽屉按“基础信息 / 流程设计 / 更多设置”组织，并支持新建、编辑、只读三种模式。
  - 基础信息实现类型锁定、名称/描述校验和执行时机状态说明。
  - 安装 `@vue-flow/core`、`@vue-flow/background` 和 `@vue-flow/controls`，实现受控画布与精确 TypeScript 适配器。
  - 实现开始/审批/结束自定义节点、节点增删、拖动排序、自动线性连线、缩放、适配视口和只读模式。
  - 审批节点支持四类审批人、成员/角色选择及会签/或签；前端只提交共享业务契约，不提交 Vue Flow 内部状态。
  - 保留金额门槛作为明确标注的阶段性简化入口条件。
  - 更多设置仅开放已有真实运行时能力；其余字段禁用并显示后续阶段说明。
  - 实现规范化脏状态比较和未保存离开确认。
  - _Requirements: R2-R4, R7_

- [x] 9. 完成服务规则、权限和迁移测试
  - 新增 4 条流程规则测试，覆盖表单类型映射、节点规范化、临时 ID 忽略、审批对象稳定排序和节点定义变化判断；全仓规则与公共底座单测为 `27/27`。
  - 通过隔离租户 Smoke 覆盖无权限拒绝、发票停用配置、启用拦截、版本 1、节点变化创建版本 2、线性连接和软删除。
  - 通过迁移回填和既有合同审批链路验证旧实例快照、任务及运行时兼容；重复执行 migrate deploy 无待应用迁移。
  - Vue Flow 业务契约转换、纵向拖动排序和线性边重建通过精确 TypeScript 类型检查、Web 构建和浏览器交互验收。
  - _Requirements: R1-R6, R8_

- [x] 10. 扩展全链路 Smoke
  - Smoke 在每次运行时注册隔离租户，真实创建、查看、更新版本、尝试启用和软删除发票流程，不清理演示租户既有配置。
  - 验证 V1 创建、节点变化升 V2、完整线性连接和发票不可启用；演示租户合同两级审批与结果消息继续通过。
  - 验证无流程设置权限请求被拒绝，并保持原有报价/合同/订单审批链路回归覆盖。
  - _Requirements: R1-R8_

- [x] 11. 完成浏览器往返验收
  - 浏览器确认真实列表包含编号、类型、执行时机、版本、运行时状态、创建/更新信息、排序入口、刷新和权限化操作。
  - 验证新建抽屉基础信息、步骤导航、Vue Flow 开始/结束节点、节点新增和右侧审批配置面板；画布按需挂载后无初始化告警。
  - Smoke 负责保存持久化、V1/V2 切换、发票禁用和真实合同审批；浏览器最终控制台无新增 error/warn。
  - _Requirements: R2-R8_

- [x] 12. 完成全量验证、文档同步和本地提交
  - 运行 Prisma validate/generate/迁移、shared/API/Web typecheck、ESLint、API/Web build、规则测试和全链路 Smoke。
  - 更新 API、数据模型、Wave 2 计划、parity、菜单对齐、alignment log、规格索引和测试计数。
  - 仅在主表、版本、基础节点图、迁移、API、页面和测试全部完成后把 DB-009 标记为 `VERIFIED`。
  - 保留 DB-003、DB-010、DB-011、DB-012 的未完成状态和前置条件，并创建 W2.5 本地 Git 提交。
  - _Requirements: R8_

## W3.7 高级审批深化

- [x] W3.7-9.1 完成 DB-010～DB-012 重新审计与执行计划冻结。
  - 已重新读取 Cordys `ApprovalResourceService / ApprovalActionService / ApprovalFlowService` 以及 ResourceSnapshot、Instance、Task、AddSign、ReturnBack、Record、Attachment、NodeApprover、NodeCondition Domain。
  - 已确认 W3.6 后 DB-010 旧描述过时：Quote / Contract / Invoice / Order 已具备真实 UPDATE rollback 与 DELETE 延迟执行，但仍缺通用 `ApprovalResourceSnapshot + Handler` 和实例 `updateFields/comment`。
  - 已确认 DB-011 的 BEFORE/AFTER 加签、节点退回、审批人任务撤回、独立记录/附件仍为真实运行时缺口。
  - 已确认 DB-012 的 Condition/DEFAULT、fallback/sameSubmitter、fieldPermissions、pass/reject post action、Webhook 和 duplicate rule 仍未接运行时；当前高级开关仍由 Service 422 + Web disabled 保护。
  - 已固化 [W3.7.0 高级审批源码与运行时差异审计](./w370-advanced-approval-audit.md) 与 [W3.7 高级审批深化执行计划](./w370-advanced-approval-plan.md)，并扩展 requirements/design。
  - _Requirements: R9-R12_

- [x] W3.7-9.2 DB-010：通用资源快照与实例变更上下文。
  - [x] 9.2A 固化 Prisma / migration / handler 设计，并建立通用 `ApprovalResourceSnapshot` 与 `ApprovalInstance.updateFields/comment`。
    - Migration 58 建立通用快照表与实例上下文，并只搬运仍在途的旧 UPDATE 快照；`default` 与隔离库均实际执行通过。
  - [x] 9.2B 为 quotation / contract / invoice / order 注册同一 Resource Handler 边界，迁移 capture/restore/status/delete 职责。
    - `ApprovalsService` 对四业务 direct Prisma 引用已归零；Resource boundary 对 target/status/delete/restore 全部 tenant fail-closed。
  - [x] 9.2C 删除 `ApprovalsService` 四套业务 snapshot 硬编码和长期双写，按最终生命周期清理旧 `businessSnapshot`。
    - Migration 59 已删除 `approval_instances.business_snapshot`；production `businessSnapshot` 扫描为 0，通用 `approval_resource_snapshots` 成为唯一活动快照真相源。
  - [x] 9.2D Rules + 四业务 UPDATE reject/cancel + DELETE + tenant isolation 专项 Smoke；migration/空库回归后关闭 DB-010。
    - `smoke:w370-db010-regression`：59 migrations + generic lifecycle / tenant isolation / Quote / Invoice / Order 全绿；W3.6.3 Contract 独立 HTTP Smoke 在 59 migrations 下全绿。
    - Rules **119/119**、Root Smoke **227/227**、空库 **59/59 + 双 Seed**、API typecheck、workspace lint/build、`git diff --check` 全绿。
    - 证据：[W3.7-9.2 DB-010 通用审批资源快照专项验收](./w370-db010-acceptance.md)。
  - _Requirements: R9, R12_

- [x] W3.7-9.3 DB-011：高级任务、动作、记录与附件。
  - 源码证据：[DB-011 高级审批任务与动作源码审计](./w370-db011-action-runtime-audit.md)。
  - 实施计划：[DB-011 高级审批任务与动作实施计划](./w370-db011-action-runtime-plan.md)。
  - [x] 9.3A 扩展 task nodeRound/type/action，并建立独立 ApprovalRecord。
    - Migration 60 已部署到 `default`；历史 task comment 迁移为 ApprovalRecord 后删除旧列，历史 nodeId 保持 nullable，新实例冻结真实 nodeId。
    - 四业务审批在 60 migrations 下回归全绿；空库 **60/60 + 双 Seed**、Rules **121/121**、Root Smoke **227/227**、workspace typecheck/lint/build、Prisma validate、`git diff --check` 全绿。
    - 证据：[W3.7-9.3A DB-011 Task / ApprovalRecord 基座专项验收](./w370-db011-task-record-acceptance.md)。
  - [x] 9.3B BEFORE/AFTER 加签与嵌套加签链。
    - 源码证据：[9.3B BEFORE / AFTER 加签源码审计](./w370-db011-add-sign-audit.md)。
    - Migration 61 已部署到 `default`；新增 `ApprovalAddSignTask`，使用 `rootTaskId + sort` 保持嵌套加签链顺序，并将 SIGN 纳入待办/已办/详情。
    - 隔离 HTTP Smoke 在 **61/61 migrations + Seed + API build** 下覆盖 BEFORE/AFTER、二级嵌套、owner/tenant gate、重复/挂起 gate、ALL sibling 等边界；Browser Smoke **17/17**。
    - 四业务审批在 61 migrations 下回归全绿；空库 **61/61 + 双 Seed**、Rules **121/121**、Root Smoke **227/227**、workspace typecheck/lint/build、Prisma validate、`git diff --check`、`system/modules` Browser **47/47** 全绿。
    - 证据：[W3.7-9.3B DB-011 BEFORE / AFTER 加签专项验收](./w370-db011-add-sign-acceptance.md)。
  - [x] 9.3C 节点退回 + return-back record + round 重建。
    - 源码证据：[9.3C 节点退回源码审计](./w370-db011-return-back-audit.md)。Migration 62 已部署到 `default`，新增 `ApprovalReturnBackRecord`，同一实例/目标只保留最新退回记录，task/ApprovalRecord 历史轮次保持不可变。
    - BACK 只允许当前普通 PENDING task owner 退回到冻结流程中真实执行过的历史节点；原任务写 `action=BACK` 且不生成 ApprovalRecord，目标节点按 `max(task/record round)+1` 重建，普通 advance 同步支持后续节点新 round。
    - 隔离 HTTP Smoke 在 **62/62 migrations + Seed + API build** 下覆盖合法/非法目标、owner/tenant/repeat gate、round 1→2→3、latest ReturnBackRecord 与最终 APPROVED；PC Browser **17/17**，9.3B Browser 回归 **17/17**。
    - Rules **123/123**、DB-010 regression 全绿、Root Smoke **227/227**、空库 **62/62 + 双 Seed**、workspace typecheck/lint/build、Prisma validate 全绿。
    - 证据：[W3.7-9.3C DB-011 节点退回专项验收](./w370-db011-return-back-acceptance.md)。
  - [x] 9.3D 审批人任务撤回；与 submitter cancel 分离，并处理 ANY/ALL/后续节点约束。
    - 不新增 migration：Cordys 的 `REVOKE` 只用于操作日志，撤回后的 task 恢复 `PENDING + action=null + handledAt=null`，原 task/node/round 继续复用；下游活动待办置 `SKIPPED`，再次推进用新 round 重建。
    - `allowWithdraw` 已解除 422 配置门禁，并由 runtime 再次硬校验 tenant、owner、实例状态、task 类型/状态/action、冻结 nodeId 与下游可逆状态；submitter cancel 仍保持独立动作。
    - 撤回本身不新增/删除 ApprovalRecord；同 task/node/round 再审批按 Cordys `saveApprovalRecord()` 语义处理：无新意见再次同意保留原 record，有新意见或动作改变时 delete+create，避免重复 record。
    - 隔离 HTTP Smoke 在 **62/62 migrations + Seed + API build** 下覆盖 owner/flow gate、同 task 回开、下游失效、record 保留/替换、round 2 重建、旧 task/已结束实例 fail-closed；PC/Mobile Browser **24/24**，API 5xx=0、Runtime exception=0。
    - Rules **125/125**、9.3B/9.3C HTTP + Browser regression（各 **17/17**）、DB-010 regression、Root Smoke **227/227**、`system/modules` Browser **47/47**、workspace typecheck/lint/build、Prisma validate 全绿。
    - 证据：[W3.7-9.3D DB-011 审批人任务撤回专项验收](./w370-db011-approver-revoke-acceptance.md)。
  - [x] 9.3E requireComment、附件及对应 API/UI；专项 Rules/API/Browser 后关闭 DB-011。
    - Migration 63 新增 `ApprovalInstanceAttachment`，按 `instanceId + elementId + attachmentId` 保存动作级关系；复用现有 `Attachment`，历史绑定通过 FK `RESTRICT` + 删除服务 gate 保持不可破坏。
    - `requireComment` 已解除 422 门禁并进入 approve/reject 服务端硬校验：开启时两动作空意见均拒绝，关闭时两动作均允许空意见；`allowBatchProcess` 与高级 duplicate rule 继续 fail-closed。
    - approve/reject 附件绑定 `ApprovalRecord.id`，BACK 绑定 `ApprovalReturnBackRecord.id`，SIGN 绑定 `ApprovalAddSignTask.id`；AFTER SIGN 同一附件同时绑定原审批 record 与 add-sign element，撤回重审带新意见/附件时同步替换 record/relation。
    - 9.3E isolated HTTP Smoke 在 **63/63 migrations + Seed + Shared/API build** 下覆盖 requireComment 双态、tenant/uploader/未挂载/归档 gate、approve/SIGN/BACK element 绑定、撤回重审附件替换、详情 VO 与最终 APPROVED；PC/Mobile Browser **28/28**，真实调用 `/attachments/upload`，API 5xx=0、Runtime exception=0。
    - DB-011 最终回归：9.3A migration smoke PASS；9.3B/9.3C/9.3D HTTP 在 63 migrations 下 PASS；Browser **17/17、17/17、24/24**；DB-010 regression PASS；Rules **127/127**、Root Smoke **227/227**、`system/modules` Browser **47/47**、空库 **63/63 + 双 Seed**、workspace typecheck/lint/build、Prisma validate 全绿。
    - 证据：[W3.7-9.3E DB-011 requireComment / ApprovalInstanceAttachment 专项验收](./w370-db011-attachment-comment-acceptance.md)。DB-011 正式关闭，下一执行指针进入 9.4A。
  - _Requirements: R10, R12_

- [ ] W3.7-9.4 DB-012：高级节点、条件、字段权限与后置动作。
  - [ ] 9.4A Condition / DEFAULT 图结构、条件 DTO 与 `updateFields` runtime。
  - [ ] 9.4B empty approver / fallback / sameSubmitter / 动态审批方向与 duplicate rule。
  - [ ] 9.4C 节点字段权限和审批详情真实约束。
  - [ ] 9.4D pass/reject 后置字段更新。
  - [ ] 9.4E Webhook 安全 client、测试连接、运行时发送与审计。
  - [ ] 9.4F Vue Flow 条件图、更多设置开放与专项 Browser；完成后关闭 DB-012。
  - _Requirements: R11, R12_

- [ ] W3.7-9.5 最终验收与文档封板。
  - DB-010/011/012 专项 Smoke、Root Smoke、Rules、流程设置/审批中心 Browser、空库全 migration + 双 Seed、workspace typecheck/lint/build 全绿。
  - runtime legacy/deferred scan、`git diff --check`、parity/alignment/backlog 同步；仅在真实证据齐全后标记对应项 `VERIFIED`。
  - scoped 本地提交；不 push，除非用户明确要求。
  - _Requirements: R12_
