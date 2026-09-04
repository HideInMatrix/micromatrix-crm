# TOOLCHAIN-001 pnpm 11 工具链迁移任务

- [x] T1 现场审计与规格冻结
  - 确认项目 Node 基线满足 pnpm 11 的 Node 22+ 要求。
  - 确认当前 pnpm 10 固定点：packageManager、3 个 Dockerfile、Release workflow。
  - 确认 `onlyBuiltDependencies` 与 `.npmrc` 网络配置需要迁移。
  - 冻结目标为 pnpm `11.25.0`，不跨 pnpm 12。

- [ ] T2 workspace 配置与 lockfile
  - 根 packageManager 切换到 `pnpm@11.25.0`。
  - `onlyBuiltDependencies` → `allowBuilds`。
  - 首次 strict install 暴露的 Scarf/msgpackr-extract/vue-demi 维持历史不执行语义并显式 deny。
  - pnpm-specific 网络设置从 `.npmrc` 迁到 `pnpm-workspace.yaml`。
  - 使用 pnpm 11 install 并审核 lockfile。
  - frozen install 二次验证。

- [ ] T3 CI 工具链
  - `pnpm/action-setup@v6` → `pnpm/setup@v2`。
  - 同一步固定 pnpm 11.25.0 + Node 24。
  - cache 保留，setup 禁止隐式 install。
  - GitHub hosted runner 显式使用官方 npm registry，本地 `.npmrc` 继续保留 npmmirror。

- [ ] T4 Docker builder
  - API/Migration/Web builder 全部切换 pnpm 11.25.0。
  - 保留 BuildKit store cache 与现有 deploy/filter 语义。

- [ ] T5 全量验收
  - pnpm version / frozen install。
  - 全仓 typecheck。
  - lint。
  - API Rules。
  - 全仓 build。
  - Docker release smoke。
  - Prettier / `git diff --check`。

- [ ] T6 文档封板
  - 更新 Docker release 当前设计与部署说明。
  - 更新 project-progress 当前工具链基线。
  - 更新 alignment-log。
  - T2～T5 全绿后标记 `TOOLCHAIN-001 VERIFIED`。

当前状态：**IN_PROGRESS**。

