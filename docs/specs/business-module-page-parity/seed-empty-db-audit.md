# W3.4.0 Seed 与空库启动验收记录

日期：2026-08-26
任务：1.8 重写 Seed 并执行空库迁移验收

## 1. 结论

对用户实现进行复核后，原 Seed 的基础表单、视图、池、业务样例和仪表板骨架可以运行，但未完整覆盖任务 1.1 审计锁定的 Cordys 直接模型关系；原专项审计主要检查数量和“每表至少一个索引”，会把不完整 Seed 误判为完成。

现已补齐 Seed 和专项审计。经用户明确授权，`localhost:5432/default` 本地开发数据库已使用最终修正版执行 `prisma migrate reset --force`，全部 30 个 migration 从零复放成功；随后连续执行两次最终 Seed，增强专项审计、全量规则测试、类型检查、Lint、生产构建和最终空库启动探测全部通过。任务 1.8 可以关闭，下一独立执行单元为 1.9。

## 2. 最终 Seed 覆盖范围

- 组织、部门、角色、用户和演示账号。
- `lead/customer/contact` 三个 `sys_module_form`、Form Blob、20 个系统/演示动态字段及 Field Blob。
- `CLUE/CLUE_POOL/CUSTOMER/CUSTOMER_CONTACT/CUSTOMER_POOL` 五类用户视图和 3 条真实条件。
- 2 个线索池、2 个客户公海，各自的 Scope、Owner、Pick Rule、Recycle Rule、Hidden Field 和 2 条容量配置。
- 3 条线索、6 个客户和 1 个联系人；线索、客户、联系人均包含普通字段值与 Blob 字段值样例。
- `clue_owner/customer_owner` 负责人历史、客户协作、客户关系和已转化线索到客户的关系样例。
- Cordys 默认目录语义的仪表板目录、外部资源、可见范围与管理员收藏。

Seed 连续执行两次均成功，新增的直接模型样例使用唯一条件或 `upsert` 保持幂等。

## 3. 专项审计

新增 `apps/api/scripts/w34-seed-empty-db-audit.ts`，并注册：

```text
pnpm --filter @micromatrix/api smoke:w34-seed
```

专项审计直接查询 PostgreSQL，并验证：

1. 32 张 W3.4 目标直接表全部存在；
2. 被破坏性迁移替换的 14 张旧表全部不存在；
3. 23 个关键命名索引全部存在，而不是仅检查“表上有任意索引”；
4. 三个 Form Key、五类 User View Type、非空池 Scope/Owner 和 Dashboard Scope 均符合直接契约；
5. Pick/Recycle/HiddenField/Capacity、三域普通与 Blob 字段值、Owner History、Collaboration、Relation、Clue Conversion 和 Dashboard 样例全部存在；
6. 转化线索指向真实存在的客户，不接受只有 `converted=true` 而无有效目标的伪样例。

最终空库增强审计结果：

| 数据                         |          数量 |
| ---------------------------- | ------------: |
| 目标表 / 旧表残留 / 关键索引 | `32 / 0 / 23` |
| 模块表单 / 模块字段          |      `3 / 20` |
| 用户视图 / 条件              |       `5 / 3` |
| 线索池 / 客户公海            |       `2 / 2` |
| 线索容量 / 客户容量          |       `2 / 2` |
| 线索 / 客户 / 联系人         |   `3 / 6 / 1` |
| 线索普通值 / Blob 值         |       `2 / 1` |
| 客户普通值 / Blob 值         |      `11 / 1` |
| 联系人普通值 / Blob 值       |       `1 / 1` |
| 线索/客户隐藏字段            |       `1 / 1` |
| 线索/客户负责人历史          |       `1 / 1` |
| 客户协作 / 关系 / 已转化线索 |   `1 / 1 / 1` |
| 仪表板目录 / 资源 / 收藏     |   `1 / 1 / 1` |

空库复放后仪表板目录、资源和收藏均为 `1`，确认上一版 Seed 使用的多余演示目录没有进入最终结果。

## 4. 已通过验证

- Prisma validate/generate：通过。
- 最终代码执行 `prisma migrate reset --force`：全部 30 个 migration 从零复放成功。
- Seed 连续执行两次：通过。
- 增强数据库专项审计：全部断言通过。
- Shared、API、Web typecheck：通过。
- 全量规则测试：`95/95`。
- 全仓 ESLint：通过。
- API 与 Web production build：通过；Web 仅有 chunk size 非阻断警告。
- API 生产产物启动并访问 `GET /api/health`：HTTP `200`。
- Web production preview 根页面：HTTP `200`。
- 临时 API/Web 验证进程已关闭。

## 5. 后续边界

任务 1.8 仅关闭 W3.4.0 Seed 与空库启动门槛；任务 1.9 继续执行公共底座专项 Smoke、全量现有关键链路回归、文档总收口和本地提交。

DB-016、DB-017、DB-020 仍保持 `IN_PROGRESS`，直到对应 Cordys 页面/API 全链路完成；DB-021 继续跟踪图外业务模块的分域动态字段缺口。
