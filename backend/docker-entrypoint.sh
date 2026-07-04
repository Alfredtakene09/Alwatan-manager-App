#!/bin/sh
set -e

echo "Attente de PostgreSQL..."

wait_postgres() {
  host="$1"
  port="$2"
  i=0
  while [ "$i" -lt 5 ]; do
    if nc -z -w 2 "$host" "$port" 2>/dev/null; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

if wait_postgres postgres 5432; then
  echo "Connexion via reseau Docker (postgres:5432)"
  export DATABASE_URL="${DATABASE_URL:-postgresql://admin:password@postgres:5432/restaurant?schema=public}"
else
  echo "ERREUR: PostgreSQL Docker inaccessible."
  exit 1
fi

echo "Synchronisation du schema Prisma..."
npx prisma db push

echo "Seed des donnees de demonstration..."
npm run db:seed

echo "Demarrage de l'API..."
exec npm run dev
