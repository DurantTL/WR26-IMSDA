#!/bin/bash
# IMSDA Registration PWA — Docker deploy script.
#
# This builds pwa-server/.env from configuration, then (re)builds and starts the
# Docker Compose stack. Secrets are NOT hardcoded here so this file is safe to
# commit. Provide them one of two ways:
#
#   1. A gitignored "deploy.secrets" file next to this script (recommended).
#      Copy deploy.secrets.example to deploy.secrets and fill it in:
#        cp deploy.secrets.example deploy.secrets && nano deploy.secrets
#
#   2. Real environment variables already exported in the shell / host panel
#      (e.g. XCloud "Environment Variables"). deploy.secrets, if present, wins.
#
# Required secrets:  WR26_GAS_SECRET, SESSION_SECRET, WR26_AUTH_USERS
# Optional:          SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_NOTIFICATION_URL
#
# To add/replace a PWA login without editing JSON by hand, use:
#   node pwa-server/add-user.js --user <name> --role admin
# (or, once running:  docker compose exec imsda-registration node add-user.js ...)

set -euo pipefail

# Resolve to the repo root (directory containing this script) so the script works
# regardless of the caller's working directory. Honors PROJECT_DIR if it's set.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$SCRIPT_DIR}"

echo "Starting IMSDA Registration Docker deployment..."
echo "PROJECT_DIR is: $PROJECT_DIR"
cd "$PROJECT_DIR"

# Load secrets from deploy.secrets if present (it is gitignored). Existing
# environment variables are NOT overwritten — exported env wins over the file
# only if you 'export' before running; otherwise the file provides the values.
if [ -f deploy.secrets ]; then
  echo "Loading secrets from deploy.secrets..."
  set -a
  # shellcheck disable=SC1091
  . ./deploy.secrets
  set +a
fi

# Fail loudly if a required secret is missing, instead of deploying a broken app.
missing=0
for var in WR26_GAS_SECRET SESSION_SECRET WR26_AUTH_USERS; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: required secret '$var' is not set (deploy.secrets or environment)." >&2
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  echo "Aborting. Copy deploy.secrets.example to deploy.secrets and fill it in." >&2
  exit 1
fi

# Non-secret configuration — sane defaults, override via environment if needed.
NODE_ENV="${NODE_ENV:-production}"
PORT="${PORT:-3001}"
WR26_GAS_URL="${WR26_GAS_URL:-https://script.google.com/macros/s/AKfycbzntEUAZD94jBJQN-mqPFKy9_NZVR5AqSc4eBWOe1Ww8kGjhaGqKJT6tN8oJEJSvFdY-w/exec}"
PWA_SYNC_INTERVAL_MS="${PWA_SYNC_INTERVAL_MS:-60000}"
SYNC_MIN_REGISTRATIONS="${SYNC_MIN_REGISTRATIONS:-1}"
TRUST_PROXY="${TRUST_PROXY:-1}"
SQUARE_WEBHOOK_SIGNATURE_KEY="${SQUARE_WEBHOOK_SIGNATURE_KEY:-}"
SQUARE_WEBHOOK_NOTIFICATION_URL="${SQUARE_WEBHOOK_NOTIFICATION_URL:-}"

echo "Writing pwa-server/.env..."
# Note: the heredoc delimiter is quoted ('ENV') so the shell does NOT expand $ or
# backticks — important because the bcrypt hashes inside WR26_AUTH_USERS contain
# literal '$' characters. Values are substituted via a leading export below.
{
  printf 'NODE_ENV=%s\n' "$NODE_ENV"
  printf 'PORT=%s\n' "$PORT"
  printf 'WR26_GAS_URL=%s\n' "$WR26_GAS_URL"
  printf 'WR26_GAS_SECRET=%s\n' "$WR26_GAS_SECRET"
  printf 'SESSION_SECRET=%s\n' "$SESSION_SECRET"
  printf 'PWA_SYNC_INTERVAL_MS=%s\n' "$PWA_SYNC_INTERVAL_MS"
  printf 'SYNC_MIN_REGISTRATIONS=%s\n' "$SYNC_MIN_REGISTRATIONS"
  printf 'TRUST_PROXY=%s\n' "$TRUST_PROXY"
  # Single-quote the JSON so the '$' in bcrypt hashes is never shell/Compose
  # expanded. server.js strips these surrounding quotes when it parses the value.
  printf "WR26_AUTH_USERS='%s'\n" "$WR26_AUTH_USERS"
  printf 'SQUARE_WEBHOOK_SIGNATURE_KEY=%s\n' "$SQUARE_WEBHOOK_SIGNATURE_KEY"
  printf 'SQUARE_WEBHOOK_NOTIFICATION_URL=%s\n' "$SQUARE_WEBHOOK_NOTIFICATION_URL"
} > pwa-server/.env

echo "Confirming env file exists:"
ls -la pwa-server/.env

echo "Validating Docker Compose config..."
docker compose config >/dev/null

echo "Stopping old containers..."
docker compose down --remove-orphans

echo "Building and starting containers..."
docker compose up -d --build --force-recreate --remove-orphans

echo "Running containers:"
docker compose ps

# Give the container a moment, then surface health so a broken deploy is obvious
# here rather than only when someone fails to log in.
echo "Waiting for health check..."
for i in $(seq 1 20); do
  status="$(docker inspect --format '{{.State.Health.Status}}' imsda-registration 2>/dev/null || echo unknown)"
  if [ "$status" = "healthy" ]; then
    echo "Container is healthy."
    break
  fi
  if [ "$i" -eq 20 ]; then
    echo "WARNING: container did not report healthy in time. Recent logs:" >&2
    docker compose logs --tail 40 imsda-registration >&2 || true
  fi
  sleep 3
done

echo "IMSDA Registration Docker deployment complete."
