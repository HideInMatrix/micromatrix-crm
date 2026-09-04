# syntax=docker/dockerfile:1.7

# Web 产物是与 CPU 架构无关的静态文件。
# 多架构镜像构建时固定在 BuildKit 原生平台执行 Node/Vite，避免在
# GitHub x64 runner 上通过 QEMU 执行 arm64 Node 导致 transforming 阶段极慢。
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

# Web 只需要自身及 workspace 依赖（shared）。不要安装 API/Prisma 依赖，
# 可明显降低 CI 下载量与多架构构建缓存体积。
RUN pnpm install --frozen-lockfile --filter @micromatrix/web...

COPY packages/shared packages/shared
COPY apps/web apps/web

RUN pnpm --filter @micromatrix/web build

FROM nginx:1.29-alpine AS runtime

ENV API_UPSTREAM=http://api:3000

COPY docker/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /workspace/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/healthz || exit 1
