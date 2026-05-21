#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[refresh] %s\n' "$1"
}

fail() {
  printf '[refresh] %s\n' "$1" >&2
  exit 1
}

require_file() {
  local path="$1"
  [[ -e "$path" ]] || fail "Missing required file: $path"
}

require_command() {
  local name="$1"
  command -v "$name" >/dev/null 2>&1 || fail "Missing required command: $name"
}

require_command docker
require_file "docker-compose.yml"

log "Rebuilding images without cache..."
docker compose build --no-cache

log "Recreating containers..."
docker compose up -d --force-recreate

log "Current container status:"
docker compose ps
