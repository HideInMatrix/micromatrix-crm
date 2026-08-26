# W3.4.0 公共底座最终专项验收记录

> 验收日期：2026-08-26
>
> 对应任务：1.9
>
> 结论：W3.4.0 公共底座验收通过；后续进入 W3.4.1 首页。DB-016、DB-017、DB-018、DB-020 仍按各自页面/API 闭环保持 `IN_PROGRESS`，DB-019 保持 `VERIFIED`。

## 1. 本轮验收收口的问题

任务 1.9 没有只做静态检查，而是以现有关键链路回归继续反查 W3.4.0 直接模型迁移遗漏，最终补齐以下边界：

- `/resource-pools/options`：恢复仅供现有页面读取的兼容 facade，底层继续读取 `CluePool/CustomerPool` 直接模型；没有恢复旧 `resource_pools` 表、旧通用 CRUD 或双写。
- Pool Options VO：将 `scopeId/ownerId/enable/auto/hiddenFields` 和 Pick/Recycle Rule 映射为现有 Web 所需的稳定契约，同时继续执行启用状态和 Scope/管理员范围过滤。
- 负责人历史：`ClueOwner/CustomerOwner` 的 BigInt 时间不再直接返回，统一映射为 `OwnerHistoryVO`，补负责人、部门、操作人和 ISO 时间，避免 Nest JSON 序列化 500。
- 直接字段别名：补齐 `contact -> contactName`、`owner -> ownerId` 等 API 边界别名，覆盖 Lead 批改/导入和 Contact 导出，不把兼容字段写回直接模型。
- 关联客户候选：按 Cordys 语义合并普通数据范围、客户协作和可访问公海；`READ_ONLY` 协作客户可见但 `selectable=false`。
- 动态字段关键词：`contains` 改为子串查询语义，不再对电话/邮箱关键词执行完整录入格式校验；精确写入和其它操作符仍保持严格校验。
- 图外交易链直接 Customer 引用：Opportunity、Quote、Contract 访问 W3.4 Customer 时统一改用 `organizationId`；Opportunity 联系人检查同步改用 CustomerContact 的 `organizationId`。
- 回归夹具：根 Smoke 删除旧通用资源池/库容写接口依赖，改用直接模型池夹具；旧 SavedView 用例迁移到 Cordys UserView API；W3.2/W3.3 Smoke 补齐 `targetDepartmentId` 并按目标部门下的真实层级递归验证同步结果。

## 2. 自动化验收结果

### 2.1 Prisma、类型、规则与构建

- Prisma `validate`：通过。
- Prisma `generate`：通过，Prisma Client 7.9.1。
- API `test:rules`：`97/97` 通过。
- Shared、API、Web typecheck：通过。
- 全仓 ESLint：通过。
- Shared、API、Web production build：通过。

仓库声明 pnpm `10.30.3`，当前主机默认 pnpm 为 11.x；本轮全部验收命令显式使用 `corepack pnpm@10.30.3`。根 `typecheck` 脚本内部再次解析系统 pnpm，因此以三个 workspace 独立 typecheck 作为等价验收，不修改仓库的 packageManager 声明。

### 2.2 W3.4 数据库专项

- `smoke:w34-fields`：12 项断言通过。
- `smoke:w34-user-views`：12 项断言通过。
- `smoke:w34-pools`：9 项断言通过。
- `smoke:w34-seed`：通过；32 张目标表存在、14 张旧表不存在、23 个关键索引存在，直接关系和 Seed 样例断言全部为 true。
- `smoke:w34-pools:isolated`：使用 PostgreSQL 18 CLI 在隔离数据库从零应用全部 30 个 migration 后通过 9 项 Repository Smoke，并删除临时数据库。

专项验收前清理了三轮此前中断 Smoke 遗留、且名称明确以 `R2导入线索池-` / `R2导入客户公海-` 开头的测试池及各 3 条池内测试数据；未删除 Seed 池或其它业务数据。清理后 Seed 增强审计恢复通过。

### 2.3 关键链路回归

- 根 `pnpm smoke`：`219/219` 通过，0 失败。
- W3.2 企业微信组织同步：`23/23` 通过。
- W3.3 企业微信统一登录与消息通道：`19/19` 通过。

根 Smoke 已覆盖本轮实际暴露的问题：Pool Options、负责人历史、UserView、Lead/Customer/Pool 批改、xlsx 导入导出、联系人导出、关联客户候选、Customer 删除引用保护以及 Opportunity → Quote → Contract → Order 等交易链。

## 3. 兼容边界

`GET /api/resource-pools/options?module=lead|customer` 是 W3.4.0 唯一恢复的旧路径兼容面，目的仅是让现有 `/leads/pool`、客户公海页面在 W3.4.2/W3.4.3 页面重做前仍能获取“当前用户可访问的启用池”。它满足以下约束：

- 不访问已删除的通用资源池表；
- 不提供旧 `/resource-pools` create/update/delete/list CRUD；
- 不提供旧 `/resource-capacities` 或 `/pool-rules` 写接口；
- 管理员只看到启用池，普通成员还必须命中 Scope 或管理员范围；
- W3.4.2/W3.4.3 建立 Cordys 分域配置 Controller/Page 后再移除该兼容 facade。

因此本轮不会把“兼容读取”误记为旧通用资源池模型复活。

## 4. 状态结论

- DB-016：直接 Clue/CluePool 数据模型、Repository、调用方、Seed 和公共回归已验证；Cordys 线索/池页面仍待 W3.4.2，保持 `IN_PROGRESS`。
- DB-017：直接 Customer/CustomerContact/CustomerPool 数据模型、调用方、Seed 和交易链引用已验证；Cordys 客户/公海页面仍待 W3.4.3，保持 `IN_PROGRESS`。
- DB-018：Dashboard 三张直接表和 Seed 已验证；目录/资源页面仍待 W3.4.4，保持 `IN_PROGRESS`。
- DB-019：UserView 直接模型、五类 API、业务筛选、规则与真实库 Smoke 均已验证，保持 `VERIFIED`。
- DB-020：ModuleForm/Field 与 Clue/Customer/Contact 分域字段值、批改、筛选、导入导出均已验证；各业务页面表单闭环仍待后续，保持 `IN_PROGRESS`。
- DB-021：图外业务模块的独立动态字段值表仍未建立，继续 `DISCOVERED`，不纳入 W3.4.0 扩张范围。

W3.4.0 到此关闭；下一执行单元是 W3.4.1 首页源码/API/页面对齐。
