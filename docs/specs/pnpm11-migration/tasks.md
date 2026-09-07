# TOOLCHAIN-001 pnpm 11 工具链迁移任务

- [x] T1 现场审计与规格冻结
  - 确认项目 Node 基线满足 pnpm 11 的 Node 22+ 要求。
  - 确认当前 pnpm 10 固定点：packageManager、3 个 Dockerfile、Release workflow。
  - 确认 `onlyBuiltDependencies` 与 `.npmrc` 网络配置需要迁移。
  - 冻结目标为 pnpm `11.25.0`，不跨 pnpm 12。

- [x] T2 workspace 配置与 lockfile
  - 根 packageManager 切换到 `pnpm@11.25.0`。
  - `onlyBuiltDependencies` → `allowBuilds`。
  - 首次 strict install 暴露的 Scarf/msgpackr-extract/vue-demi 维持历史不执行语义并显式 deny。
  - pnpm-specific 网络设置从 `.npmrc` 迁到 `pnpm-workspace.yaml`。
  - 使用 pnpm 11 install 并审核 lockfile。
  - frozen install 二次验证。

- [x] T3 CI 工具链
  - `pnpm/action-setup@v6` → `pnpm/setup@v2`。
  - 同一步固定 pnpm 11.25.0 + Node 24。
  - cache 保留，setup 禁止隐式 install。
  - GitHub hosted runner 显式使用官方 npm registry，本地 `.npmrc` 继续保留 npmmirror。

- [x] T4 Docker builder
  - API/Migration/Web builder 全部切换 pnpm 11.25.0。
  - 保留 BuildKit store cache 与现有 deploy/filter 语义。

- [x] T5 全量验收
  - pnpm version / frozen install。
  - 全仓 typecheck。
  - lint。
  - API Rules。
  - 全仓 build。
  - Docker release smoke。
  - Prettier / `git diff --check`。

- [x] T6 文档封板
  - 更新 Docker release 当前设计与部署说明。
  - 更新 project-progress 当前工具链基线。
  - 更新 alignment-log。
  - T2～T5 全绿后标记 `TOOLCHAIN-001 VERIFIED`。

## 最终验收记录（2026-09-07）

- pnpm：`11.25.0`；Node：`v24.5.0`；根 `packageManager=pnpm@11.25.0`。
- `pnpm install --frozen-lockfile`：PASS，lockfile 无需更新。
- root `pnpm typecheck`：PASS。
- root `pnpm lint`：`0 error / 8 个既有 warning`。
- API Rules：`227/227 PASS`。
- root `pnpm build`：PASS，PC Web 与 Mobile production build 均成功。
- `pnpm smoke:docker-release`：PASS；API/Migration/Web 三镜像真实构建，fresh PostgreSQL 应用唯一 `20260905084900_baseline`，Migration bootstrap Seed、Worker、Redis cache、管理员改密缓存失效、重复初始化保护、API/Nginx、PC `/login`、Mobile `/mobile/` 与深层 SPA fallback、`/api` proxy 全绿。
- Migration 镜像 Seed 的 `@micromatrix/shared` production runtime 依赖已在前置修复中纳入 `@micromatrix/migrate`，本轮完整 Docker Smoke 再次证明 migration + bootstrap 可重复执行。
- TOOLCHAIN-001 与 Docker release 相关文档 Prettier、`docker/release-smoke.sh` / `docker/release-init.sh` Shell syntax、`git diff --check`：PASS。

当前状态：**VERIFIED**。
