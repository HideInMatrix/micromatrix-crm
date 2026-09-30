# syntax=docker/dockerfile:1.7

FROM node:25-alpine AS base

RUN apk add --no-cache ca-certificates openssl

FROM base AS builder

RUN npm install --global pnpm@11.25.0

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/migrate/package.json packages/migrate/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN --mount=type=cache,id=pnpm-migrate,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter @micromatrix/migrate...

COPY packages/shared packages/shared
COPY packages/migrate packages/migrate

COPY apps/api/migrations apps/api/migrations
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY apps/api/src/prisma/contract.prisma apps/api/src/prisma/contract.prisma
COPY apps/api/src/prisma/db.ts apps/api/src/prisma/db.ts
COPY apps/api/src/prisma/seed.ts apps/api/src/prisma/seed.ts
COPY apps/api/src/prisma/seed-bootstrap.ts apps/api/src/prisma/seed-bootstrap.ts
COPY apps/api/src/prisma/temporal.ts apps/api/src/prisma/temporal.ts
COPY apps/api/src/prisma/numeric-value.ts apps/api/src/prisma/numeric-value.ts
COPY apps/api/src/common/tenant-slug.ts apps/api/src/common/tenant-slug.ts

RUN --mount=type=cache,id=pnpm-migrate,target=/pnpm/store \
  pnpm --filter @micromatrix/shared build \
  && pnpm --config.inject-workspace-packages=true --filter @micromatrix/migrate --prod deploy /opt/micromatrix-migrate

FROM base AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder --chown=node:node /opt/micromatrix-migrate ./
COPY --from=builder --chown=node:node /workspace/apps/api/migrations ./migrations
COPY --from=builder --chown=node:node /workspace/apps/api/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=node:node /workspace/apps/api/src/prisma ./src/prisma
COPY --from=builder --chown=node:node /workspace/apps/api/src/common/tenant-slug.ts ./src/common/tenant-slug.ts
COPY --chown=node:node --chmod=755 docker/release-init.sh ./release-init.sh

RUN node ./prisma-orm.mjs contract emit

USER node

ENTRYPOINT ["./release-init.sh"]
CMD ["init"]
