# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable \
  && corepack prepare pnpm@10.30.3 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

# API 只安装自身及 workspace 依赖（shared）。避免把 Web/Vite 依赖带入 API builder，
# 降低每个架构的下载量、node_modules 体积和 BuildKit 缓存体积。
RUN --mount=type=cache,id=pnpm-api,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter @micromatrix/api...

COPY packages/shared packages/shared
COPY apps/api apps/api

RUN --mount=type=cache,id=pnpm-api,target=/pnpm/store \
  pnpm --filter @micromatrix/shared build \
  && pnpm --filter @micromatrix/api build \
  && pnpm --config.inject-workspace-packages=true --filter @micromatrix/api --prod deploy /opt/micromatrix-api \
  && rm -f /opt/micromatrix-api/.env

FROM base AS runtime

ENV NODE_ENV=production
ENV PORT=3000
ENV UPLOAD_DIR=/app/uploads

WORKDIR /app

COPY --from=builder --chown=node:node /opt/micromatrix-api ./

RUN mkdir -p /app/uploads && chown node:node /app/uploads

USER node

EXPOSE 3000
VOLUME ["/app/uploads"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
