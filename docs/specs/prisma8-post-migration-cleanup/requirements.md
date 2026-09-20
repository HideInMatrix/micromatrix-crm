# PRISMA8-002 Prisma 8 迁移后兼容层收口需求

状态：`VERIFIED`

## 1. 目标

PRISMA8-001 已完成 Prisma 7 → Prisma 8 的 production/runtime/migration ownership 切换。本执行单元只处理迁移完成后仍保留的兼容层、过渡命名和类型边界，不重新打开 PRISMA8-001。

最终目标：

1. 删除仅为 Prisma 7 测试 API 形态保留的 fixture compatibility layer；
2. 生产代码只表达 Prisma 8 / PostgreSQL 的正式语义，不再维持 Prisma 7 `Date`、Client API 或模块加载习惯；
3. 时间字段由数据库保存正确时间语义，API 输出稳定的机器可读时间值，前端负责 locale / timezone / relative-time 等展示格式；
4. 能通过数据库 schema 正规化长期消除的类型适配，使用新的 forward migration 完成，禁止修改 `20260918T0338_baseline`；
5. 不为了删除 TypeScript branded type 而降低数据库约束或精度；
6. 完成后删除 `Prisma8*` 迁移期命名，收口为项目正式 Prisma/Database 基础设施命名。

## 2. 不变约束

- canonical contract 仍为 `apps/api/prisma/contract.prisma`；
- canonical migration graph 仍为 `apps/api/migrations/`；
- baseline `20260918T0338_baseline` 已冻结，不再修改；
- 所有数据库结构变化只能新增 forward migration；
- `numeric(p,s)` 不得为了简化应用类型改成浮点；
- `json/jsonb` 不得为了兼容应用对象改成弱类型文本；
- `varchar(n)` 只有在用等价 CHECK/DOMAIN 等约束保留长度规则后，才允许评估改为普通 String 映射；
- 旧数据转换必须先有只读 precheck，再有可重复/可验证的数据迁移步骤。

## 3. 时间语义

数据库时间字段只承担存储语义，不承担展示格式。

- 表示绝对时间点的字段（createdAt / updatedAt / finishedAt / loginAt 等）应统一具备明确时区语义；
- API 对外输出 ISO 8601 等稳定机器格式；
- Web/Mobile 负责最终展示格式、时区、locale 和“刚刚/几分钟前”等相对时间；
- 后端不再为了兼容 Prisma 7 `Date` 维持 `Temporal -> Date -> ISO -> Date` 往返；
- 如果旧 `timestamp without time zone` 实际保存 UTC，迁移为带时区语义时必须显式按 UTC 解释旧值，禁止依赖数据库 session timezone 猜测。

## 4. 完成定义

只有以下条件全部满足才能切为 `VERIFIED`：

1. production 不存在仅为 Prisma 7 模块格式保留的 runtime workaround；
2. API Rules 不再依赖 Prisma 7 风格通用 fixture facade；
3. 大型静态 fixture metadata 被删除；
4. 时间 API contract 明确且前端格式化路径完成回归；
5. 数据库类型治理产生的 forward migration 在 existing DB 与 fresh DB 均通过；
6. typecheck / lint / build / API Rules / DB verify / migration status / Docker release smoke / Browser 回归全绿；
7. Prisma 迁移期命名完成 canonicalization。

