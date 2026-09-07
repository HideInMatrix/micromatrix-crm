# DB-007 公告能力对齐任务

当前状态：**VERIFIED**。

- [x] T1 Cordys 源码审计与正式范围收敛
  - [x] Controller / Service / Domain / Mapper。
  - [x] PC 公告列表、编辑弹窗、API/type。
  - [x] 确认接收范围、Notification 转换、定时发布和编辑/删除语义。
  - [x] 确认 Cordys 当前公告不含附件，撤销发现阶段附件假设。

- [x] T2 数据模型与通知 source 边界
  - [x] 新增 Announcement Prisma 模型并合并进唯一 baseline。
  - [x] Notification 增加 sourceType/sourceId。
  - [x] NotificationsService 增加 source-aware 派发/清理及 cache/SSE 失效。

- [x] T3 Announcement API/runtime
  - [x] CRUD、租户隔离、关键字分页。
  - [x] 部门递归 + 成员接收范围解析和快照。
  - [x] 当前有效公告即时通知。
  - [x] 5 分钟 Cron + DistributedCoordinator 多实例去重。
  - [x] 编辑/删除重建与清理。

- [x] T4 PC 公告管理
  - [x] 消息通知 / 公告 Header Top Menu。
  - [x] 公告列表、搜索、分页。
  - [x] 新建/编辑 Drawer、接收范围和预览。
  - [x] Notification 页面识别公告类型与外部链接。

- [x] T5 专项与工程验收
  - [x] Prisma validate/generate + single baseline fresh DB。
  - [x] Announcement service/runtime tests。
  - [x] root rules/smoke、typecheck、lint、build。
  - [x] Browser 真实 API/Web 验收。
  - [x] Prettier、`git diff --check`。

- [x] T6 文档封板
  - [x] 更新 deferred backlog / parity / project-progress / alignment-log / docs index。
  - [x] 全绿后标记 `DB-007 VERIFIED`。

最终验收（2026-09-07）：Announcement Service **5/5 PASS**；Notification source **7/7 PASS**；API Rules **234/234 PASS**；root typecheck/build PASS；lint **0 error / 8 个既有 warning**；fresh PostgreSQL 成功应用唯一 `20260905084900_baseline` 并 Seed；Browser **38/38 PASS**，覆盖真实登录、公告创建/编辑/删除、成员接收范围、立即生效通知、公告类型/正文/链接名称/已读/source 清理，API 5xx=0、Runtime exception=0；Prettier 与 `git diff --check` PASS。
