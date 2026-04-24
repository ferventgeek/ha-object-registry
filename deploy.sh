#!/usr/bin/env bash
# deploy.sh
#
# Deploys the object_registry integration to Home Assistant on the Pi.
#
# Usage:
#   ./deploy.sh           — push code only, no restart
#   ./deploy.sh soft      — push code + soft restart via HA API
#   ./deploy.sh hard      — push code + hard restart (docker restart)
#
# Configuration is read from .env in the repo root.
# Copy .env.example to .env and fill in your values.

set -euo pipefail

# ------------------------------------------------------------------
# Load config from .env
# ------------------------------------------------------------------

ENV_FILE="$(dirname "$0")/deploy.env"

if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: .env file not found."
  echo "       Copy .env.example to .env and fill in your values."
  exit 1
fi

# shellcheck source=deploy.env
source "${ENV_FILE}"

# Verify required variables are set
: "${PI_HOST:?PI_HOST not set in .env}"
: "${PI_STAGING:?PI_STAGING not set in .env}"
: "${PI_DEPLOY_SCRIPT:?PI_DEPLOY_SCRIPT not set in .env}"
: "${HA_CONTAINER:?HA_CONTAINER not set in .env}"
: "${HA_IP:?HA_IP not set in .env}"
: "${HA_PORT:?HA_PORT not set in .env}"
: "${HA_TOKEN:?HA_TOKEN not set in .env}"

# ------------------------------------------------------------------
# Parse argument
# ------------------------------------------------------------------

RESTART_MODE="${1:-none}"  # none | soft | hard

if [[ "${RESTART_MODE}" != "none" && "${RESTART_MODE}" != "soft" && "${RESTART_MODE}" != "hard" ]]; then
  echo "Usage: ./deploy.sh [soft|hard]"
  echo "  (no argument)  push code only"
  echo "  soft           push code + soft restart via HA API"
  echo "  hard           push code + hard restart (docker restart)"
  exit 1
fi

LOCAL_SRC="./custom_components/object_registry"

echo "==> Deploying object_registry to Home Assistant"
echo "    Restart mode: ${RESTART_MODE}"
echo ""

# ------------------------------------------------------------------
# Step 1: rsync to Pi staging folder
# ------------------------------------------------------------------

echo "[1/3] Syncing files to Pi staging..."
rsync -av --delete \
  "${LOCAL_SRC}/" \
  "${PI_HOST}:${PI_STAGING}/object_registry/"
echo "      Done."
echo ""

# ------------------------------------------------------------------
# Step 2: Docker copy on the Pi
# ------------------------------------------------------------------

echo "[2/3] Running push-to-ha-custom_components.sh on Pi..."
ssh "${PI_HOST}" "bash ${PI_DEPLOY_SCRIPT}"
echo "      Done."
echo ""

# ------------------------------------------------------------------
# Step 3: Restart (optional)
# ------------------------------------------------------------------

if [[ "${RESTART_MODE}" == "soft" ]]; then
  echo "[3/3] Sending soft restart to Home Assistant..."
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    "http://${HA_IP}:${HA_PORT}/api/services/homeassistant/restart" \
    -H "Authorization: Bearer ${HA_TOKEN}" \
    -H "Content-Type: application/json")

  if [[ "${HTTP_STATUS}" == "200" || "${HTTP_STATUS}" == "201" ]]; then
    echo "      Soft restart triggered. HA will reload in a moment."
  else
    echo "      WARNING: Unexpected HTTP status ${HTTP_STATUS}."
    echo "      Check your HA_TOKEN and HA_IP in .env."
  fi
  echo ""

elif [[ "${RESTART_MODE}" == "hard" ]]; then
  echo "[3/3] Hard restarting Home Assistant container..."
  ssh "${PI_HOST}" "docker restart ${HA_CONTAINER}"
  echo "      Done."
  echo ""

else
  echo "[3/3] Skipping restart."
  echo "      Restart HA manually or run: ./deploy.sh soft"
  echo ""
fi

echo "==> Deploy complete."
if [[ "${RESTART_MODE}" != "none" ]]; then
  echo "    Watch logs: ssh ${PI_HOST} 'docker logs -f ${HA_CONTAINER}'"
fi
