# 流程设置管理底座对齐需求

## 范围

本阶段以项目内 `CordysCRM/` 当前源码为第一事实来源，对齐“系统 / 流程设置”中的审批流管理底座。W2.5 先建立可持续扩展的数据模型、列表管理、基础信息、版本快照、独立权限和审计闭环，并保留现有审批中心可运行能力。

Cordys 的独立“工作流”页面当前只有占位内容，不属于本阶段实现范围。图形条件分支、三种执行时机的完整业务拦截、高级审批动作、字段权限和 Webhook 等能力必须登记到暂缓台账，由后续阶段按源码继续实现，不得以静态占位或伪数据标记完成。

## Cordys 源码基线

- 管理页面：`frontend/packages/web/src/views/system/process/process/index.vue`
- 新建/编辑/详情：`frontend/packages/web/src/views/system/process/process/components/addProcessDrawer.vue`
- 基础信息：`frontend/packages/web/src/views/system/process/process/approval-flow/basicForm.vue`
- 更多设置：`frontend/packages/web/src/views/system/process/process/moreSetting.vue`
- 前端 API/模型：`frontend/packages/lib-shared/api/modules/system/process.ts`、`frontend/packages/lib-shared/models/system/process.ts`
- 后端入口：`backend/crm/src/main/java/cn/cordys/crm/approval/controller/ApprovalFlowController.java`
- 后端实现：`ApprovalFlowService`、`ApprovalFlow`、`ApprovalFlowVersion`、审批节点/连接/实例/任务相关 Domain 与 Mapper
- 数据库事实：`backend/crm/src/main/resources/migration/1.7.0/ddl/V1.7.0_2__ga_ddl.sql`、`1.7.2/ddl/V1.7.2_2__ga_ddl.sql`、`1.7.2/dml/V1.7.2_2_1__data.sql`

## 用户故事与验收标准

### R1 流程目录与租户边界

- 系统 shall 为当前租户分页展示审批流，至少包含序号、流程编号、表单类型、流程名称、启用状态、执行时机、创建人/时间、更新人/时间和操作列。
- 列表 shall 支持关键字搜索、表单类型筛选、启用状态筛选、排序与分页，并不得返回其他租户或已软删除的数据。
- 系统 shall 只允许当前租户为同一表单类型保留一条未删除流程；重复创建 shall 返回明确的冲突错误。
- 表单类型 shall 以 Cordys 的 `quotation / contract / invoice / order` 为目标目录；本阶段不得把 MicroMatrix 现有 `receivableRecord` 冒充为 Cordys 发票审批。
- 在 DB-003 未完成前，发票类型 shall 明确标记为“业务审批链路待接入”，不得宣称已能拦截或审批发票业务。

### R2 新建、查看、编辑与删除

- 具有新增权限的管理员 shall 能创建流程，填写表单类型、流程名称、执行时机、描述和本阶段已支持的审批节点配置。
- 新建时流程名称 shall 必填且不超过 255 个字符，描述 shall 不超过 1000 个字符，至少选择一个执行时机。
- 新建后系统 shall 生成租户内稳定、可读且唯一的流程编号；编号 shall 不因改名、停用或版本更新而变化。
- 创建后表单类型 shall 不可修改；编辑 shall 只更新当前租户中未删除的目标流程。
- 用户 shall 能以只读方式查看流程基础信息和当前版本配置。
- 仅禁用状态的流程 shall 允许删除；启用流程发起删除时 shall 被服务端拒绝并返回明确原因。
- 删除 shall 采用软删除，且 shall 清理或终止该流程仍处于审批中的实例与待办，历史已完成记录不得被物理删除。

### R3 启停与基础设置

- 具有更新权限的管理员 shall 能独立启用或停用流程；状态变化 shall 立即影响后续新提交的审批，既有实例继续使用提交时冻结的版本。
- 流程 shall 保存 `create / update / delete` 三种执行时机开关；每个开启的时机 shall 关联独立节点配置，不得错误复用其他时机的图。
- W2.5 shall 完整接通现有业务已经真实使用的“新建/提交”审批路径；尚未完成业务变更暂存与回放的 `update / delete` 执行 shall 明确标记为待接入，不得仅保存开关后伪装可运行。
- 流程 shall 保存 Cordys 更多设置字段的结构与默认值：提交人撤销、批量处理、撤回、加签、重复审批人规则、必填审批意见；尚未接入运行时的选项 shall 在界面禁用并说明状态。

### R4 版本与节点数据

- 每个流程 shall 指向一个当前版本；新建流程 shall 同时创建首个版本。
- 当节点配置发生变化时，系统 shall 创建新版本并切换 `currentVersionId`，不得覆盖旧版本节点。
- 审批实例 shall 绑定提交时的流程版本；后续流程编辑不得改变既有实例的审批路径。
- 节点 shall 至少保存编号、名称、类型、顺序、执行时机和版本关系；连接 shall 保存来源、目标和分支顺序。
- 现有线性节点能力 shall 迁移为版本化结构，并继续支持指定成员、角色、部门负责人、直属上级以及 `ALL / ANY` 多人审批。
- 旧 `nodesSnapshot` 数据 shall 保持可读；迁移后既有审批实例与任务 shall 不因配置表升级而失效。

### R5 API 与并发一致性

- 后端 shall 提供分页、详情、新增、更新、软删除和启停接口，并由共享契约统一前后端字段与枚举。
- 所有写接口 shall 校验租户、权限、表单类型、名称、执行时机、节点引用和审批人引用。
- 更新与删除 shall 使用事务保证流程主表、版本、节点、连接和审批中实例处理的一致性。
- 并发创建同一租户同一表单类型时，数据库约束或等价机制 shall 保证最多一条未删除流程成功。
- 页面 shall 只展示来自真实 API 的数据，不使用静态流程、伪造统计或本地假保存。

### R6 权限与操作日志

- 流程设置 shall 使用独立的读取、新增、更新和删除权限，不再只依赖单一 `approval:flowManage`。
- 菜单可见、页面按钮和后端接口 shall 使用同一权限语义；隐藏按钮不得替代后端鉴权。
- 新增、编辑、改名、启停和删除 shall 进入现有操作日志，至少记录租户、操作者、资源 ID/名称、动作、时间和关键字段变化。
- 只有读取权限的用户 shall 能查看列表与详情，但不得修改任何配置。

### R7 页面交互

- `/system/approval-flows` shall 从当前按模块直接编辑的单页表单改为 Cordys 信息架构对应的流程列表。
- 新增、编辑和详情 shall 使用同一抽屉承载“基础信息 / 流程设计 / 更多设置”三个区域，并根据模式切换可编辑状态。
- 页面 shall 在离开存在未保存修改的抽屉前提示用户确认。
- 流程名称 shall 支持进入编辑；状态 shall 支持表格内切换；启用流程的删除操作 shall 给出不可删除原因。
- W2.5 的流程设计区 shall 使用 Vue Flow 渲染真实可保存的线性审批图，至少包含开始、审批和结束节点以及节点间连线。
- Vue Flow shall 只负责画布交互和显示；系统 shall 把节点与连接转换为共享业务契约后提交，并由后端校验图结构，不得直接持久化插件内部状态。
- 图形条件设计器未完成前 shall 限制为线性图并明确显示阶段边界，不得开放无法执行的条件分支或任意连线制造已完成功能的印象。

### R8 验证与文档

- 本阶段 shall 覆盖租户隔离、唯一约束、软删除、启停、版本切换、旧实例冻结、权限拒绝和关键校验的自动化测试。
- 本阶段 shall 通过 Prisma 校验/生成、迁移、shared/API/Web typecheck、lint、build、规则测试、全链路 smoke 与真实浏览器往返。
- 本阶段 shall 更新 Wave 2 计划、parity、alignment log、数据模型、API、规格索引和暂缓能力台账。
- 所有本阶段发现但未实施的 Cordys 能力或数据库字段 shall 在提交前登记到 `docs/cordys-deferred-backlog.md`，不得只写在提交说明或聊天记录中。

## 非目标与后续阶段

- 不实现 Cordys 当前同样为空壳的独立“工作流”页面。
- 不在 W2.5 完成条件分支图、默认分支、自动通过/拒绝、连续上级/部门负责人、审批人为空兜底、审批人与提交人相同策略和抄送。
- 不在 W2.5 完成加签、退回、撤回、批量审批、重复审批人高级规则的完整运行时。
- 不在 W2.5 完成状态权限矩阵、节点字段可见/可编辑权限、通过/驳回后的字段更新或 Webhook。
- 不在 DB-003 完成前宣称发票审批可运行；不保留 `receivableRecord` 作为 Cordys 流程设置中的第五种表单类型。
- 不在业务对象具备变更暂存、审批后回放与删除恢复机制前启用 `update / delete` 审批触发。

上述非目标对应的数据模型和运行时缺口必须保留在暂缓台账，后续只有完成源码、迁移、API、页面、权限和测试闭环后才能标记为已对齐。

## W3.7 高级审批深化扩展需求

W3.7 继续使用本规格作为审批流程唯一需求真相源，不新建第二套审批规格。源码审计见 [W3.7.0 高级审批源码与运行时差异审计](./w370-advanced-approval-audit.md)。

### R9 通用资源快照与变更上下文

- 系统 shall 把当前 Quote / Contract / Invoice / Order 的 UPDATE 业务快照恢复能力收口到统一审批资源边界，新增审批业务不得继续向 `ApprovalsService` 增加业务专用 capture/restore switch。
- UPDATE 提审 shall 保存编辑前资源快照；驳回或提交人撤销 shall 恢复快照并清理已消费快照；重复提审不得留下多份互相竞争的活动快照。
- DELETE 审批 shall 继续保持“审批通过后执行实际删除”，不得改为先删除后恢复。
- `ApprovalInstance` shall 保存本次业务修改字段集合，并为实例级提交说明保留独立 comment 上下文；任务审批意见不得被实例 comment 覆盖。
- 通用快照和实例上下文 shall 强制租户隔离，跨租户资源 ID 即使可猜中也不得读取、覆盖或恢复。
- 旧 `businessSnapshot` 和业务硬编码 shall 只有在四类交易业务等价回归通过、无第二真相源后才能删除。

### R10 高级审批任务与动作

- 系统 shall 区分“提交人撤销整个审批实例”和“审批人撤回自己已经执行的审批任务”，两者使用不同权限与状态约束。
- 流程启用 `allowAddSign` 后，合法当前审批人 shall 能执行 BEFORE / AFTER 加签；加签链 shall 保持稳定顺序并支持在加签任务上再次加签。
- 审批人 shall 能把审批中实例退回到服务端允许的历史节点；系统 shall 保存退回节点、原因、操作者与原任务关系，并重新生成目标节点有效待办。
- 高级动作 shall 保存独立审批记录，至少保留实例、任务、节点轮次、节点、动作结果、意见和时间；不得只通过覆盖当前 task 状态表达完整历史。
- 当流程要求审批意见时，approve/reject/return-back/add-sign 等对应动作 shall 在服务端强制校验，不得只靠前端必填。
- 高级动作 shall 校验当前任务 owner、实例/节点状态和租户边界，并对重复提交或并发操作 fail closed。

### R11 高级节点、条件和后置动作

- 流程设计 shall 支持真实 Condition / DEFAULT 分支，服务端 shall 校验节点与连接属于同一流程版本和执行时机，并保证不存在后端无法执行的悬空图。
- 条件运行时 shall 能读取业务字段值以及 R9 的 `updateFields`，并支持 Cordys 源码实际使用的 AND / OR 与“字段是否相对原值发生修改”等条件。
- 审批人节点 shall 支持空审批人策略、fallback、审批人与提交人相同时的策略，以及源码确认的动态审批方向；这些能力未完成前对应 UI 必须保持不可执行。
- `duplicateApproverRule` shall 由真实运行时执行，而不是仅保存字段。
- 节点 shall 能配置字段权限，并在审批详情/处理界面真实约束字段可见和可编辑行为。
- 通过/驳回后置动作 shall 能按配置更新业务字段；运行时应记录可审计结果。
- Webhook shall 支持源码确认的配置和测试连接，但实现必须额外具备 SSRF、内网目标、超时、响应大小、敏感 Header/Body 日志脱敏等安全边界，不机械复制任意 URL 请求。
- 高级节点配置只有在运行时、API 与 Browser 验收全部通过后才允许从流程设置中的 disabled 状态开放。

### R12 W3.7 验收与关闭

- DB-010、DB-011、DB-012 shall 按依赖顺序关闭，不得以一个总开关同时标记完成。
- 每个子阶段 shall 完成 Prisma/migration、Rules、专项 API Smoke 和受影响业务回归；涉及页面的阶段还 shall 完成 Browser Smoke。
- W3.7 最终 shall 通过隔离空库全部 migrations + 双 Seed、Root Smoke、workspace typecheck/lint/build、runtime legacy/deferred scan 和 `git diff --check`。
- deferred backlog、parity、alignment log 和本规格 tasks shall 与最终真实结果同步；没有真实验收证据的能力不得标记 `VERIFIED`。
