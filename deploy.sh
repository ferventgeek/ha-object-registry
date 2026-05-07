#!/usr/bin/env bash
# deploy.sh
#
# Deploys the object_registry integration to Home Assistant OS on the Pi.
#
# Usage:
#   ./deploy.sh                              — copy all files
#   ./deploy.sh --restart                    — copy all files + restart HA
#   ./deploy.sh --files a.py b.js            — copy specific files only
#   ./deploy.sh --restart --files a.py b.js  — copy specific files + restart HA
#   ./deploy.sh --delete                     — delete entire /object_registry folder
#   ./deploy.sh --delete --files a.py b.js   — delete specific files only
#
# Flags must come before file list.
# --delete always requires a manual HA restart (not done automatically).
# Configuration is read from deploy.env in the repo root.

set -euo pipefail

# ------------------------------------------------------------------
# Load config from deploy.env
# ------------------------------------------------------------------

ENV_FILE="$(dirname "$0")/deploy.env"

if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: deploy.env not found."
  echo "       Copy deploy.env.example to deploy.env and fill in your values."
  exit 1
fi

source "${ENV_FILE}"

: "${PI_HOST:?PI_HOST not set in deploy.env}"
: "${HA_DEST:?HA_DEST not set in deploy.env}"
: "${HA_IP:?HA_IP not set in deploy.env}"
: "${HA_PORT:?HA_PORT not set in deploy.env}"
: "${HA_TOKEN:?HA_TOKEN not set in deploy.env}"

# ------------------------------------------------------------------
# Parse flags and file list
# ------------------------------------------------------------------

DO_RESTART=false
DO_DELETE=false
FILES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --restart)
      DO_RESTART=true
      shift
      ;;
    --delete)
      DO_DELETE=true
      shift
      ;;
    --files)
      shift
      # Everything remaining is the file list
      FILES=("$@")
      break
      ;;
    *)
      echo "ERROR: Unknown argument: $1"
      echo "Usage: ./deploy.sh [--restart] [--delete] [--files file1 file2 ...]"
      exit 1
      ;;
  esac
done

# --delete and --restart together — warn and ignore --restart
if ${DO_DELETE} && ${DO_RESTART}; then
  echo "WARNING: --restart is ignored with --delete."
  echo "         Manual HA restart required after delete operations."
  DO_RESTART=false
fi

LOCAL_SRC="./custom_components/object_registry"
REMOTE_HOST="${PI_HOST}"
REMOTE_PATH="${HA_DEST}/object_registry"

echo "==> Object Registry deploy"
echo ""

# ------------------------------------------------------------------
# DELETE mode
# ------------------------------------------------------------------

if ${DO_DELETE}; then
  if [[ ${#FILES[@]} -eq 0 ]]; then
    echo "WARNING: This will delete the entire /object_registry folder on HAOS."
    echo "         Manual HA restart will be required afterwards."
    echo ""
    read -r -p "Type YES to confirm: " CONFIRM
    if [[ "${CONFIRM}" != "YES" ]]; then
      echo "Aborted."
      exit 0
    fi
    echo "[1/1] Deleting ${REMOTE_PATH}/ on HAOS..."
    ssh "${REMOTE_HOST}" "rm -rf ${REMOTE_PATH}/"
    echo "      Done."
  else
    echo "WARNING: This will delete the following files from HAOS:"
    for f in "${FILES[@]}"; do
      echo "         ${REMOTE_PATH}/${f}"
    done
    echo ""
    read -r -p "Type YES to confirm: " CONFIRM
    if [[ "${CONFIRM}" != "YES" ]]; then
      echo "Aborted."
      exit 0
    fi
    echo "[1/1] Deleting specified files on HAOS..."
    for f in "${FILES[@]}"; do
      ssh "${REMOTE_HOST}" "rm -f ${REMOTE_PATH}/${f}"
      echo "      Deleted: ${f}"
    done
    echo "      Done."
  fi
  echo ""
  echo "==> Delete complete. Manual HA restart required."
  echo "    Restart via: ./deploy.sh --restart"
  exit 0
fi

# ------------------------------------------------------------------
# COPY mode
# ------------------------------------------------------------------

if [[ ${#FILES[@]} -eq 0 ]]; then
  # Copy entire integration folder
  echo "[1/2] Copying all files to HAOS..."
  find "${LOCAL_SRC}" -name ".DS_Store" -delete # Remove macOS metadata files
  scp -r "${LOCAL_SRC}/." "${REMOTE_HOST}:${REMOTE_PATH}/"
  echo "      Done."
else
  # Copy specific files only
  echo "[1/2] Copying ${#FILES[@]} file(s) to HAOS..."
  for f in "${FILES[@]}"; do
    # Preserve subdirectory structure (e.g. frontend/object-registry-panel.js)
    REMOTE_DIR="${REMOTE_PATH}/$(dirname "${f}")"
    ssh "${REMOTE_HOST}" "mkdir -p ${REMOTE_DIR}"
    scp "${LOCAL_SRC}/${f}" "${REMOTE_HOST}:${REMOTE_PATH}/${f}"
    echo "      Copied: ${f}"
  done
  echo "      Done."
fi

echo ""

# ------------------------------------------------------------------
# Restart (optional)
# ------------------------------------------------------------------

if ${DO_RESTART}; then
  echo "[2/2] Restarting Home Assistant..."
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    "http://${HA_IP}:${HA_PORT}/api/services/homeassistant/restart" \
    -H "Authorization: Bearer ${HA_TOKEN}" \
    -H "Content-Type: application/json")

  if [[ "${HTTP_STATUS}" == "200" || "${HTTP_STATUS}" == "201" ]]; then
    echo "      Restart triggered. HA will reload in a moment."
    echo "      Watch logs: ssh ${REMOTE_HOST} 'journalctl -f'"
  else
    echo "      WARNING: Unexpected HTTP status ${HTTP_STATUS}."
    echo "      Check HA_TOKEN and HA_IP in deploy.env."
  fi
else
  echo "[2/2] Skipping restart."
  echo "      JS-only changes: hard refresh browser (Cmd+Shift+R)."
  echo "      Python changes:  run ./deploy.sh --restart"
fi

echo ""
echo "==> Deploy complete."