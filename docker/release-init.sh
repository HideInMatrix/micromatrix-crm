#!/bin/sh
set -eu

run_migrate() {
  ./node_modules/.bin/prisma migrate deploy
}

run_legacy_sync() {
  echo 'Legacy schema sync: applying current Prisma schema with prisma db push'
  ./node_modules/.bin/prisma db push
}

run_seed() {
  SEED_MODE=bootstrap ./node_modules/.bin/tsx prisma/seed.ts
}

case "${1:-init}" in
  init)
    run_migrate
    run_seed
    ;;
  migrate)
    run_migrate
    ;;
  legacy-sync)
    run_legacy_sync
    ;;
  seed)
    run_seed
    ;;
  *)
    exec "$@"
    ;;
esac
