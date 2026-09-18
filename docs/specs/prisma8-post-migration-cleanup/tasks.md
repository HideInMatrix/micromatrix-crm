# PRISMA8-002 执行任务

状态：`IN_PROGRESS`

## P0 基线与规则

- [x] P0.1 固定 PRISMA8-001 为已封板基线，不修改正式 baseline。
- [x] P0.2 核实 `moduleFormat = "cjs"` 适用范围；确认当前 contract runtime 不支持该配置。
- [x] P0.3 实测当前 Prisma 8 runtime 可由 CommonJS 加载，删除动态 import workaround。
- [x] P0.4 盘点类型面：VarChar 476、Timestamp 126、Numeric 12、Jsonb 21、BigInt 110。
- [x] P0.5 明确时间职责：DB 保存语义、API 输出机器格式、前端负责展示。

## P1 测试兼容层

- [x] P1.1 建立 Prisma 8 原生 test database helper。
- [ ] P1.2 第一批迁移基础设施/认证/公共服务测试，停止使用通用 Prisma 7 delegate facade。
- [ ] P1.3 迁移 Customers / Leads / Metadata / Pool tests。
- [ ] P1.4 迁移交易链 / 审批 / 通知 / 企业集成 tests。
- [ ] P1.5 `createPrismaFixtureClient` 引用归零。
- [ ] P1.6 删除 `prisma-fixture-client.ts` 与 `prisma-fixture-metadata.ts`。

## P2 时间语义与 API contract

- [ ] P2.1 对 126 个 Timestamp 字段按 absolute/local/schedule 分类。
- [ ] P2.2 建立统一 API 时间 serializer，禁止业务内部 Date/Temporal 往返。
- [ ] P2.3 前端 Web/Mobile 时间展示统一从 API ISO 值格式化。
- [ ] P2.4 existing DB UTC/时区历史数据 precheck。
- [ ] P2.5 对确认属于 absolute instant 的字段生成 forward migration，并验证旧数据转换。
- [ ] P2.6 删除无引用的 `prisma8-temporal` compatibility functions。

## P3 VarChar / ID 数据库治理

- [ ] P3.1 476 个 VarChar 字段按 ID/枚举协议/自由文本分类。
- [ ] P3.2 existing DB 长度与 ID 格式 precheck。
- [ ] P3.3 设计并生成保持等价约束的 forward migration。
- [ ] P3.4 逐批删除 `prisma8Varchar/prisma8Varchars/prisma8Id32` 调用。

## P4 Numeric / JSON domain 收口

- [ ] P4.1 Numeric 输入统一精确 decimal domain，不降级为浮点。
- [ ] P4.2 JSON 输入统一 JsonValue/DTO serializer。
- [ ] P4.3 删除无引用的 values compatibility helper。

## P5 Canonicalization 与最终验收

- [ ] P5.1 `Prisma8Client/Service/Module` 改为正式 canonical 名称。
- [ ] P5.2 删除 migration-only `prisma8*` 文件名和测试命名。
- [ ] P5.3 全量 typecheck/lint/build/API Rules。
- [ ] P5.4 existing/fresh PostgreSQL migration/seed/verify/status。
- [ ] P5.5 Docker release smoke。
- [ ] P5.6 Browser 代表性回归与 API runtime log 扫描。
- [ ] P5.7 文档封板为 `VERIFIED`。

## 当前执行指针

当前执行 **P1.2**。已建立薄层 `src/testing/prisma-test-db.ts`，只负责 Prisma 8 client lifecycle 与 tenant/user/department 等测试原语，不复制 Prisma 7 delegate API。

第一批已完成 native 化并通过真实 PostgreSQL：

- `src/prisma/prisma8.compat.test.ts`：CRUD / rollback / raw lane / service lifecycle；
- `src/auth/auth.prisma8.test.ts`：register / login / refresh / change password / LoginLog；
- `src/common/guards/auth.guard.prisma8.test.ts`：API Key + User/UserRole/Role；
- `src/common/services/business-change-log.prisma8.test.ts`：transaction + JSONB readback；
- `src/common/services/data-scope.prisma8.test.ts`；
- `src/common/services/scope-resolver.prisma8.test.ts`。

当前 native canary 合计 **8/8 PASS、0 skip**；API typecheck exit 0。通用 fixture facade 的 `createPrismaFixtureClient` 引用已从本阶段开始时的 **155** 降至 **149**，引用文件从 **76** 降至 **73**。下一批继续迁移个人中心 / message settings / home 等低耦合模块，再进入 Customers / Leads / Metadata / Pool。

