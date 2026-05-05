#!/usr/bin/env bash
# deploy.sh
#
# Deploys the object_registry integration to Home Assistant OS on the Pi.
#
# Usage:
#   ./deploy.sh           — push code only, no restart
#   ./deploy.sh restart   — push code + restart HA via API
#
# Configuration is read from deploy.env in the repo root.
# deploy.env is gitignored and will never be committed.

set -euo pipefail

# ------------------------------------------------------------------
# Load config from deploy.env
# ------------------------------------------------------------------

ENV_FILE="$(dirname "$0")/deploy.env"

if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: deploy.env file not found."
  echo "       Copy deploy.env.example to deploy.env and fill in your values."
  exit 1
fi

# shellcheck source=deploy.env
source "${ENV_FILE}"

# Verify required variables are set
: "${PI_HOST:?PI_HOST not set in deploy.env}"
: "${HA_DEST:?HA_DEST not set in deploy.env}"
: "${HA_IP:?HA_IP not set in deploy.env}"
: "${HA_PORT:?HA_PORT not set in deploy.env}"
: "${HA_TOKEN:?HA_TOKEN not set in deploy.env}"

# ------------------------------------------------------------------
# Parse argument
# ------------------------------------------------------------------

RESTART_MODE="${1:-none}"  # none | restart

if [[ "${RESTART_MODE}" != "none" && "${RESTART_MODE}" != "restart" ]]; then
  echo "Usage: ./deploy.sh [restart]"
  echo "  (no argument)  push code only"
  echo "  restart        push code + restart HA via API"
  exit 1
fi

LOCAL_SRC="./custom_components/object_registry"

echo "==> Deploying object_registry to Home Assistant"
echo "    Restart mode: ${RESTART_MODE}"
echo ""

# ------------------------------------------------------------------
# Step 1: rsync directly to HAOS over SSH
# ------------------------------------------------------------------

echo "[1/2] Syncing files to HAOS..."
rsync -av --delete --checksum \
  "${LOCAL_SRC}/" \
  "${PI_HOST}:${HA_DEST}/object_registry/"
echo "      Done."
echo ""

# ------------------------------------------------------------------
# Step 2: Restart (optional)
# ------------------------------------------------------------------

if [[ "${RESTART_MODE}" == "restart" ]]; then
  echo "[2/2] Sending restart to Home Assistant..."
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    "http://${HA_IP}:${HA_PORT}/api/services/homeassistant/restart" \
    -H "Authorization: Bearer ${HA_TOKEN}" \
    -H "Content-Type: application/json")

  if [[ "${HTTP_STATUS}" == "200" || "${HTTP_STATUS}" == "201" ]]; then
    echo "      Restart triggered. HA will reload in a moment."
    echo "      Watch logs: ssh ${PI_HOST} 'journalctl -f'"
  else
    echo "      WARNING: Unexpected HTTP status ${HTTP_STATUS}."
    echo "      Check your HA_TOKEN and HA_IP in deploy.env."
  fi
  echo ""

else
  echo "[2/2] Skipping restart."
  echo "      For JS-only changes: hard refresh browser (Cmd+Shift+R)."
  echo "      For Python changes:  run ./deploy.sh restart"
  echo ""
fi

echo "==> Deploy complete."
