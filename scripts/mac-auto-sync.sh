#!/usr/bin/env bash
# Synchronise le dépôt avec origin/main (pull --rebase, push si commits locaux propres).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRANCH="${GIT_SYNC_BRANCH:-main}"
REMOTE="${GIT_SYNC_REMOTE:-origin}"
LOG_DIR="${HOME}/Library/Logs/alwatan-manager"
LOG_FILE="${LOG_DIR}/git-sync.log"

mkdir -p "${LOG_DIR}"
cd "${ROOT}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_FILE}"
}

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "Erreur : ${ROOT} n'est pas un dépôt Git."
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  log "Arbre de travail modifié — synchronisation ignorée."
  exit 0
fi

log "Fetch ${REMOTE}/${BRANCH}…"
git fetch "${REMOTE}" "${BRANCH}"

log "Pull --rebase ${REMOTE}/${BRANCH}…"
git pull --rebase "${REMOTE}" "${BRANCH}"

AHEAD="$(git rev-list --count "${REMOTE}/${BRANCH}..HEAD" 2>/dev/null || echo 0)"
if [ "${AHEAD}" != "0" ]; then
  log "Push de ${AHEAD} commit(s) vers ${REMOTE}/${BRANCH}…"
  git push "${REMOTE}" "${BRANCH}"
fi

log "Synchronisation terminée."
