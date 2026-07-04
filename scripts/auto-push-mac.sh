#!/usr/bin/env bash
# Commit et push les modifications locales vers origin/main (Mac).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRANCH="${GIT_SYNC_BRANCH:-main}"
REMOTE="${GIT_SYNC_REMOTE:-origin}"
MESSAGE="${1:-Modifications application depuis Mac ($(date '+%Y-%m-%d %H:%M'))}"

cd "${ROOT}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Erreur : ${ROOT} n'est pas un dépôt Git."
  exit 1
fi

HAS_UNTRACKED="$(git ls-files --others --exclude-standard)"
if git diff --quiet && git diff --cached --quiet && [ -z "${HAS_UNTRACKED}" ]; then
  echo "Aucune modification à committer."
else
  echo "→ git add -A"
  git add -A
  echo "→ git commit"
  git commit -m "${MESSAGE}"
fi

echo "→ git pull --rebase ${REMOTE} ${BRANCH}"
git pull --rebase "${REMOTE}" "${BRANCH}"

AHEAD="$(git rev-list --count "${REMOTE}/${BRANCH}..HEAD" 2>/dev/null || echo 0)"
if [ "${AHEAD}" = "0" ]; then
  echo "✓ Déjà synchronisé avec ${REMOTE}/${BRANCH}."
else
  echo "→ git push ${REMOTE} ${BRANCH} (${AHEAD} commit(s))"
  git push "${REMOTE}" "${BRANCH}"
  echo "✓ Push terminé."
fi
