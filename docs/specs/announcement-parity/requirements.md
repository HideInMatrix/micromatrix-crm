# DB-007 公告能力对齐需求

状态：`VERIFIED`

## 1. 范围

本执行单元以项目内 `CordysCRM/` 当前源码为第一事实来源，对齐“系统 / 消息设置 / 公告”完整业务闭环，并复用 MicroMatrix CRM 已有 Notification、SSE、Redis 多实例实时通知和 Cron 分布式协调能力。

源码审计确认 Cordys 公告当前不包含附件上传能力；DB-007 早期台账中“附件关系模型”属于发现阶段的待核实假设，本轮正式立项后予以撤销，不新增公告附件模型。

## 2. 用户故事与验收标准

### R1 公告管理

- 管理员 shall 能按当前租户分页查询公告，并按标题关键字搜索。
- 管理员 shall 能新建、编辑、查看、删除公告。
- 公告 shall 保存标题、正文、可选链接、可选链接名称、生效开始时间、生效结束时间、创建/更新审计字段。
- 公告 shall 只允许当前租户访问和修改；跨租户 ID 必须 fail-closed。
- 生效结束时间 shall 晚于开始时间，且保存时结束时间不得早于当前时间。

### R2 接收范围

- 公告接收范围 shall 支持指定部门和指定成员，与 Cordys `deptIds + userIds` 契约一致。
- 选择部门 shall 包含其全部子部门成员。
- 保存时 shall 将最终接收用户 ID 集合冻结为公告快照；后续组织变更不得悄然改变已保存公告的历史接收范围。
- 部门和成员 ID shall 必须属于当前租户；至少选择一个可解析到有效成员的接收范围。
- 列表/详情 shall 返回原始选择的部门/成员名称，供编辑回显和接收范围展示。

### R3 公告转通知

- 当前已进入生效区间的公告 shall 立即按接收用户生成现有 `Notification` 记录。
- 未来生效公告 shall 由周期任务转换为 Notification；多实例部署不得重复派发。
- 公告通知 shall 使用独立 `announcement` 业务类型，并保留公告 source ID，使编辑/删除时可以精确清理旧通知。
- 公告通知的已读/未读 shall 完全复用现有 `notifications.readAt`，不得新增第二套公告已读表。
- 公告生成通知 shall 复用现有 Redis cache version、Pub/Sub 和 SSE 链路，使在线接收人可实时刷新。

### R4 编辑与删除语义

- 编辑公告 shall 清理该公告已生成的旧 Notification；若编辑后的公告当前有效，应按新内容和新接收范围重新生成未读通知。
- 若编辑后的公告尚未开始，应保持未转换状态，等待定时发布。
- 删除公告 shall 同时删除该公告生成的 Notification，不影响其它通知。
- 删除/重建通知后 shall 主动失效相关用户通知缓存并触发实时状态刷新。

### R5 PC 页面

- `/system/messages` shall 提供“消息通知 / 公告”两级页面导航；不得恢复跨路由用途的 Element Plus Tabs。
- 公告页 shall 提供新建、搜索、分页、编辑、删除，并展示标题、正文、发布时间、接收范围、创建/更新时间及人员。
- 新建/编辑 shall 提供标题、链接、链接名称、正文、发布时间段和“部门 + 指定成员”接收范围。
- 页面布局 shall 遵循当前 UI-001 约定，普通布局优先使用 UnoCSS/Tailwind utility，不新增无必要 scoped CSS。

### R6 权限、日志与验证

- 公告读取 shall 复用 `system:message`；新建/编辑/删除 shall 复用当前消息域写权限 `system:message:update`，不额外制造平行权限树。
- 公告写操作 shall 进入现有操作日志拦截链路。
- DB-007 shall 通过 Prisma validate/generate、API 专项测试、root rules/smoke、typecheck、lint、production build、Browser 验收、Prettier 与 `git diff --check`。
- pre-release 数据库策略 shall 继续维持唯一 `20260905084900_baseline`，不得新增第二条业务 migration 历史。

## 3. 非目标

- 不实现公告附件；Cordys 当前公告表单没有附件入口。
- 不实现 DB-008 消息模板/i18n 重构。
- 不实现钉钉/飞书 provider 或 DataEase。
- 不新增公告独立已读表或独立实时消息系统。
