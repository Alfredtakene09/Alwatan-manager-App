#!/usr/bin/env bash
# Restaure une archive exportée par export-dev-data.sh
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <fichier.tar.gz>"
  echo "Exemple: $0 dev-data/alwatan-dev-data-20260625-120000.tar.gz"
  exit 1
fi

ARCHIVE="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKDIR="${ROOT}/dev-data/.import-tmp"

DB_USER="${POSTGRES_USER:-admin}"
DB_NAME="${POSTGRES_DB:-restaurant}"
CONTAINER="${POSTGRES_CONTAINER:-alwatan-db}"

if [ ! -f "${ARCHIVE}" ]; then
  echo "Fichier introuvable : ${ARCHIVE}"
  exit 1
fi

echo "⚠️  Cette opération remplace toutes les données locales actuelles."
read -r -p "Continuer ? (oui/non) " CONFIRM
if [ "${CONFIRM}" != "oui" ]; then
  echo "Annulé."
  exit 0
fi

rm -rf "${WORKDIR}"
mkdir -p "${WORKDIR}"
tar -xzf "${ARCHIVE}" -C "${ROOT}"

if [ ! -f "${ROOT}/dev-data/database.sql" ]; then
  echo "Archive invalide : dev-data/database.sql manquant."
  exit 1
fi

echo "→ Restauration de la base PostgreSQL…"
docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" < "${ROOT}/dev-data/database.sql"

if [ -d "${ROOT}/backend/uploads" ]; then
  echo "→ Fichiers uploadés restaurés."
else
  echo "→ Aucun dossier uploads dans l'archive."
fi

echo ""
echo "✓ Données importées. Relancez le backend si nécessaire."
echo "  cd backend && npm run dev"
