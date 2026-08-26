# W3.4.0 直接模型与破坏性迁移审计

> 审计日期：2026-08-25
>
> 对应任务：1.2、1.3
>
> 结论：Prisma 直接模型和破坏性迁移已建立并通过空库复放；业务调用方尚未迁移，必须继续执行 1.4～1.8，当前不能把 W3.4.0 标记为完成。

## 1. 实施范围

- Prisma 已一次性新增审计确认的 32 张 Cordys 直接表：模块表单/字段 4 张、用户视图 2 张、线索域 9 张、客户域 14 张、仪表板 3 张。
- 已删除旧 `Lead/LeadStatus`、`Contact`、`CustomerTeamMember`、`FieldDefinition`、`SavedView/Condition`、通用 ResourcePool/Pick/Recycle/Capacity/OwnerHistory 和旧 `PoolRule` 模型。
- 目标表只使用 `organizationId` 组织字段；数据库列通过 `@map` 使用 Cordys snake_case 命名，不保留 `tenantId`、`customData`、旧表别名或双写真相。
- `Opportunity.contact` 已切换为 `CustomerContact`；旧 `Tenant/User` 到 Customer/Contact 的兼容 relation 已删除。

## 2. 迁移内容

迁移文件：`apps/api/prisma/migrations/20260825180000_w34_cordys_direct_models/migration.sql`。

- 显式删除 14 张旧表，并删除 `LeadStatus` enum。
- 创建 32 张目标表及其外键、查询索引和防并发重复所需的唯一约束。
- 不包含数据回填、兼容视图、旧字段别名、双写触发器或历史数据保留分支。
- 已从生成 SQL 中剔除与 W3.4 无关的既有数据库漂移：`approval_flows.enabled` 默认值和两条组织同步索引名称变化不属于本次迁移。

## 3. 关键字段核验

| 表.字段                           | 迁移后实际结构                        | 结果 |
| --------------------------------- | ------------------------------------- | ---- |
| `dashboard.resource_url`          | `VARCHAR(500) NOT NULL`               | 通过 |
| `dashboard_module.parent_id`      | `VARCHAR(32) NOT NULL DEFAULT 'NONE'` | 通过 |
| `customer_contact.customer_id`    | `VARCHAR(32) NULL`                    | 通过 |
| `clue.phone`                      | `VARCHAR(255) NULL`                   | 通过 |
| `sys_module_form.form_key`        | `VARCHAR(50) NOT NULL`                | 通过 |
| `sys_module_field_blob.prop`      | `TEXT NULL`                           | 通过 |
| `clue_pool_hidden_field.field_id` | `VARCHAR(255) NOT NULL`               | 通过 |

Cordys 的审计时间、业务时间和排序使用 `BIGINT`；Scope、Condition、Filter、Prop、Value、ChildrenValue 按源码契约使用文本列，不擅自改为 PostgreSQL array/JSONB 真相。

## 4. 自动验证证据

1. `prisma format`、`prisma validate`、`prisma generate` 全部通过，生成 Prisma Client 7.9.1。
2. 新建隔离临时数据库 `w34_schema_audit`，从零执行项目全部 30 个 migration，全部成功。
3. 迁移后查询确认目标表数量为 32，旧表数量为 0；第 3 节关键字段的类型、长度、可空性和默认值均符合冻结规格。
4. Prisma 全库 diff 只报告三项本次明确不处理的既有漂移：`approval_flows.enabled` 默认值、两条组织同步索引名称；32 张 W3.4 目标表没有结构差异。
5. 临时数据库仅用于迁移审计，验证后删除；主开发库未应用本次破坏性迁移。

## 5. 预期编译断点

直接 Schema 替换后，API 类型检查最初出现 411 个错误、分布在 16 个已审计调用文件中。这是任务 1.4～1.8 尚未执行的预期中间状态，不能通过兼容模型或 `as any` 掩盖。任务 1.4 公共底座完成后，Metadata 的 14 个错误已经消除，当前断点为 397 个/15 个文件：

| 调用区域           | 文件数/主要文件                                                                 | 后续任务      |
| ------------------ | ------------------------------------------------------------------------------- | ------------- |
| 客户、线索、联系人 | `customers.service.ts`、`leads.service.ts`、`contacts.service.ts`               | 1.4、1.6、1.7 |
| 池、回收、规则     | `resource-pools.service.ts`、`pool-recycle.service.ts`、`pool-rules.service.ts` | 1.6、1.7      |
| 元数据、用户视图   | `metadata.service.ts`、`saved-views.service.ts`                                 | 1.4、1.5      |
| 下游业务           | follow-up、members、opportunities、bidding、dashboard                           | 1.7           |
| 数据初始化         | `prisma/seed.ts`                                                                | 1.8           |

完整错误分布与调用方范围和 `model-impact-audit.md` 一致，说明破坏点已被任务 1.1 覆盖，没有发现审计外的生产调用区域。

## 6. 阶段结论

- 任务 1.2：完成。32 张直接 Prisma 模型已建立，旧模型已从 Schema 删除。
- 任务 1.3：完成。破坏性迁移已生成、人工审计并通过空库完整迁移复放。
- 本文记录的是任务 1.2～1.3 完成时的阶段快照：当时 W3.4.0 仍为 `IN_PROGRESS`，API 类型检查失败和主开发库未应用迁移均属于明确中间断点。后续 1.4～1.9 已完成并关闭 W3.4.0，最终结果见 [foundation-validation-audit.md](./foundation-validation-audit.md)。
