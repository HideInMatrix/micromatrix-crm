# PRISMA8-003 Prisma 8 Generated Contract 语义核实

状态：`VERIFIED / NO_GO_CLIENT_REVERT`

## 1. 背景

`PRISMA8-001` 已完成 Prisma 8 migration ownership handoff，`PRISMA8-002` 已完成 timestamp / VarChar / Numeric / JSON / runtime naming 等迁移后 compatibility cleanup。

后续复核聚焦 `apps/api/src/prisma/generated/`。该目录当前是 `@prisma/orm-postgres@8.0.0-rc.10` 的 contract emit 产物：

```text
apps/api/src/prisma/generated/
├── contract.d.ts
└── contract.json
```

生产 runtime 仍由 `apps/api/src/prisma/prisma-client.ts` 手工加载上述 contract：

```ts
import postgres, { type PostgresClient } from '@prisma/orm-postgres/runtime'
import contractJson from './generated/contract.json'
import type { Contract } from './generated/contract.js'
```

经 Prisma 8 官方文档复核，这**正是 Prisma 8 的正式 generated artifact 形态**，不是未完成迁移。

## 2. 已核实事实

### 2.1 当前项目实际工具链

- root `prisma` CLI：`8.0.0-rc.14`
- root CLI 自身依赖 `@prisma/orm-toolchain@8.0.0-rc.10`
- PostgreSQL contract/runtime：`@prisma/orm-postgres@8.0.0-rc.10`
- 当前项目没有 `@prisma/client` dependency。
- 当前 `@prisma/orm-postgres` 的 `PostgresConfigOptions` 仅提供：
  - `contract`
  - `output`
  - `db`
  - `extensions`
  - `migrations`
- 当前 `output: 'src/prisma/generated'` 的实现固定输出 `contract.json`；它不是 Prisma Client generator output。
- 当前 Prisma 8 RC CLI 提供 `contract / db / orm / migration` 等命令，但当前命令集没有传统 `prisma generate` 入口。
- 当前 API TypeScript 编译模式是 `NodeNext`；package 未声明 `type: module`。

### 2.2 Prisma 8 官方架构

Prisma 8 官方文档明确：

- Prisma 8 的核心变化是 contract-based ORM；
- contract source 会编译为 `contract.json` 与 `contract.d.ts`；
- PostgreSQL runtime 使用 `@prisma/orm-postgres/runtime` 的 `postgres<Contract>()`；
- model query 入口为 `db.orm.public.Model`；
- Prisma 8 不以传统“生成一整个 Prisma Client package”作为 runtime architecture。

因此当前：

```text
contract.prisma
  -> contract emit
  -> contract.json + contract.d.ts
  -> postgres<Contract>({ contractJson, url })
  -> client.orm.public.*
```

是 Prisma 8 正式架构。

### 2.3 传统 Prisma Client generator 能力与适用范围

传统/上一代 Prisma ORM 文档中的 `provider = "prisma-client"` generator：

- 生成 plain TypeScript Prisma Client；
- 要求显式 `output`；
- 支持 `moduleFormat = "esm" | "cjs"`；
- `moduleFormat = "cjs"` 可以强制 generated client 使用 CommonJS 模块形态；
- generator 的 `moduleFormat` 配置只属于 `prisma-client` generator，**不属于当前 `@prisma/orm-postgres` contract config**。

其中 `moduleFormat = "cjs"` 确实存在，但它属于该 generator，**不属于 Prisma 8 contract runtime**。把它强行引入当前项目意味着从 Prisma 8 contract ORM 倒退到传统 generated-client architecture，不是 Prisma 8 收口。

## 3. 结论

### R1：保留 Prisma 8 generated contract artifact

最终 `apps/api/src/prisma/generated/` 继续保存 Prisma 8 官方 contract artifact：

- `contract.json`
- `contract.d.ts`

这两个文件本身就是 Prisma 8 runtime/type 的 generated inputs，不应替换成传统 Prisma Client package。

### R2：不引入 `moduleFormat = "cjs"`

`moduleFormat = "cjs"` 不适用于当前 Prisma 8 contract config；不得为了 CommonJS 强行引入传统 generated-client generator。

### R3：继续保持单一 canonical contract

当前 canonical storage contract 为：

```text
apps/api/prisma/contract.prisma
```

本任务禁止再引入第二份需要人工同步维护的 `schema.prisma`。

不新增第二份 `schema.prisma`，不生成 client-only schema。

### R4：migration ownership 不得倒退

正式 migration graph 继续由现有 Prisma 8 contract/migration 系统管理。

当前 graph：

- `20260918T0338_baseline`：672 operations
- `20260918T0826_timestamp_absolute_instants`：126 operations
- `20260918T0923_varchar_text_length_constraints`：952 operations
- `20260920T0347_canonical_check_constraint_names`：476 operations
- 合计：**4 migrations / 2226 operations**
- storage hash：`dee42ec15d90123679a39e92cd8468c445ed20dea1161a6b69ba8c615206c7b1`

本核实任务不得修改数据库物理结构，也不得重写已发布 migration。

### R5：`.orm.public` 不属于 compatibility facade

当前 contract ORM 使用：

```ts
client.orm.public.Model
```

现有生产/测试源码中约有：

- `.orm.public.`：**2746 calls / 168 files**
- transaction 调用：约 **167 calls / 49 files**

经官方 Prisma 8 文档确认，`.orm.public.*` 是 Prisma 8 正式 ORM API，不是 Prisma 7 compatibility facade，因此不应以“清兼容层”为理由重写 2746 个调用。

### R6：generated artifact 只允许 contract emit 产生

`contract.json / contract.d.ts` 禁止手工编辑，必须由 `prisma contract emit` deterministic 生成。

### R7：API contract 继续保持现有边界

当前 Prisma 8 contract runtime 下：

- HTTP 时间字段仍输出 ISO machine value；
- 前端继续负责 locale/timezone 展示；
- 金额、JSON、BigInt 等既有 HTTP contract 不得无意变化。

### R8：Docker / Worker / Seed 必须继续使用同一 Prisma 8 contract runtime

以下运行入口保持 Prisma 8 contract/runtime 一致：

- Nest API
- Worker
- bootstrap Seed
- demo Seed（如启用）
- test runtime
- Docker API/Migration image 中需要 runtime client 的部分

不得引入传统 Prisma Client 与 contract runtime 双轨。

## 4. 非目标

本任务不负责：

- 修改业务数据库表结构；
- 把历史 String ID 改成 UUID；
- 重做 P2/P3 已完成的 timestamptz / text + CHECK 数据迁移；
- 重写业务功能；
- 修改前端展示规则；
- 修改已冻结历史 migration。

## 5. 完成定义

只有全部满足以下条件，`PRISMA8-003` 才允许标记 `VERIFIED`：

1. 文档明确 `contract.json / contract.d.ts` 是 Prisma 8 官方 generated artifact；
2. 不引入传统 `prisma-client` generator；
3. 不引入 `moduleFormat = "cjs"`；
4. 不新增第二份 schema；
5. 当前 Prisma 8 runtime、migration ownership 和 4-migration graph 保持不变；
6. `apps/api/src/prisma/generated/` 中无手工文件；
7. `prisma contract emit` 可重复生成 byte-equivalent artifact；
8. 相关文档不再把 `.orm.public` 或 contract JSON runtime 描述为待删除 compatibility layer。

## 6. 官方依据

核实日期：2026-09-20。

- Prisma 8 overview：`https://docs.prisma.io/docs/orm`
- Prisma 8 data contract：`https://docs.prisma.io/docs/orm/v8/contract-authoring/the-data-contract`
- Prisma 8 ORM client reference：`https://docs.prisma.io/docs/orm/v8/reference/orm-client`
- Prisma 8 PostgreSQL extension：`https://www.prisma.io/extensions/postgresql`
- 传统 `prisma-client` generator / `moduleFormat` reference：`https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators`

