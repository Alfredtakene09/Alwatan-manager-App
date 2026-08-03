import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type Request, type Response } from "express";
import {
  getLanIpv4,
  getNetworkAccessEndpoints,
  getTailscaleIpv4,
} from "../lib/lan-host.js";

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../..");

function requestScheme(req: Request): "http" | "https" {
  const protoHeader = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    ?.trim();
  if (protoHeader === "https" || protoHeader === "http") return protoHeader;
  return req.secure ? "https" : "http";
}

function appPort(): number {
  return Number(process.env.PORT ?? 4000);
}

function buildUrl(scheme: "http" | "https", host: string, port?: number): string {
  const hasPort = /:\d+$/.test(host);
  if (hasPort) return `${scheme}://${host}`.replace(/\/$/, "");
  const p = port ?? appPort();
  const defaultPort = scheme === "https" ? 443 : 80;
  if (p === defaultPort) return `${scheme}://${host}`;
  return `${scheme}://${host}:${p}`;
}

function resolveAccessBases(req: Request): {
  primary: string;
  wifi: string | null;
  tailscale: string | null;
  hotspot: string | null;
  all: string[];
} {
  const scheme = requestScheme(req);
  const port = appPort();
  const endpoints = getNetworkAccessEndpoints();

  const wifi = endpoints.wifiIp ? buildUrl(scheme, endpoints.wifiIp, port) : null;
  const tailscale = endpoints.tailscaleIp
    ? buildUrl(scheme, endpoints.tailscaleIp, port)
    : null;
  const hotspot = endpoints.hotspotIp
    ? buildUrl(scheme, endpoints.hotspotIp, port)
    : null;

  const hostHeader = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "")
    .split(",")[0]
    ?.trim();

  let requestBase: string | null = null;
  if (hostHeader && !/^localhost(?::|$)/i.test(hostHeader) && !/^127\./.test(hostHeader)) {
    requestBase = buildUrl(scheme, hostHeader);
  }

  const all: string[] = [];
  const push = (value: string | null) => {
    if (!value) return;
    if (!all.includes(value)) all.push(value);
  };

  push(wifi);
  push(tailscale);
  push(hotspot);
  push(requestBase);

  if (all.length === 0) {
    const fallbackIp = getLanIpv4() ?? getTailscaleIpv4() ?? "127.0.0.1";
    push(buildUrl(scheme, fallbackIp, port));
  }

  return {
    primary: all[0],
    wifi,
    tailscale,
    hotspot,
    all,
  };
}

function findAlwatanIcon(): string | null {
  const candidates = [
    path.join(projectRoot, "scripts", "alwatan.ico"),
    path.join(projectRoot, "acces-client", "alwatan.ico"),
    path.join(projectRoot, "setup-client", "Alwatan-Manager-Client", "alwatan.ico"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findSetupZip(): string | null {
  const candidates = [
    path.join(projectRoot, "setup-client", "Alwatan-Manager-Client.zip"),
    path.join(projectRoot, "acces-client.zip"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapePsSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

function buildAndroidShortcutHtml(appUrl: string, iconUrl: string): string {
  const url = escapeHtml(appUrl.replace(/\/?$/, "/"));
  const icon = escapeHtml(iconUrl);
  return `<!DOCTYPE html>
<html lang="fr" dir="ltr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#1b4f9c" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="Alwatan Manager" />
  <link rel="icon" href="${icon}" />
  <link rel="apple-touch-icon" href="${icon}" />
  <title>Alwatan Manager — Tablette</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0; min-height: 100vh; font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      background: linear-gradient(160deg, #e8f0fb 0%, #ffffff 45%, #f5f7fb 100%);
      color: #12233f; display: grid; place-items: center; padding: 1.25rem;
    }
    .card {
      width: min(440px, 100%); background: #fff; border-radius: 18px;
      box-shadow: 0 12px 40px rgba(18, 35, 63, 0.12); padding: 1.4rem 1.25rem 1.5rem;
      text-align: center;
    }
    img { width: 84px; height: 84px; border-radius: 18px; object-fit: cover; margin-bottom: 0.85rem; }
    h1 { margin: 0 0 0.35rem; font-size: 1.25rem; }
    p { margin: 0 0 0.85rem; color: #4b5563; line-height: 1.45; font-size: 0.95rem; }
    ol { text-align: start; margin: 0 0 1.1rem; padding-inline-start: 1.2rem; color: #1f2937; line-height: 1.55; }
    a.btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;
      min-height: 48px; padding: 0.75rem 1.1rem; border-radius: 12px; text-decoration: none;
      background: #1b4f9c; color: #fff; font-weight: 650; font-size: 1rem; width: 100%;
    }
    .hint { margin-top: 0.9rem; font-size: 0.82rem; color: #6b7280; }
    .ar { direction: rtl; font-family: "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif; }
  </style>
</head>
<body>
  <main class="card">
    <img src="${icon}" alt="Alwatan" />
    <h1>Clinique Alwatan — Manager</h1>
    <p>Raccourci tablette Android / iPad. Ouvrez l’app puis ajoutez-la à l’écran d’accueil.</p>
    <ol>
      <li>Appuyez sur <strong>Ouvrir l’application</strong>.</li>
      <li>Dans Chrome : menu <strong>⋮</strong> → <strong>Ajouter à l’écran d’accueil</strong>.</li>
      <li>Sur Safari (iPad) : Partager → <strong>Sur l’écran d’accueil</strong>.</li>
    </ol>
    <a class="btn" href="${url}">Ouvrir l’application</a>
    <p class="hint ar">افتح التطبيق ثم أضفه إلى الشاشة الرئيسية من قائمة المتصفح.</p>
    <p class="hint">${url}</p>
  </main>
  <script>
    // Si ouvert depuis Téléchargements, l’utilisateur clique le bouton.
    // Option : ouverture auto après 1,2 s (désactivée pour laisser lire le guide).
  </script>
</body>
</html>`;
}

/** Lanceur client : Wi‑Fi d’abord, Tailscale en secours (un seul raccourci). */
function buildClientLauncherPs1(wifiUrl: string, tailscaleUrl: string): string {
  const wifi = wifiUrl.replace(/'/g, "''");
  const ts = tailscaleUrl.replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Continue'",
    `$wifi = '${wifi}'`,
    `$ts = '${ts}'`,
    "",
    "function Test-AlwatanUrl([string]$Url) {",
    "  if (-not $Url) { return $false }",
    "  try {",
    "    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3",
    "    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400)",
    "  } catch { return $false }",
    "}",
    "",
    "function Open-AlwatanUrl([string]$Url) {",
    "  if (-not $Url) { return }",
    "  $openUrl = $Url",
    "  try {",
    "    $base = $Url.TrimEnd('/')",
    "    $ver = Invoke-RestMethod -Uri ($base + '/api/app-version?_=' + [guid]::NewGuid().ToString('N')) -TimeoutSec 3",
    "    if ($ver -and $ver.buildId) {",
    "      $q = [uri]::EscapeDataString([string]$ver.buildId)",
    "      $openUrl = $Url.TrimEnd('/') + '/?v=' + $q",
    "    }",
    "  } catch { }",
    "  $edge = @(",
    "    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\\Edge\\Application\\msedge.exe'),",
    "    (Join-Path $env:ProgramFiles 'Microsoft\\Edge\\Application\\msedge.exe'),",
    "    (Join-Path $env:LOCALAPPDATA 'Microsoft\\Edge\\Application\\msedge.exe')",
    "  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1",
    "  $chrome = @(",
    "    (Join-Path $env:ProgramFiles 'Google\\Chrome\\Application\\chrome.exe'),",
    "    (Join-Path ${env:ProgramFiles(x86)} 'Google\\Chrome\\Application\\chrome.exe')",
    "  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1",
    "  if ($edge) { Start-Process -FilePath $edge -ArgumentList ('--app=' + $openUrl) }",
    "  elseif ($chrome) { Start-Process -FilePath $chrome -ArgumentList ('--app=' + $openUrl) }",
    "  else { Start-Process $openUrl }",
    "}",
    "",
    "$candidates = New-Object System.Collections.Generic.List[string]",
    "if ($wifi) { [void]$candidates.Add($wifi) }",
    "if ($ts -and $ts -ne $wifi) { [void]$candidates.Add($ts) }",
    "",
    "$opened = $false",
    "foreach ($url in $candidates) {",
    "  if (Test-AlwatanUrl $url) {",
    "    Open-AlwatanUrl $url",
    "    $opened = $true",
    "    break",
    "  }",
    "}",
    "",
    "if (-not $opened) {",
    "  $fallback = if ($wifi) { $wifi } elseif ($ts) { $ts } else { $null }",
    "  if ($fallback) { Open-AlwatanUrl $fallback }",
    "}",
  ].join("\r\n");
}

function buildSilentVbs(): string {
  return [
    'Set sh = CreateObject("WScript.Shell")',
    'ps1 = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\\CliniqueAlwatan\\lancer-alwatan-bureau.ps1"',
    'sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """", 0, False',
  ].join("\r\n");
}

/** Installe 1 raccourci Bureau (icône Alwatan) branché sur le lanceur Wi‑Fi → Tailscale. */
function buildDesktopShortcutPs1(opts: {
  apiBase: string;
  wifiUrl: string;
  tailscaleUrl: string;
}): string {
  const api = escapePsSingleQuoted(opts.apiBase.replace(/\/$/, ""));
  const wifiUrl = opts.wifiUrl.replace(/\/?$/, "/");
  const tsUrl = opts.tailscaleUrl ? opts.tailscaleUrl.replace(/\/?$/, "/") : "";

  const launcherB64 = Buffer.from(
    buildClientLauncherPs1(wifiUrl, tsUrl),
    "utf8",
  ).toString("base64");
  const vbsB64 = Buffer.from(buildSilentVbs(), "utf8").toString("base64");

  return `
$ErrorActionPreference = 'Stop'
$api = '${api}'

$desk = [Environment]::GetFolderPath('Desktop')
$store = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan'
New-Item -ItemType Directory -Force -Path $store | Out-Null

$icoStore = Join-Path $store 'alwatan.ico'
$icoDesk = Join-Path $desk 'alwatan.ico'
Invoke-WebRequest -Uri ($api + '/api/client-setup/alwatan.ico') -OutFile $icoStore -UseBasicParsing
Copy-Item -LiteralPath $icoStore -Destination $icoDesk -Force

$launcherPs1 = Join-Path $store 'lancer-alwatan-bureau.ps1'
$launcherBytes = [Convert]::FromBase64String('${launcherB64}')
[System.IO.File]::WriteAllBytes($launcherPs1, $launcherBytes)

$launcherVbs = Join-Path $store 'lancer-alwatan-bureau.vbs'
$vbsBytes = [Convert]::FromBase64String('${vbsB64}')
[System.IO.File]::WriteAllBytes($launcherVbs, $vbsBytes)

@(
  'Alwatan Manager (Tailscale).lnk',
  'Alwatan Manager (Tailscale).url',
  'Alwatan Manager (Wi-Fi).url',
  'Alwatan Manager (Wi-Fi).lnk',
  'Alwatan Manager (direct).url',
  'Alwatan Manager (direct).bat'
) | ForEach-Object {
  $p = Join-Path $desk $_
  if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }
}

$shell = New-Object -ComObject WScript.Shell
$lnkPath = Join-Path $desk 'Alwatan Manager.lnk'
$s = $shell.CreateShortcut($lnkPath)
$s.TargetPath = $launcherVbs
$s.WorkingDirectory = $store
$s.WindowStyle = 1
$s.Description = 'Clinique Alwatan — Wi-Fi puis Tailscale si besoin'
$s.IconLocation = $icoDesk + ',0'
$s.Save()

Write-Host ('OK — Bureau : ' + $desk)
Write-Host '  • Alwatan Manager.lnk (unique : Wi-Fi → Tailscale)'
Write-Host '  • alwatan.ico (icone clinique sur le Bureau)'
`.trim();
}

function buildDesktopShortcutCmd(opts: {
  apiBase: string;
  wifiUrl: string;
  tailscaleUrl: string;
}): string {
  const ps1 = buildDesktopShortcutPs1(opts);
  // EncodedCommand = UTF-16LE Base64 (fiable sous cmd)
  const encoded = Buffer.from(ps1, "utf16le").toString("base64");

  return [
    "@echo off",
    "setlocal EnableExtensions",
    "title Alwatan Manager — raccourci Bureau",
    "echo.",
    "echo   Installation du raccourci Bureau avec l'icone Alwatan...",
    "echo.",
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
    "if errorlevel 1 (",
    "  echo.",
    "  echo Echec. Verifiez la connexion au serveur puis reessayez.",
    "  pause",
    "  exit /b 1",
    ")",
    "echo.",
    "echo Termine. Un seul raccourci « Alwatan Manager » : Wi-Fi puis Tailscale si besoin.",
    "echo.",
    "pause",
  ].join("\r\n");
}

router.get("/info", (req, res) => {
  const bases = resolveAccessBases(req);
  const iconAvailable = Boolean(findAlwatanIcon());
  res.json({
    appUrl: `${bases.primary}/`,
    wifiUrl: bases.wifi ? `${bases.wifi}/` : null,
    tailscaleUrl: bases.tailscale ? `${bases.tailscale}/` : null,
    hotspotUrl: bases.hotspot ? `${bases.hotspot}/` : null,
    urls: bases.all.map((base) => `${base}/`),
    iconUrl: iconAvailable ? "/api/client-setup/alwatan.ico" : null,
    shortcutUrl: "/api/client-setup/install-desktop-shortcut.cmd",
    shortcutWifiUrl: "/api/client-setup/install-desktop-shortcut.cmd",
    shortcutTailscaleUrl: bases.tailscale
      ? "/api/client-setup/install-desktop-shortcut.cmd"
      : null,
    androidShortcutUrl: "/api/client-setup/android-shortcut.html",
    launcherUrl: "/api/client-setup/launcher.cmd",
    packageUrl: findSetupZip() ? "/api/client-setup/package.zip" : null,
    packageAvailable: Boolean(findSetupZip()),
  });
});

router.get("/alwatan.ico", (_req, res) => {
  const iconPath = findAlwatanIcon();
  if (!iconPath) {
    res.status(404).json({ error: "Icône alwatan.ico introuvable sur le serveur." });
    return;
  }
  res.setHeader("Content-Type", "image/x-icon");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("Content-Disposition", 'inline; filename="alwatan.ico"');
  fs.createReadStream(iconPath).pipe(res);
});

router.get("/install-desktop-shortcut.cmd", (req, res) => {
  const bases = resolveAccessBases(req);
  if (!findAlwatanIcon()) {
    res.status(404).json({
      error:
        "Icône alwatan.ico introuvable. Sur le serveur, lancez scripts\\installer-raccourcis-bureau.ps1.",
    });
    return;
  }

  const body = buildDesktopShortcutCmd({
    apiBase: bases.wifi ?? bases.primary,
    wifiUrl: bases.wifi ?? bases.primary,
    tailscaleUrl: bases.tailscale ?? "",
  });

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="Installer-Raccourci-Alwatan-Bureau.cmd"',
  );
  res.send(body);
});

router.get("/android-shortcut.html", (req, res) => {
  const bases = resolveAccessBases(req);
  const appUrl = `${(bases.wifi ?? bases.primary).replace(/\/?$/, "/")}`;
  const iconUrl = `${appUrl.replace(/\/?$/, "")}/pwa/icon-192.png`;
  const html = buildAndroidShortcutHtml(appUrl, iconUrl);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="Alwatan-Manager-Tablette.html"',
  );
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
});

router.get("/shortcut.url", (_req, res) => {
  res.redirect(302, "/api/client-setup/install-desktop-shortcut.cmd");
});

router.get("/shortcut-wifi.url", (_req, res) => {
  res.redirect(302, "/api/client-setup/install-desktop-shortcut.cmd");
});

router.get("/shortcut-tailscale.url", (_req, res) => {
  res.redirect(302, "/api/client-setup/install-desktop-shortcut.cmd");
});

router.get("/launcher.cmd", (req, res) => {
  const bases = resolveAccessBases(req);
  const wifiUrl = `${(bases.wifi ?? bases.primary).replace(/\/?$/, "/")}`;
  const tsUrl = bases.tailscale
    ? `${bases.tailscale.replace(/\/?$/, "/")}`
    : "";

  const body = [
    "@echo off",
    "setlocal EnableExtensions",
    "title Alwatan Manager",
    `set "WIFI_URL=${wifiUrl}"`,
    `set "TS_URL=${tsUrl}"`,
    "echo Test Wi-Fi / Ethernet...",
    'powershell -NoProfile -Command "try { $r=Invoke-WebRequest -Uri $env:WIFI_URL -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) { exit 0 } else { exit 1 } } catch { exit 1 }"',
    "if not errorlevel 1 (",
    "  echo Ouverture via Wi-Fi : %WIFI_URL%",
    '  start "" msedge --app=%WIFI_URL%',
    "  if errorlevel 1 start \"\" chrome --app=%WIFI_URL%",
    '  if errorlevel 1 start "" "%WIFI_URL%"',
    "  exit /b 0",
    ")",
    'if defined TS_URL if not "%TS_URL%"=="" (',
    "  echo Wi-Fi indisponible — essai Tailscale...",
    '  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -Uri $env:TS_URL -UseBasicParsing -TimeoutSec 4; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) { exit 0 } else { exit 1 } } catch { exit 1 }"',
    "  if not errorlevel 1 (",
    "    echo Ouverture via Tailscale : %TS_URL%",
    '    start "" msedge --app=%TS_URL%',
    "    if errorlevel 1 start \"\" chrome --app=%TS_URL%",
    '    if errorlevel 1 start "" "%TS_URL%"',
    "    exit /b 0",
    "  )",
    ")",
    "echo Aucune route joignable — ouverture Wi-Fi par defaut.",
    'start "" "%WIFI_URL%"',
    "exit /b 1",
  ].join("\r\n");

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="Lancer-Alwatan-Manager.cmd"',
  );
  res.send(body);
});

router.get("/package.zip", (_req: Request, res: Response) => {
  const zipPath = findSetupZip();
  if (!zipPath) {
    res.status(404).json({
      error:
        "Package client introuvable. Sur le serveur, lancez CREER-SETUP-CLIENT.cmd puis réessayez.",
    });
    return;
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="Alwatan-Manager-Client.zip"',
  );
  fs.createReadStream(zipPath).pipe(res);
});

export default router;
