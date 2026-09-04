# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS base

RUN apk add --no-cache ca-certificates openssl

FROM base AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable \
  && corepack prepare pnpm@11.25.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/migrate/package.json packages/migrate/package.json

RUN --mount=type=cache,id=pnpm-migrate,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter @micromatrix/migrate --filter @micromatrix/api... \
  && pnpm --config.inject-workspace-packages=true --filter @micromatrix/migrate --prod deploy /opt/micromatrix-migrate

COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY apps/api/src/modules/metadata/system-fields.ts apps/api/src/modules/metadata/system-fields.ts

RUN export PATH=/workspace/packages/migrate/node_modules/.bin:$PATH \
  && cd apps/api \
  && prisma generate

FROM base AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder --chown=node:node /opt/micromatrix-migrate ./
COPY --from=builder --chown=node:node /workspace/apps/api/prisma ./prisma
COPY --from=builder --chown=node:node /workspace/apps/api/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=node:node /workspace/apps/api/src/generated ./src/generated
COPY --from=builder --chown=node:node /workspace/apps/api/src/modules/metadata/system-fields.ts ./src/modules/metadata/system-fields.ts
COPY --chown=node:node --chmod=755 docker/release-init.sh ./release-init.sh

USER node

ENTRYPOINT ["./release-init.sh"]
CMD ["init"]
