# Clinique Al-Watan Manager

ERP médical conforme au **Cahier des Charges V12.3**.

## Stack

| Couche | Technologie |
|--------|-------------|
| Frontend | **Vue.js 3** + Vite + Vue Router + Pinia |
| Backend API | **Node.js** + Express + TypeScript |
| Base de données | **PostgreSQL** (local) + Prisma ORM |

## Structure

```
├── frontend/       # Application Vue.js (interface web)
├── backend/        # API REST Express + Prisma
└── docker-compose.yml   # optionnel (Docker)
```

## Démarrage (Windows, base locale)

### 1. PostgreSQL

Installez PostgreSQL sur la machine. Le projet utilise par défaut :

- Hôte : `localhost`
- Port : `5433` (ou `5432` selon votre installation)
- Utilisateur : `postgres` (ou propriétaire de la base)
- Mot de passe : celui défini à l'installation PostgreSQL
- Base : `alwatan` (existante)

Adaptez `DATABASE_URL` dans `backend/.env` (base `alwatan`, port `5433`).

### 2. Lancer l'application

Double-clic **`START.bat`** ou :

```powershell
.\scripts\start-local.ps1
```

- Frontend : http://localhost:5173
- API : http://localhost:4000

## Démarrage manuel

```powershell
cd backend
npm install
npx prisma generate
npm run dev
```

```powershell
cd frontend
npm install
npm run dev
```

## Comptes de démonstration

Mot de passe : `Clinique2026!`

Noms d'utilisateur :

- `reception`
- `medecin`
- `direction` (Direction — gère aussi l’administration)
- `pharmacie`
- `laborantin`

(Créés par `npm run db:seed`.)

## Modules

1. **Réception** — Dossier patient `PAT-AAAA-XXXXX`, constantes vitales
2. **Consultation** — Notifications chirurgie / hospitalisation
3. **Comptabilité** — Tarification, dispatching, lits VIP/Simple
4. **Bloc & Salles** — Lecture seule des autorisations
5. **Pharmacie** — Ordonnances et stocks temps réel

## Sauvegarde (optionnel)

```bash
chmod +x scripts/export-dev-data.sh scripts/import-dev-data.sh
./scripts/export-dev-data.sh
```

**Ne pas mettre les exports sur GitHub** (données patients sensibles).
