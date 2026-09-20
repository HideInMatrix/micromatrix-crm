# PRISMA8-003 Prisma 8 Generated Contract 语义核实任务

状态：`VERIFIED / NO_GO_CLIENT_REVERT`

## P0 文档与基线

- [x] P0.1 建立 PRISMA8-003 requirements/design/tasks。
- [x] P0.2 核实当前 generated 目录实际是 contract emit，不是 generated Prisma Client。
- [x] P0.3 核实官方 `prisma-client` generator 支持 `moduleFormat = "cjs"`。
- [x] P0.4 量化现有 contract ORM rewrite 规模。
- [x] P0.5 记录当前 package/version/toolchain compatibility matrix。

## P1 官方架构核实

- [x] P1.1 核实 Prisma 8 官方 contract architecture。
- [x] P1.2 核实 PostgreSQL runtime 使用 `postgres<Contract>()`。
- [x] P1.3 核实模型正式 API 为 `.orm.public.*`。
- [x] P1.4 核实 `contract emit` 正式输出 `contract.json + contract.d.ts`。
- [x] P1.5 核实 `moduleFormat = "cjs"` 属于传统 `prisma-client` generator，不属于 Prisma 8 contract config。
- [x] P1.6 给出 NO-GO：不回退到传统 generated-client architecture。

## P2 结论

- [x] P2.1 不修改 production runtime。
- [x] P2.2 不新增 traditional `prisma-client` generator。
- [x] P2.3 不新增 `moduleFormat = "cjs"`。
- [x] P2.4 不重写 2746 个 `.orm.public.*` 调用。
- [x] P2.5 保持当前 migration/runtime architecture。

## 当前执行指针

当前执行指针：**无**。

已核实：

- 当前 `src/prisma/generated` 只有 `contract.json / contract.d.ts`，属于 contract emit；
- 当前 runtime 仍手工加载 `contractJson` 并构造 `PostgresClient<Contract>`；
- root `prisma` 为 `8.0.0-rc.14`，`@prisma/orm-postgres` 为 `8.0.0-rc.10`，当前不存在 `@prisma/client` dependency；
- root `prisma@8.0.0-rc.14` 自身依赖 `@prisma/orm-toolchain@8.0.0-rc.10`，当前 PostgreSQL extension 与其内部 toolchain 组件线一致；
- 当前 `@prisma/orm-postgres` config 没有 `moduleFormat`，其 `output` 固定服务于 contract artifact；
- Prisma 8 官方 architecture 正式使用 contract artifact + `postgres<Contract>()` + `.orm.public.*`；
- 传统 `prisma-client` generator 支持 `moduleFormat = "cjs"`，但该能力不属于 Prisma 8 contract runtime；
- `prisma contract emit` deterministic 复验通过：`contract.json` SHA-256 `43dc4a24bf6a309fd7f8b095165551cd1b8a751c8e180d9158ef0446997ad8fc`、`contract.d.ts` SHA-256 `821a5159c513401aa88c6bcde50d109398311d35348bbc4d830501a8d4d4530c`，emit 前后完全一致；
- `apps/api/src/prisma/generated/` 当前且正式仅包含 `contract.json / contract.d.ts`；
- 当前约 `.orm.public.` **2746 calls / 168 files**，transaction 约 **167 calls / 49 files**；
- PRISMA8-003 默认不产生 DDL，不改变当前 **4 migrations / 2226 operations** storage graph。

最终决策：**NO-GO traditional generated-client revert**。当前 production Prisma 8 runtime 不修改。

