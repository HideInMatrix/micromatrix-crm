# TOOLCHAIN-001 pnpm 11 工具链迁移设计

## 1. 迁移原因

当前 Release Docker workflow 的 `verify` job 使用：

```text
pnpm/action-setup@v6
  -> npm self-installer
  -> bootstrap pnpm 11.x
  -> 读取项目目标 pnpm 10.30.3
  -> self-update / switch 到 pnpm 10.30.3
```

现场 GitHub Actions 日志中 `added 1 package in 6m` 发生在 self-installer，而不是项目 `pnpm install`。因此继续固定 pnpm 10 会让新版 action 为兼容旧主版本执行一条多余的 npm bootstrap + pnpm downgrade 路径。

项目本身已经以 Node 24 为 CI/Docker 主线、根 engines 为 Node `>=22`，符合 pnpm 11 的运行要求。与其回退 GitHub Action 维持旧包管理器，更合理的长期方向是把整条工具链统一到 pnpm 11。

## 2. 目标版本

目标固定为：

```text
Node.js 24
pnpm 11.25.0
```

选择 11.25.0 是为了停留在 pnpm 11 当前稳定线，不在同一执行单元继续跨到 pnpm 12。

## 3. 配置迁移

### 3.1 build script allowlist

迁移前：

```yaml
onlyBuiltDependencies:
  - '@nestjs/core'
  - '@prisma/client'
  - '@prisma/engines'
  - '@swc/core'
  - esbuild
  - prisma
  - unrs-resolver
```

迁移后：

```yaml
allowBuilds:
  '@nestjs/core': true
  '@prisma/client': true
  '@prisma/engines': true
  '@scarf/scarf': false
  '@swc/core': true
  esbuild: true
  msgpackr-extract: false
  prisma: true
  unrs-resolver: true
  vue-demi: false
```

pnpm 11 默认 `strictDepBuilds=true`，因此未列入 allowlist 的新依赖 build script 会直接失败。这是期望的供应链保护，不做全局放开。

首次 pnpm 11 install 已实际暴露 3 个 pnpm 10 时代未在 `onlyBuiltDependencies` 中的脚本：

- `@scarf/scarf`：postinstall 上报脚本，显式 `false`。
- `msgpackr-extract`：可选 native acceleration install，历史未放行，显式 `false`，由 build/runtime smoke 验证无回归。
- `vue-demi`：postinstall 版本切换脚本，历史未放行，显式 `false`，由 Web build 验证当前 Vue 3 依赖图可用。

这样把 pnpm 10 的“未列入即不执行”行为转换为 pnpm 11 可审计的显式 allow/deny map，而不是为了通过 `strictDepBuilds` 扩大执行权限。

### 3.2 `.npmrc` 与 workspace settings

`.npmrc` 继续保存：

```ini
registry=https://registry.npmmirror.com
```

原有：

```ini
fetch-retries=5
fetch-retry-maxtimeout=120000
```

迁移到 `pnpm-workspace.yaml`：

```yaml
fetchRetries: 5
fetchRetryMaxtimeout: 120000
```

这样符合 pnpm 11 将 registry/auth 与 pnpm-specific settings 分离的配置模型。

## 4. GitHub Actions

`verify` 的两步：

```text
pnpm/action-setup@v6
actions/setup-node@v7
```

收口为：

```yaml
- name: Setup pnpm and Node.js
  uses: pnpm/setup@v2
  with:
    version: 11.25.0
    runtime: node@24
    cache: true
    install: false
```

`install: false` 用于保持 workflow 后续显式：

```bash
pnpm install --frozen-lockfile
```

因此职责仍清晰：setup 只准备 pnpm/Node/cache，依赖安装继续作为独立可观测步骤。

`pnpm/setup@v2` 直接下载 pnpm 11 的自包含 release binary，不经过 Node/npm，也没有 pnpm self-update round-trip，从根因上移除本次 6 分钟 self-installer 路径。

仓库根 `.npmrc` 仍为国内本地开发保留 `npmmirror`，但 GitHub hosted runner 不应反向走国内镜像。`verify` job 因此额外设置：

```yaml
env:
  pnpm_config_registry: https://registry.npmjs.org
```

pnpm 11 使用 `pnpm_config_*` 环境变量覆盖 pnpm-specific/runtime 配置。这样本地默认网络策略不被 CI 需求污染，GitHub runner 也不会因跨区 registry 放大下载延迟。

## 5. Docker

三类 builder 继续使用 Node 24 Alpine 和 Corepack，只将固定版本切换到 `11.25.0`。不在本批重构 Dockerfile 安装器形态，原因是：

1. 当前 Corepack builder 路径已稳定通过 multi-arch release smoke；
2. 本批核心目标是统一 pnpm major，而不是同时重构 Docker tool bootstrap；
3. 使用相同 pnpm 11 lockfile 执行 frozen install/deploy 即可验证兼容。

Docker 中仍必须保留现有 pnpm store cache mount 与 workspace filter，避免因升级退化构建性能。

## 6. lockfile 策略

迁移过程不执行依赖版本升级命令。流程固定为：

```text
修改 packageManager / workspace config
  -> 使用 pnpm 11.25.0 执行 pnpm install
  -> 审核 pnpm-lock.yaml 工具链迁移差异
  -> pnpm install --frozen-lockfile 二次验证
```

若 pnpm 11 因安全默认值拒绝某个依赖，先确认该依赖是否确实需要 install script，再按包名加入 `allowBuilds`；禁止改为 `dangerouslyAllowAllBuilds=true`。

## 7. 回滚边界

如果 pnpm 11 无法通过 Docker release smoke，本执行单元不提交半迁移状态。回滚必须同时恢复：

```text
packageManager
pnpm-workspace.yaml
pnpm-lock.yaml
GitHub Actions
三个 Dockerfile
```

不能只把 CI action 改回去而留下 pnpm 11 lockfile，也不能只恢复 packageManager 而让 Docker builder 保持 pnpm 11。

