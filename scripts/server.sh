#!/usr/bin/env bash
# Operator tool — start / stop / status / logs / smoke / load. Run on the server.
# The stack lives in /mnt/data/gameforge/app and never touches other containers.
set -euo pipefail
APP_DIR="${GAMEFORGE_APP_DIR:-/mnt/data/gameforge/app}"
cd "$APP_DIR"

COMPOSE=(docker compose)

case "${1:-status}" in
  up)
    "${COMPOSE[@]}" up -d --build
    "${COMPOSE[@]}" ps
    ;;
  down)
    "${COMPOSE[@]}" down
    ;;
  restart)
    "${COMPOSE[@]}" restart
    ;;
  status)
    "${COMPOSE[@]}" ps
    echo "--- resource use ---"
    docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.PIDs}}' \
      gameforge-site gameforge-harness 2>/dev/null || true
    ;;
  logs)
    "${COMPOSE[@]}" logs --tail "${2:-120}" "${3:-harness}"
    ;;
  smoke)
    "${COMPOSE[@]}" exec -T site node scripts/smoke.mjs http://127.0.0.1:8787
    ;;
  load)
    "${COMPOSE[@]}" exec -T site node harness/loadtest.mjs
    ;;
  *)
    echo "usage: $0 {up|down|restart|status|logs [lines] [service]|smoke|load}" >&2
    exit 64
    ;;
esac
