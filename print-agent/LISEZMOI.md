# Alwatan — Agent d'impression ESC/POS (Syntalsol ECO250 USB)

## Rôle

Service local sur chaque poste (Réception et Pharmacie) qui reçoit les tickets
depuis le navigateur et les envoie en RAW ESC/POS à l'imprimante USB Windows —
sans dialogue d'impression.

## Prérequis

1. Windows (poste client)
2. Node.js 18+ installé (`node -v`)
3. Imprimante Syntalsol ECO250 installée dans Paramètres > Imprimantes
   (pilote fabricant ou « Generic / Text Only » acceptant le RAW)

## Installation (une fois par poste)

Depuis la racine du dépôt (ou une copie du dossier `print-agent`) :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File print-agent\scripts\install-agent.ps1
```

Le script :
- copie l'agent dans `%LOCALAPPDATA%\CliniqueAlwatan\print-agent`
- demande le **nom Windows exact** de l'imprimante
- démarre l'agent sur `http://127.0.0.1:19100`
- ajoute un raccourci au dossier Démarrage Windows

Lister les imprimantes :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File print-agent\scripts\list-printers.ps1
```

## Configuration

Fichier : `%LOCALAPPDATA%\CliniqueAlwatan\print-agent\config.json`

```json
{
  "port": 19100,
  "host": "127.0.0.1",
  "interface": "usb",
  "printerName": "ECO250",
  "paperWidthChars": 48,
  "cut": true
}
```

`printerName` = nom exact dans Windows (sensible à la casse selon le pilote).

## API locale

| Méthode | URL | Description |
|---------|-----|-------------|
| GET | `/health` | Statut agent + imprimante |
| GET | `/printers` | Liste des imprimantes Windows |
| POST | `/print` | Imprime un ticket JSON |

## Logs

`%LOCALAPPDATA%\CliniqueAlwatan\print-agent\logs\print-agent.log`

## Désinstallation

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File print-agent\scripts\uninstall-agent.ps1
```
