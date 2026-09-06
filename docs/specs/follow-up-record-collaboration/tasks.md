# FOLLOW-001 跟进记录协同闭环任务

状态：`VERIFIED`

- [x] A. Cordys 源码与 MicroMatrix legacy 审计。
  - [x] A1 FollowUpRecord Controller/Service/Domain/Mapper/DDL。
  - [x] A2 FollowUpRecord ModuleForm / Field-Blob / attachmentMap。
  - [x] A3 FollowUpRecord UserView / AdvancedFilter / sort。
  - [x] A4 Comment / reply / mention / commentCount / notification / log。
  - [x] A5 PC `crm-follow-detail + crm-comment` runtime。
  - 证据：[source-audit.md](./source-audit.md)。

- [x] B. FollowUpRecord 正式资源基座。
  - [x] B1 Prisma：FollowUpRecord 审计字段、commentCount、Field / FieldBlob；删除旧 `nextFollowAt` / `contract` target 语义，`type` 按 Cordys 最终模型改为 nullable。
  - [x] B2 `followRecord` ModuleForm + 系统字段 seed，并初始化四类真实 formLink 场景。
  - [x] B3 ResourceFieldValueService 接入 `followRecord` validate/save/load/filter/delete；ModuleForm 字段值计数/删除同步覆盖 FollowPlan 与 FollowRecord Field/Blob。
  - [x] B4 FollowUps API 升级 module/form、target list/detail/create/update/delete；调用方直接迁移到正式 FollowRecord runtime，不保留旧模型兼容 facade；旧 generic `follow-up` 附件路径已全仓清零，附件只走 ATTACHMENT 动态字段。
  - [x] B5 FollowUpPlan -> Record 使用正式 `PLAN_TO_RECORD` formLink 预填 + 原子提交并删除旧一键 convert API；Lead -> Customer 复制 Record + Field/Blob 且新记录显式 `commentCount=0`、不迁移评论；Customer merge 时同步重绑 FollowRecord target/contact，删除由 FK cascade 清理 Field/Blob。
  - 验收：最终 Schema `prisma validate` PASS；空库 `migrate reset --force` + seed PASS；DB -> Schema diff `No difference detected.`；数据库实查 6 条 partial unique index 全部存在；API/Web typecheck PASS；FollowUps 新原子转换测试已纳入 API Rules glob。

- [x] C. FollowRecord Filter / View。
  - [x] C1 统一 `POST /follow-ups/page`，AdvancedFilter 同时覆盖系统字段与动态 Field/Blob；系统/动态条件可真实混合 AND/OR，SavedView 与临时筛选结果再取交集；PC + Mobile 已全部迁移，旧 `GET /follow-ups` facade 删除。
  - [x] C2 `FOLLOW_RECORD` UserView namespace 与 CRUD/fixed/enable/sort；服务端 `/follow/record/view/*` 与 frontend-shared `follow_record` 路由均接入公共 UserView 基座。
  - [x] C3 全局列表按目标业务对象 DataScope 裁决：线索=直接范围+可访问线索池，客户=直接范围+协作+可访问客户公海，商机=直接范围；View/Filter/keyword 只能继续收缩权限；池中资源缺少 poolId 时 fail-closed。
  - 验收：shared build、frontend-shared/API/Web/Mobile typecheck PASS；API Rules 205/205 PASS（含混合 AND/OR、FOLLOW_RECORD SavedView、全局 DataScope 与 poolId fail-closed 专项用例）；旧 `followUpPlanApi.convert` / `listFollowUps` 源码引用均为 0。移动端计划转记录已同步迁移到正式 `PLAN_TO_RECORD` 预填 + FollowRecord 原子提交 Sheet。

- [x] D. 评论 / 回复 / @成员。
  - [x] D1 Comment + Mention Prisma 最终模型：Comment self relation、Mention unique/cascade、FollowRecord commentCount；直接进入 pre-release baseline，不做兼容迁移。
  - [x] D2 `/follow/record/comment/page|add|update` + DELETE runtime：顶层分页、直接 replies 批量装配、只允许两层、创建人编辑/删除、Comment/Mention/commentCount 同事务。
  - [x] D3 mention/reply 用户严格按当前租户 ACTIVE 校验，mention 上限 100；列表批量装配成员 name/avatar/enabled，无 N+1。
  - [x] D4 按 Cordys 增加 CLUE/CUSTOMER/OPPORTUNITY 六个 FollowRecord comment added/mentioned 事件；负责人和 mention/reply 分事件发送并排除操作者；OperationLog 使用非枚举结果元数据把 FollowRecord ID、comment ID 与正文 before/after 写入现有 Blob，不新增日志表。
  - 验收：`prisma format/validate` PASS；空库 baseline reset + seed PASS；DB -> Schema diff `No difference detected.`；shared/frontend-shared/API typecheck PASS；API Rules 210/210 PASS，其中 5 条 FollowComment 专项规则覆盖原子写入、两层边界、跨租户 mention、创建人边界、分页/replies/mention 回显。

- [x] E. PC 协同 runtime。
  - [x] E1 FollowRecord 领域组件/composable，收口现有 `FollowUpDrawer.vue`；形成 `FollowRecordPanel / FollowRecordFormDrawer / FollowRecordTimeline / useFollowRecords`，旧 Drawer 只保留上下文编排。
  - [x] E2 DynamicForm 创建/编辑、详情与 attachment 字段；编辑契约使用显式 `null` 清空联系人/跟进方式/跟进时间，不再把 `undefined` 错当清空。
  - [x] E3 Comment Panel：count、分页、新增、回复、编辑、删除、@成员；拆出 `FollowCommentItem / FollowCommentEditor / useFollowComments`，Web 评论正文按 Cordys 交互限制 300 字。
  - [x] E4 客户 360、商机详情、线索入口复用统一 `FollowRecordPanel` runtime；`FollowUpDrawer.vue` 同样复用该领域组件。
  - [x] E5 ResourceField attachment cleanup Cron 增加“必须经过 `DistributedCoordinator`”专项 Rule；专项测试断言固定 coordination key/`MINUTE` slot，并确认 wrapper 只调用 cleanup core。`resource-field-attachment-lifecycle.test.ts` 5/5 PASS。
  - [x] E6 FOLLOW-001 E Browser Smoke：`scripts/follow001-browser-smoke.mjs` 真实覆盖 FollowRecord 新建、编辑、删除、评论、回复、@成员、commentCount、动态 ATTACHMENT、动态 PICTURE、已绑定附件域保护下载；最终 **46/46 PASS**，Browser API 5xx=0、Runtime exception=0。
  - [x] E7 Service/API/Browser 联合回归 + pre-release baseline 最终复验。
    - 最终证据：API Rules **217/217 PASS**；Customer **23/23**、Lead **20/20**、Opportunity **18/18**、FollowPlan PC/Mobile **25/25**；旧 Smoke 仅校准到当前 `PcTopMenu`、`CrmDisplayModeSwitch` 与独立 Mobile `5174/mobile` + mobile UA，不修改业务 UI 迎合测试。pre-release 单 baseline `migrate reset --force` PASS，显式 seed PASS，`prisma validate` PASS，DB -> Schema diff `No difference detected.`，六条 partial unique index 全部实查存在；fresh DB 下 FollowRecord/Comment Service Smoke **25/25 PASS**、E Browser Smoke **46/46 PASS**。
  - [x] E8 已回写 `tasks / design / project-progress / source-audit`：固化共享 FollowRecord/Comment runtime、显式 null 更新语义、ATTACHMENT/PICTURE Field/Blob + domain-guarded download、cleanup coordinator，以及“无独立全局 FollowRecord View”审计结论；文档只记录已实现事实，不以兼容层或虚构入口补齐叙述。
  - [x] E9 独立全局 FollowRecord 列表入口审计完成：Cordys 有统一 `/follow/record/page` API 与 `FOLLOW_RECORD` UserView，但 Web `pathMap.ts` 的 `FOLLOW_UP_RECORD` 仍指向商机路由并保留 TODO，未发现可迁移的独立 FollowRecord list View；MicroMatrix 规格 R2/R5 也只要求统一 page/DataScope/UserView + 对象内共享 runtime，因此本单元不虚构 `/follow-records` 页面，结论已写入 `source-audit.md / design.md`。
  - E 阶段关闭证据：frontend-shared/API/Web typecheck PASS；`FollowRecordSection` 源码引用清零；E5～E9 全部具备真实 Rule/Service/Browser/baseline/源码审计证据，不保留兼容层或虚构入口。

- [x] F. 最终验收与封板。
  - [x] F1 FollowRecord foundation/filter/view Service Smoke。
    - `scripts/follow001-service-smoke.mjs` 使用真实 Nest ApplicationContext + PostgreSQL 完成 FollowRecord create/detail/update/delete、Field/Blob、显式 null 清空、AdvancedFilter、动态 number 排序、Blob/textarea 排序拒绝、FOLLOW_RECORD UserView、全局 DataScope/keyword 与级联删除验收；同时发现并修复 `ResourceFieldValueService.assertResource()` 漏分派 `followRecord`、错误落入 FollowPlan 查询的真实资源一致性缺口。
  - [x] F2 Comment/mention/notification Service Smoke。
    - 同一 Smoke 覆盖顶层评论、二级回复、三级拒绝、跨租户/无效 mention 拒绝、创建人编辑边界、分页/replies/commentCount、mention 替换、真实负责人通知、真实 @成员通知、排除操作者与顶层删除 cascade/recount；最终 **25/25 PASS**。
  - [x] F3 PC Browser Smoke + 相邻 Customer/Lead/Opportunity/FollowPlan 回归：最终阶段版 FollowRecord **46/46**、Customer **23/23**、Lead **20/20**、Opportunity **18/18**、FollowPlan PC/Mobile **25/25**，全部 exit 0。
  - [x] F4 pre-release baseline reset + seed + validate/diff：单一 `20260905084900_baseline` 从空库重建 PASS；显式 seed PASS；`prisma validate` PASS；DB -> Schema `No difference detected.`；六条 partial unique index 实查数量 **6**。
  - [x] F5 API Rules + root typecheck/build/lint + 当前变更集 Prettier + `git diff --check`：Rules **217/217**；root typecheck/build PASS；lint **0 error / 8 个既有 warning**；tracked + untracked 当前变更集 Prettier check PASS；`prisma format` 与 `git diff --check` PASS。
  - [x] F6 parity/project-progress/alignment-log/spec index 文档封板：`requirements/tasks` 状态改为 `VERIFIED`，`cordys-parity.md` 跟进记录改为 ✅，`project-progress.md` 移除已关闭差异并把执行指针推进到下一协同缺口，`alignment-log.md` 与 `docs/specs/README.md` 写入最终证据。
