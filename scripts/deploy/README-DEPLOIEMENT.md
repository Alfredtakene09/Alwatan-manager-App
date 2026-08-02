# Déploiement production — Clinique Alwatan Manager
#
# Objectif : accès 24/7 sur le réseau local, sans Internet,
# redémarrage automatique après coupure électrique.

## Architecture

```
PC SERVEUR (toujours allumé + UPS)
  ├── PostgreSQL          → service Windows auto
  └── AlwatanManager      → API + interface sur le port 4000
        http://IP-SERVEUR:4000

PC clients (réception, médecin…)
  → navigateur → http://IP-SERVEUR:4000
```

Internet n’est **pas** requis pour le travail quotidien.

## Installation (une seule fois, sur le PC serveur)

1. Vérifier PostgreSQL (démarrage automatique dans `services.msc`).
2. Vérifier `backend\.env` (`DATABASE_URL` correct).
3. Clic droit sur **`installer-production.cmd`** → **Exécuter en tant qu’administrateur**  
   (ou double-clic : une fenêtre UAC demandera l’élévation).

   Depuis PowerShell **sans** être admin (en étant d’abord dans le dossier du projet) :

   ```powershell
   cd "C:\Users\ALWATAN SERVEUR\Downloads\Alwatan-manager-App"
   powershell -ExecutionPolicy Bypass -File ".\scripts\deploy\installer-production-elevate.ps1"
   ```

   Ou double-clic sur **`INSTALLER-PRODUCTION.cmd`** à la racine du projet (chemin toujours correct).

Le script :

- construit frontend + backend
- sert l’interface depuis l’API (un seul port **4000**)
- installe un service Windows via **NSSM** (ou tâche au démarrage en secours)
- ouvre le pare-feu (profil Privé)
- planifie une sauvegarde SQL chaque nuit à **02:00**
- écrit l’IP locale dans `scripts\alwatan-server.txt`

## Accès après installation

| Où | URL |
|----|-----|
| Sur le serveur | http://127.0.0.1:4000 |
| Sur le réseau | http://IP-DU-SERVEUR:4000 |

Sur les postes clients : ouvrez `http://IP-DU-SERVEUR:4000` dans le navigateur (aucune installation obligatoire).  
Pour un raccourci Bureau : sur la page de connexion, utilisez **Télécharger le raccourci** / **Télécharger l’installeur (ZIP)**.

### Installer l’app sur les autres PC (réception, médecin…)

**Méthode recommandée (réseau, sans clé USB)**  

1. Connectez le poste client au **même Wi-Fi / Ethernet** que le serveur.  
2. Ouvrez `http://IP-DU-SERVEUR:4000` (ex. `http://192.168.88.161:4000`).  
3. Sur la page de connexion, cliquez :
   - **Télécharger le raccourci (.url)** → déplacez le fichier sur le Bureau ; ou  
   - **Télécharger l’installeur (ZIP)** → extrayez → double-clic **`INSTALLER.bat`**.

**Méthode classique (ZIP / USB)**  

1. **Sur le serveur**, générez le package (une fois après install ou changement d’IP) :
   - Double-clic **`CREER-SETUP-CLIENT.cmd`** à la racine du projet, ou  
   - `scripts\creer-setup-client.cmd`
2. Récupérez le fichier **`setup-client\Alwatan-Manager-Client.zip`** (ou le dossier `acces-client\`).
3. **Sur chaque poste client** : copiez le ZIP, extrayez-le, double-clic **`INSTALLER.bat`**.
4. Un raccourci **Alwatan Manager** (logo clinique) est créé sur le Bureau et dans le menu Démarrer.

Aucun Node.js ni copie du projet complet n’est nécessaire sur les clients.

## Commandes utiles

```powershell
# Sauvegarde manuelle
.\scripts\deploy\sauvegarder-base.ps1

# Démarrer / arrêter (Admin)
.\scripts\deploy\demarrer-services.ps1
.\scripts\deploy\arreter-services.ps1

# Désinstaller le service auto (Admin)
.\scripts\deploy\desinstaller-production.ps1

# Pare-feu seul (Admin)
.\scripts\deploy\ouvrir-parefeu.ps1
```

## Coupures

| Événement | Comportement |
|-----------|--------------|
| Internet coupé | Aucun impact (LAN) |
| Courant coupé + UPS | Continuité puis arrêt propre |
| Retour du courant | Windows + PostgreSQL + Alwatan redémarrent seuls |
| Crash de l’API | NSSM relance le service sous quelques secondes |

## Sauvegardes

- Dossier : `backups\postgres\`
- Fichiers : `alwatan-YYYYMMDD-HHMMSS.sql`
- Conservation : 30 jours (modifiable)
- Copiez régulièrement ce dossier sur un disque externe

## Notes

- Mode développement (`lancer-serveur.ps1 -Dev`) reste disponible pour les mises à jour de code.
- Après une mise à jour du code : relancer `installer-production.ps1` (ou `-SkipFirewall -SkipBackupTask`).
- Recommandé : IP fixe pour le serveur (ex. `192.168.1.50`).
