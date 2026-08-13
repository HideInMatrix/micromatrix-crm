# 微矩阵 CRM（MicroMatrix CRM）

参照 [CordysCRM](https://github.com/1Panel-dev/CordysCRM) 社区版功能自主实现的开源风格 CRM（仅参考功能设计，未使用其代码）。当前定位公司内部使用，架构按多租户 SaaS 设计，未来可直接商业化。

## 功能清单

- **L2C 销售全流程**：线索（线索池/领取/分配/一键转化）→ 客户（公海/团队协作/联系人）→ 商机（可配置阶段/看板/赢单输单）→ 产品 → 报价（明细行）→ 合同（回款计划/回款记录/工商抬头/发票）→ 订单（履约状态机）
- **元数据引擎**：全对象自定义字段（17 种字段类型含计算字段公式）、表单设计器（拖拽排序/栅格布局/选项配置）、动态列表列、JSONB 高级筛选
- **可配置审批流**：按对象配置多级节点（指定成员/角色/部门主管/直属上级，会签/或签）、金额触发条件、审批中心（待办/已办/我发起）、通过自动生效业务、挂接报价/合同/订单/回款
- **标讯**：数据源适配器框架（内置演示源，商业源可插拔）、关键词订阅、每日定时抓取去重、一键转线索、手动录入兜底
- **组织与权限**：部门树、成员管理、角色（菜单/操作权限 + 5 级数据范围）、操作/登录日志
- **协同**：跟进记录（贯穿线索/客户/商机/合同）、站内通知（SSE 实时推送）、公海/线索池自动回收（超期未跟进回收+提前提醒）、回款到期提醒
- **工作台与报表**：销售简报、待办、商机漏斗、业绩排行、趋势/转化率/输单原因（ECharts 自建，替代 DataEase 企业版嵌入）
- **移动端 H5**：工作台简报、线索（领取/跟进/新建）、客户（跟进/新建）、移动审批（Vant + 移动版动态表单）
- **其他**：CSV 导入导出（客户/线索）、开放 API（Swagger 文档 + 365 天 API 令牌）

明确排除（对应 Cordys 付费/企业版能力）：DataEase 嵌入式 BI、SQLBot/MaxKB/WorkBuddy 等 AI 组件、CRM Skills/MCP、SaaS 计费（表结构已预留未启用）。

## 技术栈

| 层 | 选型 |
| --- | --- |
| Web 管理端 | Vue 3 + TypeScript + Vite + Element Plus + UnoCSS（presetWind4）+ ECharts |
| 移动端 H5 | Vue 3 + Vant 4 + UnoCSS |
| 后端 API | NestJS 11 + Prisma 7（驱动适配器）+ PostgreSQL 18 + Redis |
| 认证 | JWT（access + refresh）+ RBAC + 数据范围 |
| 工程 | pnpm workspace monorepo + TypeScript 6 + ESLint 9 |

> UnoCSS 使用 `presetWind4`（Tailwind v4 兼容语法），无需也不应同时安装 `tailwindcss`。

## 目录结构

```
micromatrix-crm/
├── apps/
│   ├── api/          # NestJS 后端（模块：auth/customers + modules/* 14 个业务模块）
│   ├── web/          # Web 管理端（表单引擎在 src/components/form-engine）
│   └── mobile/       # 移动端 H5
├── packages/shared/  # 前后端共享类型、权限树、公式求值器
├── scripts/smoke.mjs # 全链路冒烟脚本
└── docker-compose.yml
```

## 快速开始

前置要求：Node ≥ 22（建议 22/24 LTS）、pnpm ≥ 10、Docker。

```bash
pnpm install
docker compose up -d                                # PostgreSQL 18 + Redis
cp apps/api/.env.example apps/api/.env              # 首次
pnpm --filter @micromatrix/shared build
pnpm --filter @micromatrix/api exec prisma migrate dev
pnpm --filter @micromatrix/api run db:seed          # 演示数据
pnpm dev                                            # api:3000 / web:5173 / mobile:5174
```

- Web 管理端 http://localhost:5173 · 移动端 http://localhost:5174 · API 文档 http://localhost:3000/api/docs
- 全链路冒烟：`pnpm smoke`（需 API 已启动）

### 演示账号

| 账号 | 密码 | 角色 | 数据范围 |
| --- | --- | --- | --- |
| admin@demo.com | admin123 | 管理员 | 全部数据 |
| zhangwei@demo.com | demo123 | 销售主管 | 本部门及下级 |
| lina@demo.com | demo123 | 销售专员 | 仅本人 |
| wangqiang@demo.com | demo123 | 销售专员 | 仅本人 |

## 架构约定

- **多租户**：除 `plans` 外所有业务表带 `tenantId`，查询必须显式过滤；商业化时开放注册即可
- **数据范围**：业务表带 `ownerId` + `deptId`，查询统一合并 `DataScopeService.scopeFilter()`
- **自定义字段**：固定核心列 + `customData` JSONB，`FieldDefinition` 驱动三端动态渲染；系统字段不可删
- **审批挂接**：启用审批流后，业务对象的直接生效操作被拦截，必须提审；通过后自动生效
- **标讯适配器**：实现 `BiddingProvider` 接口并在 `BiddingService` 注册即可接入商业数据源（需数据源 API 账号）

## Roadmap / 待接入

- [ ] 商业标讯数据源（剑鱼/千里马等，等 API 账号）
- [ ] BullMQ 重任务队列（大批量导入导出，Redis 已就绪）
- [ ] 附件上传（跟进/合同，`attachments` 表已预留）
- [ ] PostgreSQL RLS 强制租户隔离（商业化前）
- [ ] 钉钉/企微/飞书集成
