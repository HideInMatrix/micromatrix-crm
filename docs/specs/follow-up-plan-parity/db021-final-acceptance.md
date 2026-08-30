# DB-021 FollowUpPlan Field/Blob 最终封板验收

日期：2026-08-30

## 1. 结论

DB-021 已完成最终封板。

W3.6 已完成 Opportunity / Product / Price / Quotation / Contract / Payment Plan / Payment Record / Invoice / Order 的独立 Field/Blob；本执行单元又把最后剩余的 FollowUpPlan 从运行时 `customData` JSON 迁移到：

- `follow_up_plan_field`
- `follow_up_plan_field_blob`

FollowUpPlan 的 ModuleForm/Metadata、后端 CRUD/list/detail/filter/delete、Lead -> Customer 复制链、Customer merge、PC/Mobile 动态字段表单均已使用分域字段值。

`follow_up_plans.customData` 物理列暂时保留为旧升级数据兼容保留位，但当前 production runtime **不读取、不写入**该列；不能在无法证明历史 key -> ModuleField 映射时通过 DROP COLUMN 静默丢弃升级数据。该兼容列不再是真相源，也不阻塞 DB-021 的独立 Field/Blob 结论。

DB-021 状态已由 `IN_PROGRESS` 更新为 `VERIFIED`。

## 2. 8.1～8.4 阶段证据

### 2.1 源码审计

- Cordys FollowUpPlan 使用独立 `FollowUpPlanField / FollowUpPlanFieldBlob`。
- CRUD 生命周期、动态筛选、Lead 转换复制均读取/写入该分域字段值。
- Cordys `/system/modules` 不存在 FollowPlan 专属配置按钮，因此 MicroMatrix 未自行新增不存在的入口。

证据：`db021-field-blob-audit.md`。

### 2.2 数据模型与 Metadata 基座

- migration：`20260830164500_db021_follow_up_plan_fields`。
- 新增 `FollowUpPlanField / FollowUpPlanFieldBlob` Prisma model。
- shared `ModuleKey` 增加 `followPlan`。
- Seed / ModuleForms 自动 ensure `followPlan` form + 8 个系统字段。
- `ResourceFieldValueService` 注册 FollowPlan，并兼容 FollowUpPlan 主表租户列 `"tenantId"`。
- 修正 FollowPlan normal/blob delegate，禁止误落 Order Field/Blob。

证据：`db021-foundation-acceptance.md`。

### 2.3 后端 runtime

- DTO/shared VO/Web payload 统一为 `moduleFields`。
- create/update 与 Field/Blob 同事务。
- list/detail 从分域表回填 `moduleFields`。
- 高级筛选使用 FollowPlan Field/Blob。
- Lead -> Customer 显式复制 normal/blob 值并生成新 resourceId。
- Customer merge 只转挂 `targetId`，planId 不变，因此 Field/Blob 保持绑定；真实库 Smoke 已验证。
- 删除 FollowUpPlan 后 normal/blob FK cascade 清理。

证据：`db021-runtime-acceptance.md`。

### 2.4 PC / Mobile

- 新增 `GET /follow-up-plans/module/form`。
- PC 使用统一 `DynamicForm + useFieldRefs`。
- Mobile 复用 `MobileDynamicForm`。
- Mobile 动态字段补齐 `member / dept / multiselect / checkbox / datetime` 五类编辑能力。
- PC metadata 加载失败时禁止保存，避免空 `moduleFields` 覆盖已有动态值。
- `/system/modules` 不新增 Cordys 不存在的 FollowPlan 专属设置入口。

Browser Smoke 使用真实临时客户、临时 FollowPlan、临时自定义字段完成 PC/Mobile 回填、编辑、PATCH、API 读回，并在 finally 清理全部夹具。

结果：

```text
DB-021 FollowPlan Browser Smoke: 25 passed, 0 failed
API 5xx = 0
Runtime exception = 0
exit 0
```

证据：`db021-ui-acceptance.md`。

## 3. DB-021 runtime 专项 Smoke

命令：

```text
pnpm smoke:db021-follow-plan-runtime
```

最终结果：

```text
DB-021 FollowPlan runtime smoke: 12 assertions passed
exit 0
```

覆盖：

- normal/blob 正确分表。
- load / filter。
- `tenantId` 租户隔离。
- Customer merge 式 targetId 转挂不丢字段。
- 主计划删除后 Field/Blob cascade。

## 4. 空库 57 migrations + 双 Seed

命令：

```text
pnpm smoke:w366-empty-db
```

最终临时库：

```text
w366_empty_6dca857e8a
```

结构化结果：

```text
migrationCount=57
seed1=true
seed2=true
seedCountsStable=true
```

双 Seed 后基线：

```text
tenants=1
departments=4
roles=3
users=4
user_roles=4
sys_module_form=8
sys_module_field=68
sys_module_field_blob=68
opportunity_stage_config=0
contract_stage_config=7
sales_order_stage_config=7
```

同时验证：

- 三演示角色登录成功。
- 原 W3.6 七类 direct ModuleForm / runtime 回归继续通过。
- Opportunity / Contract / Order 三类 stage config 可用。

`opportunity_stage_config=0` 仍是既有设计：默认 Opportunity stage 在 runtime 首次访问时 lazy initialize，不是 Seed 漏项。

本轮同步清理空库 Smoke 的陈旧结构化字段名：原硬编码 `migrations56` 改为实时读取 migration 目录数量的 `migrationCount`，避免后续 migration 增长后证据再次失真。

## 5. Rules

命令：

```text
pnpm --filter @micromatrix/api test:rules
```

最终结果：

```text
tests 119
pass 119
fail 0
exit 0
```

其中包含 FollowPlan 防回归规则：

```text
FollowPlan 使用 tenantId 隔离并只写自己的 Field/Blob delegate
```

## 6. Workspace 静态检查与 production build

当前最终工作树结果：

```text
pnpm typecheck -> exit 0
pnpm lint      -> exit 0
pnpm build     -> exit 0
```

production build 实际完成：

- `@micromatrix/shared` TypeScript build。
- `@micromatrix/api` Prisma generate + production tsc。
- `@micromatrix/web` Vite production build。

空库 Smoke 字段名调整后又重新执行全仓 `pnpm lint`，最终仍 exit 0，因此 lint 证据对应当前最终代码。

## 7. Root Smoke

命令：

```text
pnpm smoke
```

最终结果：

```text
结果：227 通过, 0 失败
exit 0
```

既有 W2.2 FollowUpPlan CRUD / 状态 / 转记录 / 删除链同时继续通过，说明 DB-021 未破坏原 FollowUpPlan 主业务。

## 8. runtime legacy scan

最终 production runtime 精确扫描：

```text
apps/api/src/modules/follow-up-plans (exclude *.test.ts): customData = 0
apps/api/src: plan.customData = 0
apps/web/src/views/system: followPlan = 0
```

含义：

- FollowUpPlan API runtime 已不再使用 JSON 动态字段。
- Lead 转换复制链不再复制 `plan.customData`。
- `/system/modules` 没有新增 Cordys 不存在的 FollowPlan 专属入口。

测试夹具/历史审计文档中出现 `customData` 仅用于描述迁移前事实，不属于 production runtime legacy。

## 9. Deferred backlog 状态

DB-021 原始范围现已全部关闭：

- Opportunity：独立 Field/Blob。
- Product：独立 Field/Blob。
- Price：独立 Field/Blob。
- Quotation：独立 Field/Blob。
- Contract：独立 Field/Blob。
- Payment Plan：独立 Field/Blob。
- Payment Record：独立 Field/Blob。
- Invoice：独立 Field/Blob。
- Order：独立 Field/Blob。
- FollowUpPlan：独立 Field/Blob。

因此：

```text
DB-021 = VERIFIED
```

这只表示“图外业务模块分域动态字段值”这一台账项完成，不等于整个 `cordys-parity.md` 已全部 ✅。跟进评论/完整 FormDesign、公告、高级审批、全局搜索、字段脱敏、钉钉/飞书等仍按各自 parity/backlog 状态独立推进。

## 10. 封板结论

DB-021 的源码、数据库、runtime、复制/合并链、PC/Mobile UI、空库、Browser、Rules、typecheck、lint、build 和 Root Smoke 均已形成真实证据。

8.5 已关闭，DB-021 已标记 `VERIFIED`。
