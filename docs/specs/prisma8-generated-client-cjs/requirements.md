# PRISMA8-003 Generated Prisma Client / CommonJS 收口需求

状态：`IN_PROGRESS`

## 1. 背景

`PRISMA8-001` 已完成 Prisma 8 migration ownership handoff，`PRISMA8-002` 已完成 timestamp / VarChar / Numeric / JSON / runtime naming 等迁移后 compatibility cleanup。

后续复核发现，当前 `apps/api/src/prisma/generated/` 虽然名称为 generated，但实际仍然只是 `@prisma/orm-postgres@8.0.0-rc.10` 的 contract emit 产物：

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

因此此前的 canonicalization 解决的是 contract/runtime compatibility 命名与存储语义，并没有把该目录转换为真正的 generated Prisma Client。

## 2. 已核实事实

### 2.1 当前项目实际工具链

- root `prisma` CLI：`8.0.0-rc.14`
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

### 2.2 官方 Prisma Client generator 能力

官方 `provider = "prisma-client"` generator：

- 生成 plain TypeScript Prisma Client；
- 要求显式 `output`；
- 支持 `moduleFormat = "esm" | "cjs"`；
- `moduleFormat = "cjs"` 可以强制 generated client 使用 CommonJS 模块形态；
- generator 的 `moduleFormat` 配置只属于 `prisma-client` generator，**不属于当前 `@prisma/orm-postgres` contract config**。

因此不能把 `moduleFormat: 'cjs'` 直接加到当前 `definePostgresConfig()`，必须先解决 generated client toolchain 与 canonical contract 的关系。

## 3. 目标

### R1：generated 目录语义必须真实

最终 `apps/api/src/prisma/generated/` 必须是可直接 import 的 generated Prisma Client 源码，不再只是：

- `contract.json`
- `contract.d.ts`

不得继续把 contract emit artifact 命名成应用 runtime generated client。

### R2：CommonJS 必须由 generator 正式输出

如果最终采用官方 `prisma-client` generator，则必须显式配置：

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../src/prisma/generated"
  moduleFormat = "cjs"
}
```

不得通过 post-build rewrite、Babel wrapper、动态 `import()` 或自定义 ESM→CJS compatibility shim 模拟 CommonJS。

### R3：只允许一个人工维护的数据库模型 source-of-truth

当前 canonical storage contract 为：

```text
apps/api/prisma/contract.prisma
```

本任务禁止再引入第二份需要人工同步维护的 `schema.prisma`。

可接受方案只有：

1. 同一 canonical contract 能直接驱动 generated client；
2. 或由 canonical contract **机械生成** client-only schema，生成结果不可人工编辑，并有 deterministic drift gate。

如果只能人工维护两份 schema，本任务必须停在 feasibility gate，不进入 production cutover。

### R4：migration ownership 不得倒退

正式 migration graph 继续由现有 Prisma 8 contract/migration 系统管理。

当前 graph：

- `20260918T0338_baseline`：672 operations
- `20260918T0826_timestamp_absolute_instants`：126 operations
- `20260918T0923_varchar_text_length_constraints`：952 operations
- `20260920T0347_canonical_check_constraint_names`：476 operations
- 合计：**4 migrations / 2226 operations**
- storage hash：`dee42ec15d90123679a39e92cd8468c445ed20dea1161a6b69ba8c615206c7b1`

Generated Client 切换默认不得修改数据库物理结构，也不得重写已发布 migration。

### R5：禁止新增大规模 compatibility facade

当前 contract ORM 使用：

```ts
client.orm.public.Model
```

现有生产/测试源码中约有：

- `.orm.public.`：**2746 calls / 168 files**
- transaction 调用：约 **167 calls / 49 files**

迁到 generated Prisma Client 后，应逐模块改用 generated native model delegates / transactions。

禁止实现一个新的 facade 去长期伪装 `client.orm.public.*`，否则只是把旧 compatibility layer 换了名字。

### R6：类型语义必须重新验证，而不是假设一致

Feasibility 阶段必须对以下类型做真实 generated/client/runtime matrix：

- `timestamptz(3)`
- Numeric / Decimal
- Jsonb
- BigInt
- String/text
- nullable fields
- enums / protocol values
- relations / compound unique / indexes
- raw SQL
- transaction

尤其必须确认：

- generated client 的 timestamp runtime representation；
- Decimal/Numeric 精度语义；
- JsonValue 输入/输出类型；
- 当前 `text + CHECK(char_length)` 约束不因 client schema 缺失而被 migration tool误判或重写。

### R7：API contract 不因 ORM 表示层变化而漂移

无论 generated client 内部使用何种时间/Decimal 表示：

- HTTP 时间字段仍输出 ISO machine value；
- 前端继续负责 locale/timezone 展示；
- 金额、JSON、BigInt 等既有 HTTP contract 不得无意变化。

### R8：Docker / Worker / Seed 必须使用同一 generated client

最终以下运行入口必须使用同一 generated Prisma Client：

- Nest API
- Worker
- bootstrap Seed
- demo Seed（如启用）
- test runtime
- Docker API/Migration image 中需要 runtime client 的部分

不得出现 API 用 generated client、Seed/Worker 继续依赖 contract runtime 的双 runtime 长期状态。

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

1. `apps/api/src/prisma/generated/` 是 generated Prisma Client，而非 contract JSON/DTS runtime bundle；
2. CommonJS 由 generator 正式输出，配置中可明确看到 `moduleFormat = "cjs"`；
3. 业务 runtime 不再 import `@prisma/orm-postgres/runtime`；
4. 业务 runtime 不再 import `generated/contract.json` / `generated/contract.d.ts`；
5. `client.orm.public.*` production refs = 0；
6. 不存在长期 Prisma7/contract-ORM compatibility facade；
7. migration ownership 与当前 4-migration graph 保持一致；
8. existing/fresh PostgreSQL verify/status 全绿；
9. API Rules、typecheck/lint/build 全绿；
10. Docker release smoke PASS；
11. Browser 代表性回归与 API runtime log gate 全绿；
12. 文档明确记录 generator/toolchain 的最终版本和 source-of-truth 策略。

