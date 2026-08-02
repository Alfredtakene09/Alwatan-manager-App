# Clinique Al-Watan Manager

ERP médical conforme au **Cahier des Charges V12.3**.

## Stack

| Couche | Technologie |
|--------|-------------|
| Frontend | **Vue.js 3** + Vite + Vue Router + Pinia (+ PWA) |
| Backend API | **Node.js** + Express + TypeScript |
| Base de données | **PostgreSQL** (local) + Prisma ORM |

## Structure

```
├── frontend/       # Application Vue.js (interface web / PWA)
├── backend/        # API REST Express + Prisma
├── scripts/        # Lancement, LAN, clients, production
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

```powershell
.\scripts\lancer-serveur.ps1
```

Mode développement (hot reload) :

```powershell
.\scripts\lancer-serveur.ps1 -Dev
```

Raccourci équivalent (Serveur Auto) :

```powershell
.\scripts\lancer-serveur-auto.ps1
```

- Frontend (dev) : http://localhost:5173
- API : http://localhost:4000

## Démarrage manuel

```powershell
cd backend
npm install
npx prisma generate
npm run db:seed   # comptes par défaut (optionnel)
npm run dev
```

```powershell
cd frontend
npm install
npm run dev
```

## Comptes par défaut

Créés par `npm run db:seed` — conservés lors d’une réinitialisation de la base.

| Utilisateur | Mot de passe | Rôle |
|---|---|---|
| `Root` | `root@Alwatan2026` | Superadmin |
| `gestionnaire` | `Clinique2026!` | Gestionnaire |
| `pharmacie` | `Clinique2026!` | Pharmacien |

Autres rôles gérés dans l’app : Réceptionniste, Médecin, Direction (comptable), Laborantin, Soignant, Logistique.

## Modules

1. **Réception** — Enregistrement patient (`PAT-AAAA-XXXXX`), file, examens & paiements, encaissements
2. **Médecin / Consultation** — File de consultation, labos, opérations, nomenclature d’examens, ordonnances pharmacie
3. **Comptabilité / Direction** — Tarification, examens, encaissements, salaires, factures, hospitalisation
4. **Gestionnaire** — Caisse & décaissements, livre journal, finances
5. **Laboratoire** — Analyses en attente / terminées, formulaires de résultats, **stock labo**
6. **Pharmacie** — Caisse, produits, formes, ventes, alertes, fournisseurs, rapports, bénéfices
7. **Logistique** — Articles, catégories, stock, alertes, rapports
8. **Hospitalisation & Bloc** — Suivi des lits / salles, opérations
9. **Administration** — Employés, services, utilisateurs, paramètres clinique

## Déploiement production (clinique, réseau local 24/7)

Pour un accès permanent sans Internet, avec redémarrage automatique après coupure :

1. Sur le **PC serveur**, exécuter en Administrateur :  
   `scripts\deploy\installer-production.cmd`
2. Accès : `http://IP-DU-SERVEUR:4000`
3. Sur les postes clients : ouvrir l’URL dans le navigateur, ou installer le raccourci / ZIP depuis la page de connexion
4. Guide complet : [`scripts/deploy/README-DEPLOIEMENT.md`](scripts/deploy/README-DEPLOIEMENT.md)

### Scripts utiles (réseau / clients)

| Script | Rôle |
|--------|------|
| `scripts\creer-setup-client.ps1` | Génère le package d’installation client |
| `scripts\installer-poste-client.ps1` | Installe le raccourci sur un poste client |
| `scripts\ouvrir-reseau-lan.ps1` | Ouvre l’accès LAN / pare-feu |
| `scripts\activer-hotspot-wifi.ps1` | Hotspot Wi‑Fi serveur (optionnel) |
