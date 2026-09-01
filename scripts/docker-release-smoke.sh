#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:${PATH}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUFFIX="${RANDOM}-$$"
NETWORK="mmx-release-smoke-${SUFFIX}"
POSTGRES_CONTAINER="mmx-release-postgres-${SUFFIX}"
API_CONTAINER="mmx-release-api-${SUFFIX}"
WEB_CONTAINER="mmx-release-web-${SUFFIX}"
API_IMAGE="micromatrix-crm-api:release-smoke"
WEB_IMAGE="micromatrix-crm-web:release-smoke"

cleanup() {
  docker rm -f "$WEB_CONTAINER" "$API_CONTAINER" "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cd "$ROOT_DIR"

echo '[docker-release] validating Web multi-platform build strategy'
grep -Fq 'FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS builder' docker/web.Dockerfile
grep -Fq 'pnpm install --frozen-lockfile --filter @micromatrix/web...' docker/web.Dockerfile
if grep -Fq 'COPY apps/api/package.json apps/api/package.json' docker/web.Dockerfile; then
  echo '[docker-release] Web image must not install API workspace dependencies' >&2
  exit 1
fi

echo '[docker-release] building API image'
docker build -f docker/api.Dockerfile -t "$API_IMAGE" .

echo '[docker-release] building Web image'
docker build -f docker/web.Dockerfile -t "$WEB_IMAGE" .

docker network create "$NETWORK" >/dev/null
docker run -d \
  --name "$POSTGRES_CONTAINER" \
  --network "$NETWORK" \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=default \
  postgres:18-alpine >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$POSTGRES_CONTAINER" pg_isready -U postgres -d default >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$POSTGRES_CONTAINER" pg_isready -U postgres -d default >/dev/null

DATABASE_URL="postgresql://postgres:postgres@${POSTGRES_CONTAINER}:5432/default?schema=public"

echo '[docker-release] applying Prisma migrations from API image'
docker run --rm "$API_IMAGE" sh -c 'test ! -f /app/.env'
docker run --rm \
  --network "$NETWORK" \
  -e NODE_ENV=production \
  -e DATABASE_URL="$DATABASE_URL" \
  "$API_IMAGE" \
  ./node_modules/.bin/prisma migrate deploy

echo '[docker-release] starting API image'
docker run -d \
  --name "$API_CONTAINER" \
  --network "$NETWORK" \
  -e NODE_ENV=production \
  -e DATABASE_URL="$DATABASE_URL" \
  -e JWT_ACCESS_SECRET=release_smoke_access_secret_change_me \
  -e JWT_REFRESH_SECRET=release_smoke_refresh_secret_change_me \
  -e INTEGRATION_CREDENTIALS_KEY=release_smoke_integration_credentials_key_32_chars \
  -e WEB_PUBLIC_URL=http://localhost \
  "$API_IMAGE" >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$API_CONTAINER" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    break
  fi
  sleep 1
done
docker exec "$API_CONTAINER" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

echo '[docker-release] starting Web image'
docker run -d \
  --name "$WEB_CONTAINER" \
  --network "$NETWORK" \
  -e API_UPSTREAM="http://${API_CONTAINER}:3000" \
  "$WEB_IMAGE" >/dev/null

for _ in $(seq 1 20); do
  if docker exec "$WEB_CONTAINER" wget -q --spider http://127.0.0.1/healthz; then
    break
  fi
  sleep 1
done

docker exec "$WEB_CONTAINER" wget -qO- http://127.0.0.1/healthz | grep -q '^ok'
docker exec "$WEB_CONTAINER" wget -qO- http://127.0.0.1/api/health | grep -q 'ok'
docker exec "$WEB_CONTAINER" wget -qO- http://127.0.0.1/login | grep -q '<div id="app">'

echo '[docker-release] PASS: API runtime, Prisma migration, Nginx SPA fallback and /api proxy are healthy'
