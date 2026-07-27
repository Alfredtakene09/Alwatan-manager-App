# Installation bureau (PWA) et HTTPS sur le LAN

## Comportement actuel

| Mode d’accès | Installation « native » (PWA) | Raccourci type application |
|--------------|-------------------------------|----------------------------|
| `http://IP-SERVEUR:4000` (production LAN) | Non (contexte non sécurisé) | Oui — lanceur `.cmd` dans l’UI ou raccourcis `scripts/` (Edge/Chrome `--app`) |
| `http://localhost:4000` ou `:5173` | Partiel (SW + manifest, install limitée) | Oui |
| `https://IP-SERVEUR:4000` (certificat approuvé) | Oui (Chrome / Edge) | Oui |

L’interface propose une bannière **Installer sur ce poste** :

- en **HTTPS** : bouton d’installation PWA (`beforeinstallprompt`) ;
- en **HTTP LAN** : téléchargement de `Lancer-Alwatan-Manager.cmd` (fenêtre sans barre d’adresse via Edge/Chrome).

Les raccourcis **Alwatan Manager (Client)** ouvrent désormais le navigateur en mode `--app=URL`.

## Service worker et données cliniques

- **Mis en cache** : fichiers statiques du build (JS, CSS, HTML, polices, icônes).
- **Jamais mis en cache** : toutes les requêtes `/api/*` (réseau uniquement).
- **Hors ligne** : l’interface peut s’afficher si elle a déjà été chargée ; les données patients restent indisponibles (bandeau d’avertissement).

Après un déploiement (`installer-production.ps1`), les postes déjà installés voient **Mettre à jour** lorsqu’un nouveau service worker est publié.

## Activer HTTPS sur le serveur (recommandé pour PWA LAN)

### 1. Générer un certificat (exemple avec OpenSSL)

Sur le PC serveur, dans un dossier dédié (ex. `runtime\certs`) :

```powershell
openssl req -x509 -newkey rsa:2048 -nodes -keyout server.key -out server.crt -days 825 `
  -subj "/CN=alwatan.local" -addext "subjectAltName=DNS:alwatan.local,IP:192.168.1.50"
```

Remplacez `192.168.1.50` par l’IP réelle du serveur.

### 2. Configurer `backend\.env`

```env
SSL_KEY_PATH="C:\chemin\vers\runtime\certs\server.key"
SSL_CERT_PATH="C:\chemin\vers\runtime\certs\server.crt"
COOKIE_SECURE=1
```

Ajoutez les origines HTTPS à `CORS_ORIGIN`, par exemple :

```env
CORS_ORIGIN="https://192.168.1.50:4000,https://localhost:4000,http://localhost:4000"
```

Redémarrez le service Alwatan (`demarrer-services.ps1`).

### 3. Faire confiance au certificat sur chaque poste client

- **Auto-signé** : importer `server.crt` dans « Autorités de certification racines de confiance » (certmgr / Gestionnaire de certificats), ou accepter l’avertissement une fois par navigateur.
- **mkcert** (poste de dev / petit parc) : `mkcert -install` puis générer un cert pour l’IP.
- **CA d’entreprise (AD)** : déployer le certificat via stratégie de groupe.

### 4. Pare-feu

Le port **4000** en TCP reste ouvert (déjà géré par `ouvrir-parefeu.ps1`).

## Alternatives

- **Sans HTTPS** : conserver HTTP + lanceur `.cmd` / raccourcis scripts (déjà en place).
- **Wrapper bureau** (Electron / WebView2) : possible mais plus lourd à maintenir ; non nécessaire si `--app` ou PWA HTTPS suffisent.

## Fichiers concernés

- `frontend/vite.config.ts` — manifest + Workbox
- `frontend/public/pwa/icon-*.png` — icônes d’installation
- `frontend/scripts/generate-pwa-icons.ps1` — régénération au build
- `backend/src/index.ts` — écoute HTTPS optionnelle
