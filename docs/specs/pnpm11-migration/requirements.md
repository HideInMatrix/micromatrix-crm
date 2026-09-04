# TOOLCHAIN-001 pnpm 11 工具链迁移需求

## 1. 目标

将 MicroMatrix CRM 的包管理器从 pnpm `10.30.3` 统一迁移到 pnpm `11.25.0`，消除 GitHub Actions `pnpm/action-setup@v6` 先通过 npm 自举 pnpm 11、再切换回 pnpm 10 的冗余路径，同时保持本地开发、GitHub Actions、Docker builder 与 lockfile 使用同一 pnpm 主版本。

本执行单元编号固定为 `TOOLCHAIN-001`。本批只处理 pnpm 10 → 11 的工具链迁移及由此产生的配置兼容问题，不顺带升级 Node、Prisma、Nest、Vite、TypeScript 或其它业务依赖，也不跨到 pnpm 12。

## 2. 范围

### R1 版本基线

- 根 `package.json.packageManager` 固定为 `pnpm@11.25.0`。
- Node.js 基线继续保持仓库现有 `>=22`；GitHub Actions 与 Docker builder 继续使用 Node 24。
- 本地、CI、API Docker、Migration Docker、Web Docker 必须统一使用 pnpm `11.25.0`，不得继续存在生产构建路径写死 pnpm 10。
- pnpm 12 已发布但不属于本批范围；主版本升级必须独立验收，禁止连续跨两个 major。

### R2 pnpm 11 配置迁移

- `pnpm-workspace.yaml` 中已经废弃/移除的 `onlyBuiltDependencies` 必须迁移为 `allowBuilds` map。
- 现有允许执行依赖构建脚本的包集合保持不变，不因迁移扩大为 `dangerouslyAllowAllBuilds`。
- `.npmrc` 只保留 registry/auth 类配置；现有 pnpm 网络重试配置迁移到 `pnpm-workspace.yaml`。
- pnpm 11 的 `minimumReleaseAge=1440`、`blockExoticSubdeps=true`、`strictDepBuilds=true` 等安全默认值保持启用；除非真实依赖安装验证证明存在明确兼容问题，否则不得为了迁移便利整体关闭。

### R3 lockfile 与安装语义

- 使用 pnpm `11.25.0` 重新执行 workspace install，使 `pnpm-lock.yaml` 由目标版本正式接管。
- 迁移后的 `pnpm install --frozen-lockfile` 必须通过，作为 CI 可重复安装的最终契约。
- 不主动升级业务依赖版本；若 pnpm 11 因 lockfile 格式/元数据需要重写，应只接受工具链迁移所需差异。
- 依赖 build script 若未进入 `allowBuilds`，应由 pnpm 11 的严格策略直接暴露并逐项审计，不允许用全局放开脚本规避错误。

### R4 GitHub Actions

- `verify` job 不再使用 `pnpm/action-setup@v6`。
- 改用 `pnpm/setup@v2` 的 pnpm 11 自包含二进制安装路径，避免 npm bootstrap 与 pnpm self-update round-trip。
- CI 继续固定 Node 24；允许由 `pnpm/setup@v2` 同一步安装 Node runtime，并继续显式保留后续 `pnpm install --frozen-lockfile`，避免 action 隐式 install 与 workflow install 重复。
- pnpm store cache 必须继续存在；迁移后缓存实现不得依赖旧 `actions/setup-node cache=pnpm` 顺序假设。
- 仓库 `.npmrc` 继续服务本地国内开发的 `npmmirror` 默认 registry；GitHub hosted runner 的 `verify` job 必须通过 pnpm 11 的 `pnpm_config_registry=https://registry.npmjs.org` 显式使用官方 npm registry，避免海外 runner 反向访问国内镜像。

### R5 Docker 构建

- `docker/api.Dockerfile`、`docker/migrate.Dockerfile`、`docker/web.Dockerfile` 的 builder 全部切换到 pnpm `11.25.0`。
- 保留现有 multi-stage、BuildKit pnpm store cache、workspace filter/deploy 与 runtime slimming 语义。
- API runtime 仍需同时携带 `dist/main.js` 与 `dist/worker.js`；Migration/Web 镜像职责不因包管理器升级发生变化。
- pnpm 11 在 Node 24 Alpine builder 中必须通过真实 Docker build/smoke，而不能只依据宿主机安装成功推断兼容。

### R6 文档与历史边界

- 当前 Docker 发布设计、部署文档和项目进度中的“当前 pnpm 10”基线更新到 pnpm 11。
- 历史验收审计中记录“当时使用 pnpm 10.30.3”的内容继续保留，禁止为了当前版本统一而改写历史事实。
- alignment-log 必须记录本次迁移原因：`action-setup@v6` 的 npm bootstrap/self-update 路径在 verify source 中异常耗时。

### R7 验收

- `pnpm --version` 必须为 `11.25.0`。
- `pnpm install --frozen-lockfile` PASS。
- 全仓 `pnpm typecheck` PASS。
- `pnpm lint` 无 error。
- API `test:rules` PASS。
- 全仓 `pnpm build` PASS。
- `pnpm smoke:docker-release` PASS，证明三类镜像在 pnpm 11 下真实可构建并运行。
- Prettier、`git diff --check` PASS。

## 3. 本批明确不做

- 升级到 pnpm 12。
- 改 Node 24 主线到 Node 26。
- 升级 Prisma/Nest/Vite/TypeScript 或重新生成业务 migration。
- 清空 lockfile 后全量重新解析依赖版本。
- 关闭 pnpm 11 的供应链安全默认值来换取“安装能过”。

