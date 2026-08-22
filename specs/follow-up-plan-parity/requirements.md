# 跟进计划对齐需求

## 范围

本阶段以项目内 `CordysCRM/` 当前 `main` 源码为第一事实来源，迁移跟进计划的创建、查询、编辑、状态流转、删除、转跟进记录和到期提醒，并补齐 PC、移动端、顶部 `event` 入口与客户 360 场景。跟进评论不在本阶段范围内。

## 用户故事与验收标准

### R1 源码事实与字段语义

- 当实现跟进计划时，系统 shall 核对 Cordys Web、Mobile、API、Controller、Service、Domain、Mapper、migration、提醒 Listener 和转跟进记录交互。
- 系统 shall 支持线索、客户和商机三类目标；商机计划 shall 保留其所属客户和联系人上下文。
- 计划 shall 至少包含目标、内容、负责人、计划时间、跟进方式、状态和是否已转记录。
- 状态 shall 使用 `PREPARED / UNDERWAY / COMPLETED / CANCELLED`，新建默认为 `PREPARED`，新建时未转记录。

### R2 CRUD、筛选与权限

- 用户 shall 能按状态、关键字、目标类型、目标 ID 和“我的计划”筛选，并按计划时间、创建时间倒序分页。
- 用户 shall 能在拥有对应资源读取权限时查看计划；客户只读协作人 shall 可读，协作人 shall 可写。
- 创建计划 shall 校验对应线索、客户或商机的写权限，并校验联系人属于相关客户。
- 编辑、删除、状态流转和转记录 shall 仅允许计划负责人或管理员执行。
- 已完成且已转记录的计划 shall 不允许再次修改状态、取消或重复转换。
- 所有查询和写入 shall 按租户隔离，并进入现有操作日志链路。

### R3 转跟进记录

- 当负责人把已完成且未转换的计划转为跟进记录时，系统 shall 在一个数据库事务中创建跟进记录并标记计划已转换。
- 重复请求 shall 不得创建第二条跟进记录。
- 创建的记录 shall 继承目标、跟进方式、内容、负责人，并刷新目标最近跟进时间。
- MicroMatrix 的事务式转换属于对 Cordys“先建记录、再回写 converted”两次请求的可靠性加固，shall 在设计文档中保留差异说明。

### R4 到期提醒

- 系统 shall 每天扫描当天到期且未结束的计划，并通知负责人。
- 同一计划同一天 shall 至多通知一次；修改计划时间后 shall 允许新日期再次提醒。
- 提醒 shall 覆盖负责人创建和他人代建两种计划，不复制 Cordys 当前查询中 `owner = create_user` 的限制。
- 通知 shall 复用现有通知中心和实时推送能力，并能跳转到跟进计划页面。

### R5 PC、移动端与业务入口

- PC 页面 shall 提供状态筛选、关键字搜索、分页、创建、编辑、删除、状态切换、详情和转记录。
- 移动端 shall 提供适配触屏的计划列表、筛选和核心操作，不直接复用不可操作的 PC 表格。
- 顶部 `event` shall 在能力完成后进入真实跟进计划页面，不再标记为待迁移。
- 客户 360 shall 增加跟进计划 Tab，并限定目标为当前客户。
- 所有新增图标 shall 使用 `lucide-vue-next`。

### R6 回归与文档

- 本阶段 shall 通过 Prisma generate、typecheck、lint、build、规则测试和全链路 smoke。
- 本阶段 shall 同步更新执行计划、parity、alignment log、数据模型、API、文档索引和根 README。

## 非目标

- 不迁移 Cordys 跟进评论与评论计数。
- 不迁移 Cordys 动态表单设计器；预留 `customData` 供后续扩展。
- 不在本阶段实现全局搜索、国际化或 Agent。
- 不照搬 Cordys 中可能导致代建计划不提醒的 `owner = create_user` 查询条件。
