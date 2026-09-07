#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:${PATH}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUFFIX="${RANDOM}-$$"
NETWORK="mmx-release-smoke-${SUFFIX}"
POSTGRES_CONTAINER="mmx-release-postgres-${SUFFIX}"
REDIS_CONTAINER="mmx-release-redis-${SUFFIX}"
API_CONTAINER="mmx-release-api-${SUFFIX}"
WORKER_CONTAINER="mmx-release-worker-${SUFFIX}"
WEB_CONTAINER="mmx-release-web-${SUFFIX}"
API_IMAGE="micromatrix-crm-api:release-smoke"
MIGRATE_IMAGE="micromatrix-crm-migrate:release-smoke"
WEB_IMAGE="micromatrix-crm-web:release-smoke"
REDIS_PASSWORD="release_smoke_redis_password"

cleanup() {
  docker rm -f "$WEB_CONTAINER" "$WORKER_CONTAINER" "$API_CONTAINER" "$REDIS_CONTAINER" "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cd "$ROOT_DIR"

echo '[docker-release] validating Web multi-platform build strategy'
grep -Fq 'FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS builder' docker/web.Dockerfile
grep -Fq 'pnpm install --frozen-lockfile --filter @micromatrix/web...' docker/web.Dockerfile
grep -Fq -- '--filter @micromatrix/mobile...' docker/web.Dockerfile
grep -Fq 'COPY --from=builder /workspace/apps/mobile/dist /usr/share/nginx/html/mobile' docker/web.Dockerfile
if grep -Fq 'COPY apps/api/package.json apps/api/package.json' docker/web.Dockerfile; then
  echo '[docker-release] Web image must not install API workspace dependencies' >&2
  exit 1
fi

echo '[docker-release] validating API workspace dependency scope'
grep -Fq 'FROM node:24-alpine AS base' docker/api.Dockerfile
grep -Fq 'pnpm install --frozen-lockfile --filter @micromatrix/migrate --filter @micromatrix/api...' docker/api.Dockerfile
grep -Fq 'pnpm --config.inject-workspace-packages=true --filter @micromatrix/api --prod --no-optional deploy' docker/api.Dockerfile
if grep -Fq 'COPY apps/web/package.json apps/web/package.json' docker/api.Dockerfile; then
  echo '[docker-release] API image must not install Web workspace dependencies' >&2
  exit 1
fi
if grep -Fq ' deploy --prod --legacy ' docker/api.Dockerfile; then
  echo '[docker-release] API image must use pnpm dedicated-lockfile deploy instead of legacy deploy' >&2
  exit 1
fi

echo '[docker-release] validating migration image isolation'
grep -Fq 'FROM node:24-alpine AS base' docker/migrate.Dockerfile
grep -Fq 'pnpm install --frozen-lockfile --filter @micromatrix/migrate --filter @micromatrix/api...' docker/migrate.Dockerfile
grep -Fq 'ENTRYPOINT ["./release-init.sh"]' docker/migrate.Dockerfile

echo '[docker-release] building API image'
docker build -f docker/api.Dockerfile -t "$API_IMAGE" .

echo '[docker-release] building migration image'
docker build -f docker/migrate.Dockerfile -t "$MIGRATE_IMAGE" .

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

docker run -d \
  --name "$REDIS_CONTAINER" \
  --network "$NETWORK" \
  redis:7-alpine \
  redis-server --appendonly yes --requirepass "$REDIS_PASSWORD" >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$REDIS_CONTAINER" redis-cli -a "$REDIS_PASSWORD" ping 2>/dev/null | grep -q '^PONG$'; then
    break
  fi
  sleep 1
done
docker exec "$REDIS_CONTAINER" redis-cli -a "$REDIS_PASSWORD" ping 2>/dev/null | grep -q '^PONG$'

DATABASE_URL="postgresql://postgres:postgres@${POSTGRES_CONTAINER}:5432/default?schema=public"

echo '[docker-release] validating API runtime excludes build/migration tooling and includes both runtime entries'
docker run --rm --entrypoint sh "$API_IMAGE" -c 'test ! -f /app/.env && test ! -e /app/node_modules/.bin/prisma && test -f /app/dist/main.js && test -f /app/dist/worker.js'

echo '[docker-release] applying Prisma migrations and bootstrap data from initialization image'
docker run --rm --entrypoint sh "$MIGRATE_IMAGE" -c 'test ! -f /app/.env && test -x /app/node_modules/.bin/prisma && test -x /app/node_modules/.bin/tsx'
docker run --rm \
  --network "$NETWORK" \
  -e NODE_ENV=production \
  -e DATABASE_URL="$DATABASE_URL" \
  "$MIGRATE_IMAGE"

echo '[docker-release] starting worker entry from API image'
docker run -d \
  --name "$WORKER_CONTAINER" \
  --network "$NETWORK" \
  -e NODE_ENV=production \
  -e DATABASE_URL="$DATABASE_URL" \
  -e JWT_ACCESS_SECRET=release_smoke_access_secret_change_me \
  -e JWT_REFRESH_SECRET=release_smoke_refresh_secret_change_me \
  -e INTEGRATION_CREDENTIALS_KEY=release_smoke_integration_credentials_key_32_chars \
  -e WEB_PUBLIC_URL=http://localhost \
  -e REDIS_HOST="$REDIS_CONTAINER" \
  -e REDIS_PORT=6379 \
  -e REDIS_PASSWORD="$REDIS_PASSWORD" \
  -e REDIS_DB=0 \
  "$API_IMAGE" node dist/worker.js >/dev/null

for _ in $(seq 1 30); do
  if docker logs "$WORKER_CONTAINER" 2>&1 | grep -q 'MicroMatrix async export worker ready'; then
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$WORKER_CONTAINER")" != 'true' ]; then
    docker logs "$WORKER_CONTAINER" >&2
    exit 1
  fi
  sleep 1
done
docker logs "$WORKER_CONTAINER" 2>&1 | grep -q 'MicroMatrix async export worker ready'
test "$(docker inspect -f '{{.State.Running}}' "$WORKER_CONTAINER")" = 'true'

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
  -e REDIS_HOST="$REDIS_CONTAINER" \
  -e REDIS_PORT=6379 \
  -e REDIS_PASSWORD="$REDIS_PASSWORD" \
  -e REDIS_DB=0 \
  "$API_IMAGE" >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$API_CONTAINER" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    break
  fi
  sleep 1
done
docker exec "$API_CONTAINER" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

echo '[docker-release] validating bootstrap administrator login and Redis-backed read caches'
auth_identity="$(docker exec "$API_CONTAINER" node -e "(async()=>{const login=await fetch('http://127.0.0.1:3000/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@demo.com',password:'admin123'})});if(!login.ok)process.exit(1);const body=await login.json();const payload=JSON.parse(Buffer.from(body.accessToken.split('.')[1],'base64url').toString('utf8'));const headers={authorization:'Bearer '+body.accessToken};const me=await fetch('http://127.0.0.1:3000/api/auth/me',{headers});const unread=await fetch('http://127.0.0.1:3000/api/notifications/unread-count',{headers});if(!me.ok||!unread.ok)process.exit(1);console.log(payload.sub+' '+payload.tenantId)})().catch(e=>{console.error(e);process.exit(1)})")"
read -r auth_user_id auth_tenant_id <<< "$auth_identity"
test "$(docker exec "$REDIS_CONTAINER" redis-cli -a "$REDIS_PASSWORD" EXISTS "micromatrix-crm:auth:context:${auth_user_id}" 2>/dev/null)" = '1'
test "$(docker exec "$REDIS_CONTAINER" redis-cli -a "$REDIS_PASSWORD" EXISTS "micromatrix-crm:notifications:unread:${auth_tenant_id}:${auth_user_id}:v0" 2>/dev/null)" = '1'

echo '[docker-release] validating repeated initialization does not reset administrator password'
docker exec "$API_CONTAINER" node -e "(async()=>{const login=await fetch('http://127.0.0.1:3000/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@demo.com',password:'admin123'})});if(!login.ok)process.exit(1);const body=await login.json();const changed=await fetch('http://127.0.0.1:3000/api/auth/change-password',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+body.accessToken},body:JSON.stringify({oldPassword:'admin123',newPassword:'release456'})});if(!changed.ok){console.error(await changed.text());process.exit(1)}})().catch(e=>{console.error(e);process.exit(1)})"
test "$(docker exec "$REDIS_CONTAINER" redis-cli -a "$REDIS_PASSWORD" EXISTS "micromatrix-crm:auth:context:${auth_user_id}" 2>/dev/null)" = '0'
repeat_init_output="$(docker run --rm \
  --network "$NETWORK" \
  -e NODE_ENV=production \
  -e DATABASE_URL="$DATABASE_URL" \
  "$MIGRATE_IMAGE")"
printf '%s\n' "$repeat_init_output"
grep -q 'Bootstrap 跳过：检测到' <<< "$repeat_init_output"
docker exec "$API_CONTAINER" node -e "(async()=>{const fresh=await fetch('http://127.0.0.1:3000/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@demo.com',password:'release456'})});const old=await fetch('http://127.0.0.1:3000/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@demo.com',password:'admin123'})});if(!fresh.ok||old.ok)process.exit(1)})().catch(e=>{console.error(e);process.exit(1)})"

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
docker exec "$WEB_CONTAINER" wget -qO- http://127.0.0.1/mobile/ | grep -q '<div id="app">'
docker exec "$WEB_CONTAINER" wget -qO- http://127.0.0.1/mobile/customers/detail | grep -q '<div id="app">'

echo '[docker-release] PASS: slim API/worker runtime, Redis cache integration, automatic bootstrap initialization, PC/Mobile SPA fallback and /api proxy are healthy'
