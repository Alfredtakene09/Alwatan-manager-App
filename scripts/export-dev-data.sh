#!/usr/bin/env bash
# Exporte la base PostgreSQL + les fichiers uploadés pour partage avec un collègue.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${ROOT}/dev-data"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="${OUT_DIR}/alwatan-dev-data-${STAMP}.tar.gz"
DUMP="${OUT_DIR}/database.sql"

mkdir -p "${OUT_DIR}"

DB_USER="${POSTGRES_USER:-admin}"
DB_NAME="${POSTGRES_DB:-restaurant}"
CONTAINER="${POSTGRES_CONTAINER:-alwatan-db}"

echo "→ Export de la base PostgreSQL (${DB_NAME})…"
docker exec "${CONTAINER}" pg_dump -U "${DB_USER}" --clean --if-exists "${DB_NAME}" > "${DUMP}"

echo "→ Création de l'archive (base + uploads)…"
tar -czf "${ARCHIVE}" \
  -C "${ROOT}" \
  "dev-data/database.sql" \
  $([ -d "${ROOT}/backend/uploads" ] && echo "backend/uploads" || true)

echo ""
echo "✓ Archive prête : ${ARCHIVE}"
echo "  Envoyez ce fichier à votre collègue (WeTransfer, clé USB, Drive…)."
echo "  Ne le mettez PAS sur GitHub (données patients sensibles)."
