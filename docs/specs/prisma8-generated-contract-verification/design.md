# PRISMA8-003 Prisma 8 Generated Contract 语义核实设计

状态：`VERIFIED / NO_GO_CLIENT_REVERT`

## 1. 现状架构

```text
contract.prisma
      │
      ▼
prisma contract emit
      │
      ▼
src/prisma/generated/
  contract.json
  contract.d.ts
      │
      ▼
prisma-client.ts
  postgres<Contract>({ contractJson, url })
      │
      ▼
PrismaService
      │
      ▼
client.orm.public.*
```

该结构是 Prisma 8 正式 contract runtime；Prisma 8 的 generated artifact 是 contract，而不是传统 generated Prisma Client package。

## 2. 正式架构

Prisma 8 正式形态保持：

```text
contract.prisma
      │
      ▼
prisma contract emit
      │
      ▼
src/prisma/generated/
  contract.json
  contract.d.ts
      │
      ▼
postgres<Contract>({ contractJson, url })
      │
      ▼
PrismaService
      │
      ▼
client.orm.public.*
```

`src/prisma/generated` 承担 Prisma 8 generated contract artifact 语义。

## 3. 核心设计决策

### D1：禁止 generated-client downgrade

当前项目同时存在：

- root `prisma@8.0.0-rc.14`
- `@prisma/orm-postgres@8.0.0-rc.10`

而官方 `prisma-client` generator 的公开配置模型与当前 contract RC CLI 不属于同一个配置接口。

官方 Prisma 8 已明确选择 contract runtime；因此不再开展传统 generated-client feasibility spike。

### D2：当前 RC package line 属于同一 Prisma 8 toolchain 组合

当前 root `prisma@8.0.0-rc.14` 的 package manifest 自身依赖 `@prisma/orm-toolchain@8.0.0-rc.10`；项目的 `@prisma/orm-postgres@8.0.0-rc.10` 与该内部 toolchain 处于同一 RC10 组件线。

因此不能仅凭外层 CLI 为 RC14、PostgreSQL extension 为 RC10 就判定“版本漂移”。未来升级应按 Prisma 官方发布的 CLI/toolchain/extension compatibility 组合整体验证，而不是在 PRISMA8-003 中强制拉平字符串版本号。

### D3：单 source-of-truth

唯一 source-of-truth 继续是 `apps/api/prisma/contract.prisma`，generated artifact 由 contract emit 产生。

### D4：CommonJS 不通过 Prisma Client generator 解决

`moduleFormat` 属于传统 `prisma-client` generator，不能用于当前 Prisma 8 contract config。Nest/CommonJS 与 Prisma 8 runtime 的模块互操作按 NodeNext/TypeScript 运行时能力处理，不通过引入旧 generator 解决。

### D5：保留 `client.orm.public` 正式 API

官方 Prisma 8 ORM client reference 以 `.orm.public.Model` 为正式 PostgreSQL model API，因此现有约 2746 个调用不属于待清理 legacy surface。

### D6：继续使用 PRISMA8-002 已封板的 Prisma 8 domain

| 数据库语义 | Prisma 8 contract runtime | 应用 domain |
| --- | --- | --- |
| timestamptz(3) | Temporal.Instant | ISO API boundary |
| numeric(p,s) | branded decimal string | DecimalString / precision-scale validation |
| jsonb | JsonValue | JSON-safe domain |
| int8 | BigInt | BigInt |
| text + CHECK | string | string，长度由 DB CHECK 保证 |

不因为对 generated 目录的误解重新引入 Date/Decimal/传统 Prisma Client 双轨。

### D7：PrismaService 正式形态

当前正式形态：

```ts
import postgres, { type PostgresClient } from '@prisma/orm-postgres/runtime'
import contractJson from './generated/contract.json'
import type { Contract } from './generated/contract.js'
```

该结构与 Prisma 8 官方 PostgreSQL client reference 一致，不作为 compatibility layer 删除。

### D8：generated 目录继续只保存 contract emit artifact

`src/prisma/generated` 当前只包含：

- `contract.json`
- `contract.d.ts`

这正符合 Prisma 8 contract emit 语义。目录内禁止加入手工源码或传统 generated Prisma Client。

## 4. Cutover 决策

传统 generated-client cutover 判定为 **NO-GO**，不进入代码迁移。

## 5. Database 不变量

PRISMA8-003 是架构语义核实，不是 client/runtime migration，也不是 storage migration。

必须保持：

- migration graph 不被重写；
- existing DB storage hash 不因纯 client generation 改造发生 DDL 漂移；
- 476 个 text length CHECK 保留；
- 126 个 timestamptz 保留；
- ID 字符串语义保留；
- migration ref 不后退。

本任务不产生任何数据库结构变化。

## 6. 验证

最终静态 gate：

```text
src/prisma/generated/contract.json       = 存在且由 emit 生成
src/prisma/generated/contract.d.ts       = 存在且由 emit 生成
@prisma/orm-postgres/runtime             = 正式 Prisma 8 runtime
PostgresClient<Contract>                 = 正式 Prisma 8 client type
.orm.public.                             = 正式 Prisma 8 model API
```

## 7. 决策结果

不实施传统 `prisma-client` / CommonJS generator cutover。PRISMA8-003 的输出是架构事实校正，不产生 production code change。

