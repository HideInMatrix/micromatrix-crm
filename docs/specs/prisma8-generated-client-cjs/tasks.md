# PRISMA8-003 Generated Prisma Client / CommonJS 执行任务

状态：`IN_PROGRESS`

## P0 文档与基线

- [x] P0.1 建立 PRISMA8-003 requirements/design/tasks。
- [x] P0.2 核实当前 generated 目录实际是 contract emit，不是 generated Prisma Client。
- [x] P0.3 核实官方 `prisma-client` generator 支持 `moduleFormat = "cjs"`。
- [x] P0.4 量化现有 contract ORM rewrite 规模。
- [ ] P0.5 记录当前 package/version/toolchain compatibility matrix。

## P1 Generated Client feasibility gate

- [ ] P1.1 在隔离 output 建立 generated client spike，不修改 production runtime。
- [ ] P1.2 确认 Prisma 8 generator package line 与当前 contract/migration package 的兼容版本组合。
- [ ] P1.3 验证 canonical contract 是否可直接生成 client。
- [ ] P1.4 若不能直接生成，验证 deterministic contract → client-schema 方案；禁止人工双 schema。
- [ ] P1.5 验证 `moduleFormat = "cjs"` 在 Node 25 / TS7 / Nest production build 下真实运行。
- [ ] P1.6 验证 generated client 的 PostgreSQL driver/adapter/engine 组合。
- [ ] P1.7 建立 timestamptz/Numeric/Jsonb/BigInt/text/relations/transaction 类型矩阵。
- [ ] P1.8 建立 GO / NO-GO 决策记录。

## P2 Generation pipeline

- [ ] P2.1 建立 deterministic client generation command。
- [ ] P2.2 把 migration contract emit 与 application generated-client output 分离。
- [ ] P2.3 为 generated client 增加 drift/reproducibility gate。
- [ ] P2.4 更新 API dev/build/typecheck/test scripts。
- [ ] P2.5 更新 Docker build/migration/seed generation pipeline。

## P3 Prisma infrastructure cutover

- [ ] P3.1 `PrismaService` shadow 接入 generated client。
- [ ] P3.2 生命周期、connect/disconnect、startup probe 验证。
- [ ] P3.3 transaction/raw query 等基础 API 等价验证。
- [ ] P3.4 Prisma tests 与 native PostgreSQL test helpers 切 generated client。

## P4 Production module native rewrite

- [ ] P4.1 Auth/Common/Personal Center。
- [ ] P4.2 Customers/Leads/Metadata。
- [ ] P4.3 Opportunities/Products/Quotes/Contracts/Orders。
- [ ] P4.4 Approvals/Follow-ups/Follow-up Plans。
- [ ] P4.5 Enterprise Integrations/SSO/Organization Sync。
- [ ] P4.6 Notification/Async/Logs/Dashboard/Home。
- [ ] P4.7 remaining modules。
- [ ] P4.8 production `.orm.public.` refs = 0。

## P5 Domain/runtime cleanup

- [ ] P5.1 时间 domain 按 generated native type 收口，禁止 Date/Temporal 双轨 compatibility。
- [ ] P5.2 Numeric/Decimal domain 精度回归验证与收口。
- [ ] P5.3 JSON/BigInt boundary 收口。
- [ ] P5.4 Worker/Seed/runtime 全部切 generated client。
- [ ] P5.5 删除 `contractJson` application runtime bootstrap。
- [ ] P5.6 删除 production `@prisma/orm-postgres/runtime` 依赖。
- [ ] P5.7 正式 `src/prisma/generated/` 只包含 generated Prisma Client。

## P6 最终验收

- [ ] P6.1 API/full root typecheck/lint/build。
- [ ] P6.2 完整 API Rules。
- [ ] P6.3 existing PostgreSQL verify/status/hash。
- [ ] P6.4 fresh PostgreSQL 4-migration + Seed + verify/status。
- [ ] P6.5 Docker release smoke。
- [ ] P6.6 Browser 代表性回归 + API runtime log gate。
- [ ] P6.7 legacy/contract-runtime/static scan。
- [ ] P6.8 文档封板为 `VERIFIED`。

## 当前执行指针

当前执行 **P0.5 → P1.1**。

已核实：

- 当前 `src/prisma/generated` 只有 `contract.json / contract.d.ts`，属于 contract emit；
- 当前 runtime 仍手工加载 `contractJson` 并构造 `PostgresClient<Contract>`；
- root `prisma` 为 `8.0.0-rc.14`，`@prisma/orm-postgres` 为 `8.0.0-rc.10`，当前不存在 `@prisma/client` dependency；
- 当前 `@prisma/orm-postgres` config 没有 `moduleFormat`，其 `output` 固定服务于 contract artifact；
- 官方 `prisma-client` generator 支持 `moduleFormat = "cjs"`，但该配置不能直接应用到当前 contract runtime；
- 当前约 `.orm.public.` **2746 calls / 168 files**，transaction 约 **167 calls / 49 files**；
- PRISMA8-003 默认不产生 DDL，不改变当前 **4 migrations / 2226 operations** storage graph。

下一步只做隔离 generated-client feasibility spike；在 GO gate 之前，不修改 production `PrismaService` 和业务模块。

