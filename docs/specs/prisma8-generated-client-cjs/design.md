# PRISMA8-003 Generated Prisma Client / CommonJS 技术设计

状态：`IN_PROGRESS`

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

该结构是 Prisma 8 RC contract runtime，不是 generated Prisma Client。

## 2. 目标架构

目标形态：

```text
canonical database contract
      │
      ├── migration contract / verify / plan
      │
      └── deterministic client-generation input
                      │
                      ▼
              prisma-client generator
              moduleFormat = "cjs"
                      │
                      ▼
          src/prisma/generated/
            client.ts
            models/*
            enums/*
            internal/*
            ...
                      │
                      ▼
                 PrismaService
                      │
                      ▼
           native generated delegates
```

`src/prisma/generated` 只承担 generated client 语义。

Contract emit artifact 如果仍被 migration toolchain 需要，应移动到 runtime source tree 之外，例如 build/cache 专用目录；最终路径在 P1 feasibility 后确定。

## 3. 核心设计决策

### D1：先做 feasibility spike，禁止直接全仓替换

当前项目同时存在：

- root `prisma@8.0.0-rc.14`
- `@prisma/orm-postgres@8.0.0-rc.10`

而官方 `prisma-client` generator 的公开配置模型与当前 contract RC CLI 不属于同一个配置接口。

因此 P1 必须先回答：

1. 当前/可升级 Prisma 8 package line 是否提供 generated client generator；
2. 它是否能直接消费 canonical contract；
3. 如果不能，能否从 canonical contract deterministic 生成 client schema；
4. generator 是否能在当前 Node 25 + TypeScript 7 + Nest/CommonJS build 中稳定输出/运行；
5. 是否需要 driver adapter / engineType 调整；
6. 是否会破坏当前 migration contract 的 `@@check` 等能力。

任何一项无法满足，都不得继续 production cutover。

### D2：版本必须成组对齐

当前 CLI RC14 与 orm-postgres RC10 已存在版本差。

Generated client cutover 前必须形成一份明确 compatibility matrix，并把以下 package 固定在经过验证的组合：

- `prisma`
- generated client provider/runtime package
- PostgreSQL driver/adapter（若需要）
- `@prisma/orm-postgres`（若 migration ownership 仍依赖）
- Node
- TypeScript

不得长期依赖“CLI 一个 RC、runtime 另一个 RC、generator 第三个版本”的偶然兼容。

### D3：单 source-of-truth

优先级：

#### 方案 A：同一 contract 直接生成 client

最优；如果 Prisma 8 最终 toolchain 原生支持，应采用。

#### 方案 B：canonical contract → generated client schema

如果 official client generator 只能读取传统 Prisma schema，则允许增加**机械生成**步骤：

```text
contract.prisma
  -> deterministic transform
  -> generated-client-schema.prisma
  -> prisma-client generator
```

约束：

- `generated-client-schema.prisma` 不得人工编辑；
- 每次 build/test 前自动生成；
- CI 对重复生成结果做 deterministic diff；
- migration 只看 canonical contract，不看 generated client schema；
- client schema 不具备的 CHECK 等 DDL 能力不允许反向影响 migration ownership。

#### 方案 C：人工双 schema

禁止。

### D4：CommonJS 必须是 generator contract

目标 generator 配置应显式包含：

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../src/prisma/generated"
  moduleFormat = "cjs"
}
```

最终具体的 `runtime / engineType / generatedFileExtension / importFileExtension` 由 P1 spike 决定。

验收必须包含：

- generated 源码不依赖 `import.meta.url` ESM-only 路径；
- Nest production build 可静态 import；
- Node production runtime 不需要动态 import bridge；
- Docker API/Worker runtime 可直接启动。

### D5：不保留 `client.orm.public` facade

当前约 **2746 calls / 168 files**，因此采用分批 native rewrite：

1. Prisma infrastructure/tests
2. Auth / Common / Personal Center
3. Customers / Leads / Metadata
4. Opportunities / Products / Quotes / Contracts / Orders
5. Approvals / Follow-ups / Follow-up Plans
6. Enterprise integrations / SSO / Organization Sync
7. Notification / Async / Logs / Dashboard / Home
8. remaining modules

每一批必须做到：

- 改为 generated delegate；
- focused tests PASS；
- typecheck PASS；
- 旧 `.orm.public.` refs 单调下降。

不增加“旧 API → 新 delegate”的永久 Proxy/adapter。

### D6：类型映射作为正式 domain decision

P1 必须产出一份表：

| 数据库语义 | 当前 contract runtime | generated client | 最终应用 domain |
| --- | --- | --- | --- |
| timestamptz(3) | Temporal.Instant | 待验证 | ISO API boundary，不保留手工双表示 compatibility |
| numeric(p,s) | branded decimal string | 待验证 | 精度不可下降 |
| jsonb | JsonValue | 待验证 | JSON-safe domain |
| int8 | BigInt | 待验证 | BigInt |
| text + CHECK | string | string | string，DB CHECK 继续由 canonical migration contract 管理 |

如果 generated client 使用 `Date` / Decimal class，这是 generated client 的 native type，不自动视为 compatibility layer；但业务 domain 必须统一，不允许再同时维护 Date/Temporal 双轨。

### D7：PrismaService 目标

最终 `PrismaService` 应直接持有 generated `PrismaClient`。

目标伪代码：

```ts
import { PrismaClient } from './generated/client'

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client = new PrismaClient(/* validated runtime options */)

  async onModuleInit() {
    await this.client.$connect()
  }

  async onModuleDestroy() {
    await this.client.$disconnect()
  }
}
```

实际 constructor/adapter 形式以 P1 generator/runtime spike 为准。

最终删除：

- `src/prisma/prisma-client.ts` 中的 `contractJson` runtime bootstrap；
- `PostgresClient<Contract>` type alias；
- runtime 对 `@prisma/orm-postgres/runtime` 的依赖；
- `ensureTemporalRuntime()`，如果 generated client 不再需要该 global polyfill。

### D8：contract emit 与 generated client 输出必须分离

切换后：

- `src/prisma/generated`：只允许 generated Prisma Client；
- migration contract emit：若仍需要 JSON/DTS，应输出到非 runtime source 目录；
- build/test script 分为：
  - contract/migration verification
  - client generation
  - TypeScript build

不得再使用同一个目录同时装 migration contract artifact 与 application client。

## 4. Cutover 策略

采用 **shadow generation → batch rewrite → runtime switch → cleanup**，禁止 big-bang。

### Shadow 阶段

先生成到：

```text
apps/api/src/prisma/generated-client-spike/
```

现有 production runtime 不引用它。

只有 P1 全部通过后才把正式 output 切到：

```text
apps/api/src/prisma/generated/
```

### Batch rewrite 阶段

允许旧 contract client 与 generated client 短期并存，但：

- module 必须明确属于 old/new 哪一侧；
- 每批迁移后 old refs 必须下降；
- 不新增旧 API；
- 并存只属于 PRISMA8-003 的迁移窗口。

### Final cutover

当 production `.orm.public.` = 0：

1. `PrismaService` 切 generated client；
2. Worker/Seed 切 generated client；
3. 删除 contract runtime bootstrap；
4. generated output 切正式目录；
5. package scripts/Docker 更新；
6. 删除临时 spike artifacts。

## 5. Database 不变量

PRISMA8-003 默认是 client/runtime migration，不是 storage migration。

必须保持：

- migration graph 不被重写；
- existing DB storage hash 不因纯 client generation 改造发生 DDL 漂移；
- 476 个 text length CHECK 保留；
- 126 个 timestamptz 保留；
- ID 字符串语义保留；
- migration ref 不后退。

如果 generated client toolchain 要求数据库结构变化，必须暂停并单独提出 DDL 设计，不允许夹带在 client cutover 中。

## 6. Release 与测试设计

每一阶段至少执行：

- API typecheck
- focused Rules
- `git diff --check`

关键阶段执行：

- full API Rules
- root typecheck/lint/build
- existing DB verify/status
- fresh PostgreSQL migration + Seed + verify/status
- Docker release smoke
- Browser representative regression
- API runtime log scan

最终静态 gate：

```text
src/prisma/generated/contract.json       = 不存在
src/prisma/generated/contract.d.ts       = 不存在
@prisma/orm-postgres/runtime production refs = 0
generated/contract.json production refs = 0
PostgresClient<Contract> refs            = 0
.orm.public. production refs             = 0
dynamic import bridge for Prisma runtime = 0
```

## 7. 回退条件

出现任一情况应停在当前阶段，不强推 cutover：

- 只能人工维护第二份 schema；
- generated client 无法表达/读取当前核心 PostgreSQL 类型；
- Decimal/时间精度回归；
- transaction semantics 无等价能力；
- migration toolchain 因 generated client schema 产生 DDL drift；
- CJS 仍需 ESM compatibility bridge；
- Docker/Worker/Seed 无法共享同一 runtime client。

回退只恢复 application client 路径，不回滚已发布数据库 migration。

