# 实施任务

- [x] 1. 读取 Cordys 跟进计划全链路源码
  - 核对 Web、Mobile、API、Controller、Service、Domain、Mapper、migration、提醒和转记录。
  - 记录状态、字段、权限、提醒查询和非原子转换事实。
  - _Requirements: R1_

- [x] 2. 建立需求与设计基线
  - 明确范围、数据模型、API、权限、转换、提醒、PC/移动端和非目标。
  - _Requirements: R1-R6_

- [x] 3. 实现数据模型与后端闭环
  - 新增 Prisma 模型/迁移、shared 契约、DTO、Controller、Service 和模块注册。
  - 实现 CRUD、目标校验、数据范围、状态锁和操作日志。
  - _Requirements: R1, R2_

- [x] 4. 实现转换与到期提醒
  - 原子创建跟进记录，保证转换幂等并刷新最近跟进时间。
  - 定时通知负责人，按计划和日期去重。
  - _Requirements: R3, R4_

- [x] 5. 实现 PC 与移动端
  - 新增全局页面、移动端页面、顶部 `event` 入口和客户 360 Tab。
  - 所有新增图标使用 `lucide-vue-next`。
  - _Requirements: R5_

- [x] 6. 自动化与全链路验收
  - 运行 Prisma generate、typecheck、lint、build、规则测试和 smoke。
  - 浏览器验证 PC、移动端、顶部入口与客户 360。
  - _Requirements: R2-R6_

- [x] 7. 更新项目文档
  - 更新执行计划、parity、alignment log、数据模型、API、文档索引和 README。
  - _Requirements: R6_

## DB-021 FollowUpPlan Field/Blob closure

- [x] 8.1 Cordys 源码 + MicroMatrix legacy 审计。
  - 证据：[DB-021 Field/Blob 源码审计](./db021-field-blob-audit.md)。
  - 计划：[DB-021 Field/Blob 实施计划](./db021-field-blob-plan.md)。
- [x] 8.2 数据模型与 Metadata 基座：followPlan ModuleKey/Form、Field/Blob、forward migration、ResourceFieldValueService。
  - 第 57 个 migration `20260830164500_db021_follow_up_plan_fields` 已部署成功。
  - Prisma format/validate/generate、API typecheck、Seed 均 exit 0。
  - 当前库已验证 FollowPlan 两张 Field/Blob 表、followPlan ModuleForm 和 8 个系统字段存在。
  - 证据：[DB-021 8.2 基座验收](./db021-foundation-acceptance.md)。
- [x] 8.3 后端 runtime：CRUD/list/detail/filter/delete/复制链全部退出 FollowUpPlan customData。
  - FollowUpPlan DTO/shared VO/web API payload 已统一改为 `moduleFields`；create/update 与 Field/Blob 同事务，list/detail 从分表回填。
  - 高级筛选已拆分系统字段 Prisma 条件与动态 Field/Blob 条件；删除由 FK cascade 清理字段值。
  - Lead -> Customer 显式复制 Field/Blob；Customer merge 保持 planId，仅转挂 targetId，字段值天然保留并经真实库验证。
  - FollowUpPlan production runtime `customData` 扫描为 0；API typecheck exit 0，既有 FollowPlan 单测 3/3、ResourceFieldValue 单测 9/9、真实库 Smoke 12 项均通过。
  - 证据：[DB-021 8.3 Runtime 验收](./db021-runtime-acceptance.md)。
- [x] 8.4 PC/Mobile FollowUpPlan 动态字段真实表单往返；不新增 Cordys 不存在的 `/system/modules` 专属按钮。
  - 新增 `GET /follow-up-plans/module/form`，PC / Mobile 共用 `followPlan` ModuleForm。
  - PC 使用 `DynamicForm + useFieldRefs`，Mobile 复用 `MobileDynamicForm`；编辑按 `moduleFields` 回填，保存提交 Field/Blob payload。
  - MobileDynamicForm 补齐 member / dept / multiselect / checkbox / datetime 五类字段。
  - `apps/web/src/views/system` 扫描 `followPlan` = 0，不新增 FollowPlan 专属模块设置入口。
  - API/Web typecheck exit 0；runtime Smoke 12/12；PC/Mobile Browser Smoke 25/25，API 5xx=0、Runtime exception=0。
  - 证据：[DB-021 8.4 PC / Mobile 动态字段验收](./db021-ui-acceptance.md)。
- [x] 8.5 专项 Smoke + Browser + 空库双 Seed + Rules/typecheck/lint/build/root smoke；runtime legacy scan=0 后 DB-021 -> VERIFIED 并本地提交。
  - DB-021 runtime Smoke **12/12 / exit 0**；PC/Mobile Browser Smoke **25/25 / exit 0**，API 5xx=0、Runtime exception=0。
  - 隔离空库从零 **57/57 migrations**，Seed #1/#2 均成功且基线计数稳定；`sys_module_form=8`、`sys_module_field=68`、`sys_module_field_blob=68`。
  - Rules **119/119**；workspace `pnpm typecheck`、`pnpm lint`、`pnpm build` 全部 exit 0；Root Smoke **227/227**。
  - 最终 runtime scan：FollowUpPlan production `customData=0`、`plan.customData=0`；`/system/modules` FollowPlan 专属入口 `followPlan=0`。
  - 空库 Smoke 陈旧 `migrations56` 结构化字段已改为动态 `migrationCount`，最终输出为 57。
  - Deferred backlog：DB-021 更新为 `VERIFIED`。
  - 证据：[DB-021 8.5 最终封板验收](./db021-final-acceptance.md)。
