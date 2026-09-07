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

function isTailscaleHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").split(":")[0] ?? "";
  const m = /^100\.(\d+)\./.exec(h);
  if (!m) return false;
  const second = Number(m[1]);
  return second >= 64 && second <= 127;
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

  // Ethernet/LAN demandé en premier (IP actuelle de la requête), puis interfaces locales, puis Tailscale
  if (requestBase) {
    try {
      const reqHost = new URL(requestBase).hostname;
      if (!isTailscaleHost(reqHost) || (!wifi && !hotspot)) {
        push(requestBase);
      }
    } catch {
      push(requestBase);
    }
  }
  push(wifi);
  push(hotspot);
  push(tailscale);

  if (all.length === 0) {
    const fallbackIp = getLanIpv4() ?? getTailscaleIpv4() ?? "127.0.0.1";
    push(buildUrl(scheme, fallbackIp, port));
  }

  // primary = première adresse non-Tailscale si possible
  const primaryNonTs =
    all.find((base) => {
      try {
        return !isTailscaleHost(new URL(base).hostname);
      } catch {
        return true;
      }
    }) ?? all[0];

  return {
    primary: primaryNonTs,
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

function buildAndroidShortcutHtml(opts: {
  wifiUrl: string;
  tailscaleUrl: string;
  iconUrl: string;
}): string {
  const wifi = escapeHtml(opts.wifiUrl.replace(/\/?$/, "/"));
  const ts = escapeHtml((opts.tailscaleUrl || "").replace(/\/?$/, "/"));
  const icon = escapeHtml(opts.iconUrl);
  const wifiJs = JSON.stringify(opts.wifiUrl.replace(/\/?$/, "/"));
  const tsJs = JSON.stringify((opts.tailscaleUrl || "").replace(/\/?$/, "/"));
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
    a.btn, button.btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;
      min-height: 48px; padding: 0.75rem 1.1rem; border-radius: 12px; text-decoration: none;
      background: #1b4f9c; color: #fff; font-weight: 650; font-size: 1rem; width: 100%;
      border: none; cursor: pointer; font-family: inherit;
    }
    button.btn:disabled { opacity: 0.7; cursor: wait; }
    .hint { margin-top: 0.9rem; font-size: 0.82rem; color: #6b7280; }
    .status { min-height: 1.2em; margin: 0.35rem 0 0.9rem; font-size: 0.88rem; color: #1b4f9c; }
    .ar { direction: rtl; font-family: "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif; }
    .urls { margin-top: 0.75rem; font-size: 0.78rem; color: #6b7280; word-break: break-all; }
  </style>
</head>
<body>
  <main class="card">
    <img src="${icon}" alt="Alwatan" />
    <h1>Clinique Alwatan — Manager</h1>
    <p>Raccourci tablette. Ouvre d'abord le Wi‑Fi clinique, puis Tailscale si le réseau local est indisponible.</p>
    <ol>
      <li>Appuyez sur <strong>Ouvrir l'application</strong>.</li>
      <li>Chrome : menu <strong>⋮</strong> → <strong>Ajouter à l'écran d'accueil</strong>.</li>
      <li>Safari (iPad) : Partager → <strong>Sur l'écran d'accueil</strong>.</li>
    </ol>
    <button type="button" class="btn" id="openApp">Ouvrir l'application</button>
    <p class="status" id="status" aria-live="polite"></p>
    <p class="hint ar">يفتح التطبيق عبر الشبكة المحلية أولاً، ثم Tailscale إذا لزم الأمر.</p>
    <p class="urls">Wi‑Fi : ${wifi || "—"}</p>
    <p class="urls">Tailscale : ${ts || "—"}</p>
  </main>
  <script>
    (function () {
      var wifi = ${wifiJs};
      var ts = ${tsJs};
      var btn = document.getElementById('openApp');
      var statusEl = document.getElementById('status');

      function setStatus(text) {
        if (statusEl) statusEl.textContent = text || '';
      }

      function healthUrl(base) {
        return String(base || '').replace(/\\/?$/, '') + '/api/health';
      }

      function probe(base) {
        if (!base) return Promise.resolve(false);
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = setTimeout(function () {
          if (ctrl) ctrl.abort();
        }, 2500);
        return fetch(healthUrl(base), {
          method: 'GET',
          cache: 'no-store',
          signal: ctrl ? ctrl.signal : undefined
        }).then(function (r) {
          clearTimeout(timer);
          return r.ok;
        }).catch(function () {
          clearTimeout(timer);
          return false;
        });
      }

      function openApp() {
        btn.disabled = true;
        setStatus('Recherche du serveur (Wi‑Fi puis Tailscale)…');
        var candidates = [];
        if (wifi) candidates.push(wifi);
        if (ts && ts !== wifi) candidates.push(ts);

        function tryNext(i) {
          if (i >= candidates.length) {
            var fallback = wifi || ts;
            setStatus(fallback
              ? 'Serveur inaccessible — ouverture de l\\'URL de secours…'
              : 'Aucune adresse configurée.');
            btn.disabled = false;
            if (fallback) location.href = fallback;
            return;
          }
          var url = candidates[i];
          setStatus(i === 0 ? 'Test du réseau local…' : 'Test Tailscale…');
          probe(url).then(function (ok) {
            if (ok) {
              setStatus('Connexion…');
              location.href = url;
              return;
            }
            tryNext(i + 1);
          });
        }
        tryNext(0);
      }

      if (btn) btn.addEventListener('click', openApp);
    })();
  </script>
</body>
</html>`;
}

/** Révision du lanceur Bureau — incrémenter pour forcer une resynchro des raccourcis réseau. */
const LAUNCHER_REVISION = "2026-09-07-auto-sync-net";

/** Découverte serveur sur le sous-réseau local (IP DHCP du serveur peut changer). */
const FIND_SERVER_ON_LAN_PS1 = [
  "function Test-AlwatanHostPort {",
  "  param([string]$HostIp, [int]$PortNum = 4000)",
  "  if (-not $HostIp) { return $false }",
  "  try {",
  "    $r = Invoke-WebRequest -Uri ('http://' + $HostIp + ':' + $PortNum + '/api/health') -UseBasicParsing -TimeoutSec 1",
  "    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400)",
  "  } catch { return $false }",
  "}",
  "function Find-AlwatanServerOnLan {",
  "  param([int]$PortNum = 4000)",
  "  $local = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |",
  "    Where-Object {",
  "      $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and",
  "      $_.AddressState -eq 'Preferred' -and",
  "      $_.InterfaceAlias -notmatch '(?i)tailscale|bluetooth|virtual' -and",
  "      $_.IPAddress -notmatch '^100\\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\\.'",
  "    } | Sort-Object @{ Expression = { if ($_.InterfaceAlias -match '(?i)^Ethernet') { 0 } else { 1 } } } | Select-Object -First 1",
  "  if (-not $local) { return $null }",
  "  $parts = $local.IPAddress.Split('.')",
  "  if ($parts.Count -ne 4) { return $null }",
  "  $prefix = $parts[0] + '.' + $parts[1] + '.' + $parts[2]",
  "  $self = $local.IPAddress",
  "  $try = [System.Collections.Generic.List[string]]::new()",
  "  $cfg = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan\\alwatan-server.txt'",
  "  if (Test-Path -LiteralPath $cfg) {",
  "    foreach ($line in Get-Content -LiteralPath $cfg -ErrorAction SilentlyContinue) {",
  "      if ($line -match 'SERVER_IP\\s*=\\s*(\\d+\\.\\d+\\.\\d+\\.\\d+)') { [void]$try.Add($Matches[1]) }",
  "    }",
  "  }",
  "  Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue |",
  "    Where-Object { $_.IPAddress -like ($prefix + '.*') -and $_.State -match 'Reachable|Stale|Permanent' } |",
  "    ForEach-Object { [void]$try.Add($_.IPAddress) }",
  "  $seen = @{}",
  "  foreach ($ip in $try) {",
  "    if (-not $ip -or $seen.ContainsKey($ip) -or $ip -eq $self) { continue }",
  "    $seen[$ip] = $true",
    "    if (Test-AlwatanHostPort -HostIp $ip -PortNum $PortNum) { return ('http://' + $ip + ':' + $PortNum + '/') }",
  "  }",
  "  # Scan rapide limité (évite 45 s sur tout le sous-réseau) — .1 gateway + plages courantes",
  "  $quick = @([int]$parts[3])",
  "  foreach ($n in @(1,2,10,50,54,100,150,200,254)) { if ($quick -notcontains $n) { $quick += $n } }",
  "  foreach ($i in $quick) {",
  "    $ip = $prefix + '.' + $i",
  "    if ($ip -eq $self -or $seen.ContainsKey($ip)) { continue }",
  "    $seen[$ip] = $true",
  "    if (Test-AlwatanHostPort -HostIp $ip -PortNum $PortNum) { return ('http://' + $ip + ':' + $PortNum + '/') }",
  "  }",
  "  return $null",
  "}",
].join("\r\n");

/** Lanceur client : Ethernet/LAN d’abord, Tailscale en secours (un seul raccourci). */
function buildClientLauncherPs1(wifiUrl: string, tailscaleUrl: string): string {
  const wifi = wifiUrl.replace(/'/g, "''");
  const ts = tailscaleUrl.replace(/'/g, "''");
  const rev = LAUNCHER_REVISION.replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Continue'",
    `$wifi = '${wifi}'`,
    `$ts = '${ts}'`,
    `$launcherRevision = '${rev}'`,
    "",
    "function Test-AlwatanUrl([string]$Url) {",
    "  if (-not $Url) { return $false }",
    "  try {",
    "    $base = $Url.TrimEnd('/')",
    "    $r = Invoke-WebRequest -Uri ($base + '/api/health') -UseBasicParsing -TimeoutSec 1",
    "    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400)",
    "  } catch { return $false }",
    "}",
    "",
    "function Test-IsTailscaleUrl([string]$Url) {",
    "  if (-not $Url) { return $false }",
    "  try {",
    "    $h = ([uri]$Url).Host",
    "    if ($h -notmatch '^100\\.(\\d+)\\.') { return $false }",
    "    $n = [int]$Matches[1]",
    "    return ($n -ge 64 -and $n -le 127)",
    "  } catch { return $false }",
    "}",
    "",
    FIND_SERVER_ON_LAN_PS1,
    "",
    "function Sync-AlwatanLauncherFromServer([string]$BaseUrl) {",
    "  if (-not $BaseUrl) { return }",
    "  try {",
    "    $base = $BaseUrl.TrimEnd('/')",
    "    $info = Invoke-RestMethod -Uri ($base + '/api/client-setup/info?_=' + [guid]::NewGuid().ToString('N')) -TimeoutSec 4",
    "    if ($info.wifiUrl) { $script:wifi = [string]$info.wifiUrl }",
    "    if ($null -ne $info.tailscaleUrl) { $script:ts = [string]$info.tailscaleUrl }",
    "    $store = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan'",
    "    if (-not (Test-Path -LiteralPath $store)) { New-Item -ItemType Directory -Path $store -Force | Out-Null }",
    "    $cfg = Join-Path $store 'alwatan-server.txt'",
    "    try {",
    "      $wifiHost = ([uri]$script:wifi).Host",
    "      $lines = @('SERVER_IP=' + $wifiHost)",
    "      if ($script:ts) {",
    "        try { $tsHost = ([uri]$script:ts).Host; if ($tsHost -and $tsHost -ne $wifiHost) { $lines += ('TAILSCALE_IP=' + $tsHost) } } catch {}",
    "      }",
    '      [System.IO.File]::WriteAllText($cfg, (($lines -join "`r`n") + "`r`n"), [System.Text.UTF8Encoding]::new($false))',
    "      $desk = [Environment]::GetFolderPath('Desktop')",
    "      $lanUrl = $script:wifi.TrimEnd('/') + '/'",
    "      @('Alwatan Manager (Wi-Fi).url','Ouvrir Alwatan (reseau).url') | ForEach-Object {",
    "        $p = Join-Path $desk $_",
    "        if (Test-Path -LiteralPath $p) { Set-Content -LiteralPath $p -Value ('[InternetShortcut]' + \"`r`n\" + 'URL=' + $lanUrl) -Encoding ASCII }",
    "      }",
    "      if ($script:ts) {",
    "        $tsUrl = $script:ts.TrimEnd('/') + '/'",
    "        $tp = Join-Path $desk 'Alwatan Manager (Tailscale).url'",
    "        if (Test-Path -LiteralPath $tp) { Set-Content -LiteralPath $tp -Value ('[InternetShortcut]' + \"`r`n\" + 'URL=' + $tsUrl) -Encoding ASCII }",
    "      }",
    "    } catch {}",
    "    $out = Join-Path $store 'lancer-alwatan-bureau.ps1'",
    "    $tmp = $out + '.new'",
    "    Invoke-WebRequest -Uri ($base + '/api/client-setup/client-launcher.ps1?_=' + [guid]::NewGuid().ToString('N')) -OutFile $tmp -UseBasicParsing -TimeoutSec 8",
    "    if ((Get-Item -LiteralPath $tmp).Length -gt 200) { Move-Item -LiteralPath $tmp -Destination $out -Force }",
    "    $vbs = Join-Path $store 'lancer-alwatan-bureau.vbs'",
    "    try {",
    "      $vbsTmp = $vbs + '.new'",
    "      Invoke-WebRequest -Uri ($base + '/api/client-setup/client-launcher.vbs?_=' + [guid]::NewGuid().ToString('N')) -OutFile $vbsTmp -UseBasicParsing -TimeoutSec 8",
    "      if ((Get-Item -LiteralPath $vbsTmp).Length -gt 20) { Move-Item -LiteralPath $vbsTmp -Destination $vbs -Force }",
    "    } catch {}",
    "    try {",
    "      $boot = Join-Path $store 'bootstrap-alwatan.ps1'",
    "      $bootTmp = $boot + '.new'",
    "      Invoke-WebRequest -Uri ($base + '/api/client-setup/bootstrap-alwatan.ps1?_=' + [guid]::NewGuid().ToString('N')) -OutFile $bootTmp -UseBasicParsing -TimeoutSec 8",
    "      if ((Get-Item -LiteralPath $bootTmp).Length -gt 50) { Move-Item -LiteralPath $bootTmp -Destination $boot -Force }",
    "    } catch {}",
    "    try {",
    "      $upd = Join-Path $store 'update-desktop-shortcut.ps1'",
    "      $updTmp = $upd + '.new'",
    "      Invoke-WebRequest -Uri ($base + '/api/client-setup/update-desktop-shortcut.ps1?_=' + [guid]::NewGuid().ToString('N')) -OutFile $updTmp -UseBasicParsing -TimeoutSec 8",
    "      if ((Get-Item -LiteralPath $updTmp).Length -gt 50) { Move-Item -LiteralPath $updTmp -Destination $upd -Force }",
    "    } catch {}",
    "    try {",
    "      $protoVbs = Join-Path $store 'alwatan-protocol.vbs'",
    "      $protoTmp = $protoVbs + '.new'",
    "      Invoke-WebRequest -Uri ($base + '/api/client-setup/alwatan-protocol.vbs?_=' + [guid]::NewGuid().ToString('N')) -OutFile $protoTmp -UseBasicParsing -TimeoutSec 8",
    "      if ((Get-Item -LiteralPath $protoTmp).Length -gt 20) { Move-Item -LiteralPath $protoTmp -Destination $protoVbs -Force }",
    "      $protoKey = 'HKCU:\\Software\\Classes\\alwatan'",
    "      New-Item -Path $protoKey -Force | Out-Null",
    "      Set-ItemProperty -Path $protoKey -Name '(Default)' -Value 'URL:Alwatan Protocol'",
    "      Set-ItemProperty -Path $protoKey -Name 'URL Protocol' -Value ''",
    "      New-Item -Path ($protoKey + '\\shell\\open\\command') -Force | Out-Null",
    "      Set-ItemProperty -Path ($protoKey + '\\shell\\open\\command') -Name '(Default)' -Value ('wscript.exe \"' + $protoVbs + '\" \"%1\"')",
    "    } catch {}",
    "    try {",
    "      $desk = [Environment]::GetFolderPath('Desktop')",
    "      $icoStore = Join-Path $store 'alwatan.ico'",
    "      $icoDesk = Join-Path $desk 'alwatan.ico'",
    "      if (-not (Test-Path -LiteralPath $icoStore)) {",
    "        Invoke-WebRequest -Uri ($base + '/api/client-setup/alwatan.ico') -OutFile $icoStore -UseBasicParsing -TimeoutSec 8",
    "      }",
    "      if (Test-Path -LiteralPath $icoStore) { Copy-Item -LiteralPath $icoStore -Destination $icoDesk -Force -ErrorAction SilentlyContinue }",
    "      $launcherVbs = Join-Path $store 'lancer-alwatan-bureau.vbs'",
    "      if (Test-Path -LiteralPath $launcherVbs) {",
    "        $shell = New-Object -ComObject WScript.Shell",
    "        $lnkPath = Join-Path $desk 'Alwatan Manager.lnk'",
    "        $s = $shell.CreateShortcut($lnkPath)",
    "        $s.TargetPath = $launcherVbs",
    "        $s.WorkingDirectory = $store",
    "        $s.WindowStyle = 1",
    "        $s.Description = 'Clinique Alwatan - Ethernet puis Tailscale'",
    "        if (Test-Path -LiteralPath $icoDesk) { $s.IconLocation = $icoDesk + ',0' }",
    "        $s.Save()",
    "      }",
    "    } catch {}",
    "  } catch {}",
    "}",
    "",
    "function Open-AlwatanUrl([string]$Url) {",
    "  if (-not $Url) { return }",
    "  $openUrl = $Url",
    "  try {",
    "    $base = $Url.TrimEnd('/')",
    "    $store = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan'",
    "    $revFile = Join-Path $store 'launcher-revision.txt'",
    "    $localRev = ''",
    "    if (Test-Path -LiteralPath $revFile) {",
    "      try { $localRev = ([string](Get-Content -LiteralPath $revFile -TotalCount 1 -ErrorAction SilentlyContinue)).Trim() } catch {}",
    "    }",
    "    $launcherPs1 = Join-Path $store 'lancer-alwatan-bureau.ps1'",
    "    Sync-AlwatanLauncherFromServer $base",
    "    try {",
    "      if (-not (Test-Path -LiteralPath $store)) { New-Item -ItemType Directory -Path $store -Force | Out-Null }",
    "      Set-Content -LiteralPath $revFile -Value $launcherRevision -Encoding ASCII",
    "    } catch {}",
    "    $ver = Invoke-RestMethod -Uri ($base + '/api/app-version?_=' + [guid]::NewGuid().ToString('N')) -TimeoutSec 1",
    "    if ($ver -and $ver.buildId) {",
    "      $q = [uri]::EscapeDataString([string]$ver.buildId)",
    "      $openUrl = $Url.TrimEnd('/') + '/?v=' + $q",
    "    }",
    "  } catch { }",
    "  $profileRoot = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan\\app-browser'",
    "  $defaultDir = Join-Path $profileRoot 'Default'",
    "  if (-not (Test-Path -LiteralPath $defaultDir)) { New-Item -ItemType Directory -Path $defaultDir -Force | Out-Null }",
    "  $prefsPath = Join-Path $defaultDir 'Preferences'",
    "  $prefsMarker = Join-Path $defaultDir '.alwatan-print-ok'",
    "  if (-not (Test-Path -LiteralPath $prefsMarker)) {",
    "  try {",
    "    $ticketSticky = '{\"version\":2,\"isHeaderFooterEnabled\":false,\"isCssBackgroundEnabled\":true,\"isLandscapeEnabled\":false,\"marginsType\":1,\"scaling\":\"100\",\"scalingType\":0,\"scalingTypePdf\":0,\"mediaSize\":{\"width_microns\":80000,\"height_microns\":120000,\"custom_display_name\":\"Alwatan Ticket 80mm\",\"is_default\":true}}'",
    "    $prefs = @{ printing = @{ print_header_footer = $false; print_preview_sticky_settings = @{ appState = $ticketSticky } } }",
    "    if (Test-Path -LiteralPath $prefsPath) {",
    "      $existing = Get-Content -LiteralPath $prefsPath -Raw -Encoding UTF8 | ConvertFrom-Json",
    "      if ($existing) {",
    "        if (-not $existing.printing) { $existing | Add-Member printing ([pscustomobject]@{}) -Force }",
    "        $existing.printing | Add-Member print_header_footer $false -Force",
    "        $existing.printing | Add-Member print_preview_sticky_settings ([pscustomobject]@{ appState = $ticketSticky }) -Force",
    "        $prefsJson = $existing | ConvertTo-Json -Depth 40",
    "      } else { $prefsJson = ($prefs | ConvertTo-Json -Depth 10) }",
    "    } else { $prefsJson = ($prefs | ConvertTo-Json -Depth 10) }",
    "    $utf8 = New-Object System.Text.UTF8Encoding $false",
    "    [System.IO.File]::WriteAllText($prefsPath, $prefsJson, $utf8)",
    "    Set-Content -LiteralPath $prefsMarker -Value '1' -Encoding ASCII",
    "  } catch { }",
    "  }",
    "  $browserArgs = @('--user-data-dir=' + $profileRoot, '--no-first-run', '--no-default-browser-check', '--start-maximized')",
    "  $bounds = $null",
    "  try {",
    "    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop",
    "    $scr = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position)",
    "    if (-not $scr) { $scr = [System.Windows.Forms.Screen]::PrimaryScreen }",
    "    $b = $scr.WorkingArea",
    "    if ($b.Width -gt 0 -and $b.Height -gt 0) {",
    "      $bounds = @{ X = [int]$b.X; Y = [int]$b.Y; Width = [int]$b.Width; Height = [int]$b.Height }",
    "      $browserArgs += @(('--window-position=' + $b.X + ',' + $b.Y), ('--window-size=' + $b.Width + ',' + $b.Height))",
    "    }",
    "  } catch { }",
    "  $browserArgs += ('--app=' + $openUrl)",
    "  $edge = @(",
    "    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\\Edge\\Application\\msedge.exe'),",
    "    (Join-Path $env:ProgramFiles 'Microsoft\\Edge\\Application\\msedge.exe'),",
    "    (Join-Path $env:LOCALAPPDATA 'Microsoft\\Edge\\Application\\msedge.exe')",
    "  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1",
    "  $chrome = @(",
    "    (Join-Path $env:ProgramFiles 'Google\\Chrome\\Application\\chrome.exe'),",
    "    (Join-Path ${env:ProgramFiles(x86)} 'Google\\Chrome\\Application\\chrome.exe'),",
    "    (Join-Path $env:LOCALAPPDATA 'Google\\Chrome\\Application\\chrome.exe')",
    "  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1",
    "  $browserExe = if ($edge) { $edge } elseif ($chrome) { $chrome } else { $null }",
    "  if ($browserExe) {",
    "    Start-Process -FilePath $browserExe -ArgumentList $browserArgs",
    "    if (-not ('AlwatanWin32Maximize' -as [type])) {",
    "      Add-Type -TypeDefinition 'using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text; public static class AlwatanWin32Maximize { public const int SW_RESTORE=9; public const int SW_SHOWMAXIMIZED=3; public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint); [DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam); [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId); [DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect); [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; } public static List<IntPtr> FindVisibleWindowsForPid(int processId) { var list = new List<IntPtr>(); EnumWindows((hWnd, lParam) => { if (!IsWindowVisible(hWnd)) return true; uint pid; GetWindowThreadProcessId(hWnd, out pid); if ((int)pid != processId) return true; RECT r; if (!GetWindowRect(hWnd, out r)) return true; if ((r.Right-r.Left)<200 || (r.Bottom-r.Top)<200) return true; list.Add(hWnd); return true; }, IntPtr.Zero); return list; } }'",
    "    }",
    "    $deadline = [Environment]::TickCount + 20000",
    "    while ([Environment]::TickCount -lt $deadline) {",
    "      $procs = Get-CimInstance Win32_Process -EA SilentlyContinue | Where-Object { ($_.Name -match '^(msedge|chrome)\\.exe$') -and $_.CommandLine -and ($_.CommandLine -like '*CliniqueAlwatan*app-browser*') }",
    "      foreach ($proc in @($procs)) {",
    "        foreach ($hwnd in [AlwatanWin32Maximize]::FindVisibleWindowsForPid([int]$proc.ProcessId)) {",
    "          [AlwatanWin32Maximize]::ShowWindow($hwnd, 9) | Out-Null",
    "          if ($bounds) { [AlwatanWin32Maximize]::MoveWindow($hwnd, $bounds.X, $bounds.Y, $bounds.Width, $bounds.Height, $true) | Out-Null; Start-Sleep -Milliseconds 80 }",
    "          [AlwatanWin32Maximize]::ShowWindow($hwnd, 3) | Out-Null",
    "          [AlwatanWin32Maximize]::SetForegroundWindow($hwnd) | Out-Null",
    "          Start-Sleep -Milliseconds 800",
    "          [AlwatanWin32Maximize]::ShowWindow($hwnd, 3) | Out-Null",
    "          return",
    "        }",
    "      }",
    "      Start-Sleep -Milliseconds 250",
    "    }",
    "  } else { Start-Process $openUrl }",
    "}",
    "",
    "$candidates = New-Object System.Collections.Generic.List[string]",
    "function Add-CandidateUrl([string]$Url) {",
    "  if (-not $Url) { return }",
    "  $u = $Url.TrimEnd('/') + '/'",
    "  if (-not $candidates.Contains($u)) { [void]$candidates.Add($u) }",
    "}",
    "$cfgPath = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan\\alwatan-server.txt'",
    "if (Test-Path -LiteralPath $cfgPath) {",
    "  foreach ($line in Get-Content -LiteralPath $cfgPath -ErrorAction SilentlyContinue) {",
    "    if ($line -match 'SERVER_IP\\s*=\\s*(\\d+\\.\\d+\\.\\d+\\.\\d+)') {",
    "      Add-CandidateUrl ('http://' + $Matches[1] + ':4000/')",
    "    }",
    "    if ($line -match 'TAILSCALE_IP\\s*=\\s*(\\d+\\.\\d+\\.\\d+\\.\\d+)') {",
    "      Add-CandidateUrl ('http://' + $Matches[1] + ':4000/')",
    "    }",
    "  }",
    "}",
    "if ($wifi -and -not (Test-IsTailscaleUrl $wifi)) { Add-CandidateUrl $wifi }",
    "if ($ts -and $ts -ne $wifi) { Add-CandidateUrl $ts }",
    "if ($wifi -and (Test-IsTailscaleUrl $wifi) -and -not $candidates.Contains($wifi.TrimEnd('/') + '/')) { Add-CandidateUrl $wifi }",
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
    "  $found = Find-AlwatanServerOnLan -PortNum 4000",
    "  if ($found -and (Test-AlwatanUrl $found)) {",
    "    Open-AlwatanUrl $found",
    "    $opened = $true",
    "  }",
    "}",
    "",
    "if (-not $opened) {",
    "  $fallback = $null",
    "  if ($wifi -and -not (Test-IsTailscaleUrl $wifi)) { $fallback = $wifi }",
    "  elseif ($wifi) { $fallback = $wifi }",
    "  elseif ($ts) { $fallback = $ts }",
    "  elseif ($candidates.Count -gt 0) { $fallback = $candidates[0] }",
    "  if ($fallback) { Open-AlwatanUrl $fallback }",
    "}",
  ].join("\r\n");
}

/** Bootstrap Bureau : récupère le lanceur à jour (Wi‑Fi puis Tailscale), puis l’exécute. */
function buildBootstrapPs1(wifiUrl: string, tailscaleUrl: string): string {
  const wifi = (wifiUrl || "").replace(/'/g, "''").replace(/\/?$/, "");
  const ts = (tailscaleUrl || "").replace(/'/g, "''").replace(/\/?$/, "");
  return [
    "$ErrorActionPreference = 'Continue'",
    `$seeds = @('${wifi}','${ts}') | Where-Object { $_ }`,
    FIND_SERVER_ON_LAN_PS1,
    "$store = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan'",
    "New-Item -ItemType Directory -Force -Path $store | Out-Null",
    "$ps1 = Join-Path $store 'lancer-alwatan-bureau.ps1'",
    "$vbs = Join-Path $store 'lancer-alwatan-bureau.vbs'",
    "$cfgPath = Join-Path $store 'alwatan-server.txt'",
    "if (Test-Path -LiteralPath $cfgPath) {",
    "  foreach ($line in Get-Content -LiteralPath $cfgPath -ErrorAction SilentlyContinue) {",
    "    if ($line -match 'SERVER_IP\\s*=\\s*(\\d+\\.\\d+\\.\\d+\\.\\d+)') {",
    "      $seedUrl = 'http://' + $Matches[1] + ':4000/'",
    "      if ($seeds -notcontains $seedUrl) { $seeds = @($seedUrl) + $seeds }",
    "    }",
    "    if ($line -match 'TAILSCALE_IP\\s*=\\s*(\\d+\\.\\d+\\.\\d+\\.\\d+)') {",
    "      $seedUrl = 'http://' + $Matches[1] + ':4000/'",
    "      if ($seeds -notcontains $seedUrl) { $seeds += $seedUrl }",
    "    }",
    "  }",
    "}",
    "function Test-SeedReachable([string]$Base) {",
    "  if (-not $Base) { return $false }",
    "  try {",
    "    $r = Invoke-WebRequest -Uri ($Base.TrimEnd('/') + '/api/health') -UseBasicParsing -TimeoutSec 3",
    "    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400)",
    "  } catch { return $false }",
    "}",
    "function Download-AlwatanLauncher([string]$Base) {",
    "  if (-not $Base) { return $false }",
    "  try {",
    "    $base = $Base.TrimEnd('/')",
    "    Invoke-WebRequest -Uri ($base + '/api/client-setup/client-launcher.ps1?_=' + [guid]::NewGuid().ToString('N')) -OutFile $ps1 -UseBasicParsing -TimeoutSec 6",
    "    if ((Get-Item -LiteralPath $ps1).Length -gt 200) {",
    "      try {",
    "        Invoke-WebRequest -Uri ($base + '/api/client-setup/client-launcher.vbs?_=' + [guid]::NewGuid().ToString('N')) -OutFile $vbs -UseBasicParsing -TimeoutSec 6",
    "      } catch {}",
    "      return $true",
    "    }",
    "  } catch {}",
    "  return $false",
    "}",
    "$downloaded = $false",
    "foreach ($b in $seeds) {",
    "  if (Test-SeedReachable $b) {",
    "    if (Download-AlwatanLauncher $b) { $downloaded = $true; break }",
    "  }",
    "}",
    "if (-not $downloaded) {",
    "  $found = Find-AlwatanServerOnLan -PortNum 4000",
    "  if ($found -and (Download-AlwatanLauncher $found)) { $downloaded = $true }",
    "}",
    "if (Test-Path -LiteralPath $ps1) { & $ps1 }",
  ].join("\r\n");
}

function buildSilentVbs(): string {
  return [
    'Set sh = CreateObject("WScript.Shell")',
    'store = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\\CliniqueAlwatan"',
    'boot = store & "\\bootstrap-alwatan.ps1"',
    'ps1 = store & "\\lancer-alwatan-bureau.ps1"',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'If fso.FileExists(boot) Then',
    '  sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & boot & """", 0, False',
    'ElseIf fso.FileExists(ps1) Then',
    '  sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """", 0, False',
    'End If',
  ].join("\r\n");
}

function buildProtocolHandlerVbs(): string {
  return [
    'On Error Resume Next',
    'Set sh = CreateObject("WScript.Shell")',
    'store = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\\CliniqueAlwatan"',
    'updatePs1 = store & "\\update-desktop-shortcut.ps1"',
    'installPs1 = store & "\\install-desktop-shortcut-cached.ps1"',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'If fso.FileExists(updatePs1) Then',
    '  sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & updatePs1 & """", 0, False',
    'ElseIf fso.FileExists(installPs1) Then',
    '  sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & installPs1 & """", 0, False',
    'End If',
  ].join("\r\n");
}

/** Script local : met à jour le raccourci Bureau sans nouveau téléchargement utilisateur. */
function buildUpdateShortcutPs1(apiBase: string): string {
  const api = escapePsSingleQuoted(apiBase.replace(/\/$/, ""));
  return [
    "$ErrorActionPreference = 'Stop'",
    `$api = '${api}'`,
    "$cfg = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan\\alwatan-server.txt'",
    "if (Test-Path -LiteralPath $cfg) {",
    "  foreach ($line in Get-Content -LiteralPath $cfg -ErrorAction SilentlyContinue) {",
    "    if ($line -match 'SERVER_IP\\s*=\\s*(\\d+\\.\\d+\\.\\d+\\.\\d+)') {",
    "      $api = 'http://' + $Matches[1] + ':4000'",
    "      break",
    "    }",
    "  }",
    "}",
    "$tmp = Join-Path $env:TEMP ('alwatan-auto-update-' + [guid]::NewGuid().ToString('N') + '.ps1')",
    "try {",
    "  Invoke-WebRequest -Uri ($api.TrimEnd('/') + '/api/client-setup/install-desktop-shortcut.ps1?_=' + [guid]::NewGuid().ToString('N')) -OutFile $tmp -UseBasicParsing -TimeoutSec 30",
    "  & $tmp",
    "} finally {",
    "  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue",
    "}",
  ].join("\r\n");
}

function buildRegisterProtocolPs1Snippet(): string {
  return [
    "$protoVbs = Join-Path $store 'alwatan-protocol.vbs'",
    "$protoKey = 'HKCU:\\Software\\Classes\\alwatan'",
    "New-Item -Path $protoKey -Force | Out-Null",
    "Set-ItemProperty -Path $protoKey -Name '(Default)' -Value 'URL:Alwatan Protocol'",
    "Set-ItemProperty -Path $protoKey -Name 'URL Protocol' -Value ''",
    "New-Item -Path ($protoKey + '\\shell\\open\\command') -Force | Out-Null",
    "Set-ItemProperty -Path ($protoKey + '\\shell\\open\\command') -Name '(Default)' -Value ('wscript.exe \"' + $protoVbs + '\" \"%1\"')",
  ].join("\r\n");
}

/** Installe 1 raccourci Bureau (icône Alwatan) branché sur le lanceur Ethernet → Tailscale. */
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
  const bootstrapB64 = Buffer.from(
    buildBootstrapPs1(wifiUrl, tsUrl),
    "utf8",
  ).toString("base64");
  const vbsB64 = Buffer.from(buildSilentVbs(), "utf8").toString("base64");
  const protocolVbsB64 = Buffer.from(buildProtocolHandlerVbs(), "utf8").toString("base64");
  const updatePs1B64 = Buffer.from(buildUpdateShortcutPs1(opts.apiBase), "utf8").toString(
    "base64",
  );

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

$bootstrapPs1 = Join-Path $store 'bootstrap-alwatan.ps1'
$bootstrapBytes = [Convert]::FromBase64String('${bootstrapB64}')
[System.IO.File]::WriteAllBytes($bootstrapPs1, $bootstrapBytes)

$launcherVbs = Join-Path $store 'lancer-alwatan-bureau.vbs'
$vbsBytes = [Convert]::FromBase64String('${vbsB64}')
[System.IO.File]::WriteAllBytes($launcherVbs, $vbsBytes)

$protoVbsPath = Join-Path $store 'alwatan-protocol.vbs'
$protoBytes = [Convert]::FromBase64String('${protocolVbsB64}')
[System.IO.File]::WriteAllBytes($protoVbsPath, $protoBytes)

$updatePs1 = Join-Path $store 'update-desktop-shortcut.ps1'
$updateBytes = [Convert]::FromBase64String('${updatePs1B64}')
[System.IO.File]::WriteAllBytes($updatePs1, $updateBytes)
Copy-Item -LiteralPath $launcherPs1 -Destination (Join-Path $store 'install-desktop-shortcut-cached.ps1') -Force -ErrorAction SilentlyContinue

try {
  Set-Content -LiteralPath (Join-Path $store 'launcher-revision.txt') -Value '${LAUNCHER_REVISION}' -Encoding ASCII
} catch {}

${buildRegisterProtocolPs1Snippet()}

@(
  'Alwatan Manager (Tailscale).lnk',
  'Alwatan Manager (Tailscale).url',
  'Alwatan Manager (Wi-Fi).url',
  'Alwatan Manager (Wi-Fi).lnk',
  'Alwatan Manager (Ethernet).url',
  'Alwatan Manager (direct).url',
  'Alwatan Manager (direct).bat',
  'Alwatan Manager.lnk'
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
$s.Description = 'Clinique Alwatan - Ethernet puis Tailscale'
$s.IconLocation = $icoDesk + ',0'
$s.Save()

Write-Host ('OK - Bureau : ' + $desk)
Write-Host '  - Alwatan Manager.lnk (nouveau : Ethernet puis Tailscale)'
Write-Host '  - alwatan.ico (icone clinique sur le Bureau)'
`.trim();
}

function buildDesktopShortcutCmd(opts: {
  apiBase: string;
  wifiUrl: string;
  tailscaleUrl: string;
  silent?: boolean;
}): string {
  // Petit bootstrap EncodedCommand : l'ancien script (~45 Ko) depassait CreateProcess.
  const api = opts.apiBase.replace(/\/$/, "");
  const ps1Url = `${api}/api/client-setup/install-desktop-shortcut.ps1`.replace(
    /'/g,
    "''",
  );
  const silent = Boolean(opts.silent);
  const bootstrap = [
    "$ErrorActionPreference = 'Stop'",
    `$u = '${ps1Url}'`,
    "$p = Join-Path $env:TEMP ('alwatan-install-desk-' + [guid]::NewGuid().ToString('N') + '.ps1')",
    "try {",
    "  Invoke-WebRequest -Uri $u -OutFile $p -UseBasicParsing -TimeoutSec 30",
    "  & $p",
    "} finally {",
    "  Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue",
    "}",
  ].join("\r\n");
  const encoded = Buffer.from(bootstrap, "utf16le").toString("base64");

  return [
    "@echo off",
    "setlocal EnableExtensions",
    "title Alwatan Manager - raccourci Bureau",
    ...(silent
      ? []
      : [
          "echo.",
          "echo   Telechargement du nouveau raccourci Bureau (IP Ethernet actuelle)...",
          "echo.",
        ]),
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
    "if errorlevel 1 (",
    ...(silent
      ? ["  exit /b 1"]
      : [
          "  echo.",
          "  echo Echec. Verifiez la connexion au serveur puis reessayez.",
          "  pause",
          "  exit /b 1",
        ]),
    ")",
    ...(silent
      ? ["exit /b 0"]
      : [
          "echo.",
          "echo Termine. Nouveau raccourci Alwatan Manager : Ethernet puis Tailscale.",
          "echo.",
          "pause",
        ]),
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
    syncShortcutUrl: "/api/client-setup/sync-desktop-shortcut.cmd",
    autoUpdateProtocol: "alwatan:sync",
    androidShortcutUrl: "/api/client-setup/android-shortcut.html",
    launcherUrl: "/api/client-setup/launcher.cmd",
    packageUrl: findSetupZip() ? "/api/client-setup/package.zip" : null,
    packageAvailable: Boolean(findSetupZip()),
    launcherRevision: LAUNCHER_REVISION,
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

function resolveWifiAndTailscaleUrls(req: Request): {
  wifiUrl: string;
  tailscaleUrl: string;
  apiBase: string;
} {
  const bases = resolveAccessBases(req);
  // Priorité : IP actuellement utilisée dans le navigateur (Ethernet DHCP),
  // pour que le fichier téléchargé pointe vers cette adresse.
  let wifiUrl = bases.primary;
  try {
    if (wifiUrl && isTailscaleHost(new URL(wifiUrl).hostname)) {
      wifiUrl = bases.wifi ?? bases.hotspot ?? bases.primary;
      if (wifiUrl && isTailscaleHost(new URL(wifiUrl).hostname)) {
        wifiUrl = bases.primary;
      }
    }
  } catch {
    /* keep wifiUrl */
  }
  return {
    wifiUrl,
    tailscaleUrl: bases.tailscale ?? "",
    apiBase: wifiUrl,
  };
}

router.get("/client-launcher.ps1", (req, res) => {
  const { wifiUrl, tailscaleUrl } = resolveWifiAndTailscaleUrls(req);
  const body = buildClientLauncherPs1(
    wifiUrl.replace(/\/?$/, "/"),
    tailscaleUrl ? tailscaleUrl.replace(/\/?$/, "/") : "",
  );
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'inline; filename="lancer-alwatan-bureau.ps1"',
  );
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
});

router.get("/client-launcher.vbs", (_req, res) => {
  const body = buildSilentVbs();
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'inline; filename="lancer-alwatan-bureau.vbs"',
  );
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
});

router.get("/bootstrap-alwatan.ps1", (req, res) => {
  const { wifiUrl, tailscaleUrl } = resolveWifiAndTailscaleUrls(req);
  const body = buildBootstrapPs1(
    wifiUrl.replace(/\/?$/, "/"),
    tailscaleUrl ? tailscaleUrl.replace(/\/?$/, "/") : "",
  );
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'inline; filename="bootstrap-alwatan.ps1"',
  );
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
});

router.get("/update-desktop-shortcut.ps1", (req, res) => {
  const { apiBase } = resolveWifiAndTailscaleUrls(req);
  const body = buildUpdateShortcutPs1(apiBase);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'inline; filename="update-desktop-shortcut.ps1"',
  );
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
});

router.get("/alwatan-protocol.vbs", (_req, res) => {
  const body = buildProtocolHandlerVbs();
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'inline; filename="alwatan-protocol.vbs"',
  );
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
});

router.get("/install-desktop-shortcut.ps1", (req, res) => {
  const { wifiUrl, tailscaleUrl, apiBase } = resolveWifiAndTailscaleUrls(req);
  if (!findAlwatanIcon()) {
    res.status(404).type("text/plain").send("Icone alwatan.ico introuvable sur le serveur.");
    return;
  }
  const body = buildDesktopShortcutPs1({ apiBase, wifiUrl, tailscaleUrl });
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'inline; filename="install-desktop-shortcut.ps1"',
  );
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
});

router.get("/install-desktop-shortcut.cmd", (req, res) => {
  const { wifiUrl, tailscaleUrl, apiBase } = resolveWifiAndTailscaleUrls(req);
  if (!findAlwatanIcon()) {
    res.status(404).json({
      error:
        "Icône alwatan.ico introuvable. Sur le serveur, lancez scripts\\installer-raccourcis-bureau.ps1.",
    });
    return;
  }

  const body = buildDesktopShortcutCmd({
    apiBase,
    wifiUrl,
    tailscaleUrl,
    silent: false,
  });

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="Telecharger-Raccourci-Alwatan-Bureau.cmd"',
  );
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
});

/** Ancien endpoint « sync » : télécharge un installateur neuf (plus de simple mise à jour). */
router.get("/sync-desktop-shortcut.cmd", (req, res) => {
  const { wifiUrl, tailscaleUrl, apiBase } = resolveWifiAndTailscaleUrls(req);
  if (!findAlwatanIcon()) {
    res.status(404).json({
      error:
        "Icône alwatan.ico introuvable. Sur le serveur, lancez scripts\\installer-raccourcis-bureau.ps1.",
    });
    return;
  }

  const body = buildDesktopShortcutCmd({
    apiBase,
    wifiUrl,
    tailscaleUrl,
    silent: false,
  });

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="Telecharger-Nouveau-Raccourci-Alwatan.cmd"',
  );
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
});

router.get("/android-shortcut.html", (req, res) => {
  const bases = resolveAccessBases(req);
  const wifiUrl = `${(bases.wifi ?? bases.primary).replace(/\/?$/, "/")}`;
  const tailscaleUrl = bases.tailscale
    ? `${bases.tailscale.replace(/\/?$/, "/")}`
    : "";
  // URL absolue : le fichier HTML s’ouvre aussi depuis Téléchargements (file://)
  const iconBase = (bases.wifi ?? bases.tailscale ?? bases.primary).replace(/\/?$/, "");
  const iconUrl = `${iconBase}/pwa/icon-192.png`;
  const html = buildAndroidShortcutHtml({
    wifiUrl,
    tailscaleUrl,
    iconUrl,
  });

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
    "powershell -NoProfile -ExecutionPolicy Bypass -Command ^",
    "  $wifi=$env:WIFI_URL; $ts=$env:TS_URL;",
    "  function Test-U([string]$u){ if(-not $u){return $false}; try{$r=Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 3; return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400)}catch{return $false} };",
    "  function Open-U([string]$u){",
    "    if(-not $u){return}; $open=$u;",
    "    try{$base=$u.TrimEnd('/');$ver=Invoke-RestMethod -Uri ($base+'/api/app-version?_='+[guid]::NewGuid().ToString('N')) -TimeoutSec 3; if($ver.buildId){$open=$base+'/?v='+[uri]::EscapeDataString([string]$ver.buildId)}}catch{};",
    "    $p=Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan\\app-browser'; $d=Join-Path $p 'Default'; New-Item -ItemType Directory -Force -Path $d|Out-Null;",
    "    $prefs=Join-Path $d 'Preferences'; $sticky='{\\\"version\\\":2,\\\"isHeaderFooterEnabled\\\":false,\\\"isCssBackgroundEnabled\\\":true,\\\"isLandscapeEnabled\\\":false,\\\"marginsType\\\":1,\\\"scaling\\\":\\\"100\\\",\\\"scalingType\\\":0,\\\"scalingTypePdf\\\":0,\\\"mediaSize\\\":{\\\"width_microns\\\":80000,\\\"height_microns\\\":120000,\\\"custom_display_name\\\":\\\"Alwatan Ticket 80mm\\\",\\\"is_default\\\":true}}';",
    "    $obj=[pscustomobject]@{printing=[pscustomobject]@{print_header_footer=$false;print_preview_sticky_settings=[pscustomobject]@{appState=$sticky}}};",
    "    if(Test-Path $prefs){try{$ex=Get-Content $prefs -Raw -Encoding UTF8|ConvertFrom-Json; if($ex){if(-not $ex.printing){$ex|Add-Member printing ([pscustomobject]@{}) -Force}; $ex.printing|Add-Member print_header_footer $false -Force; $ex.printing|Add-Member print_preview_sticky_settings ([pscustomobject]@{appState=$sticky}) -Force; $obj=$ex}}catch{}};",
    "    [IO.File]::WriteAllText($prefs,($obj|ConvertTo-Json -Depth 40),(New-Object Text.UTF8Encoding $false));",
    "    $args=@('--user-data-dir='+$p,'--no-first-run','--no-default-browser-check','--start-maximized');",
    "    $bounds=$null; try{Add-Type -AssemblyName System.Windows.Forms -EA Stop;$scr=[Windows.Forms.Screen]::FromPoint([Windows.Forms.Cursor]::Position); if(-not $scr){$scr=[Windows.Forms.Screen]::PrimaryScreen}; $b=$scr.WorkingArea; if($b.Width -gt 0){$bounds=@{X=[int]$b.X;Y=[int]$b.Y;Width=[int]$b.Width;Height=[int]$b.Height}; $args+=@(('--window-position='+$b.X+','+$b.Y),('--window-size='+$b.Width+','+$b.Height))}}catch{};",
    "    $args+=('--app='+$open);",
    "    $edge=@((Join-Path ${env:ProgramFiles(x86)} 'Microsoft\\Edge\\Application\\msedge.exe'),(Join-Path $env:ProgramFiles 'Microsoft\\Edge\\Application\\msedge.exe'),(Join-Path $env:LOCALAPPDATA 'Microsoft\\Edge\\Application\\msedge.exe'))|?{Test-Path $_}|select -First 1;",
    "    $chrome=@((Join-Path $env:ProgramFiles 'Google\\Chrome\\Application\\chrome.exe'),(Join-Path ${env:ProgramFiles(x86)} 'Google\\Chrome\\Application\\chrome.exe'))|?{Test-Path $_}|select -First 1;",
    "    $exe=if($edge){$edge}elseif($chrome){$chrome}else{$null};",
    "    if($exe){Start-Process $exe -ArgumentList $args; if(-not ('AlwatanWin32Maximize' -as [type])){Add-Type -TypeDefinition 'using System;using System.Collections.Generic;using System.Runtime.InteropServices;public static class AlwatanWin32Maximize{public const int SW_RESTORE=9;public const int SW_SHOWMAXIMIZED=3;public delegate bool EnumWindowsProc(IntPtr hWnd,IntPtr lParam);[DllImport(\"user32.dll\")]public static extern bool ShowWindow(IntPtr hWnd,int nCmdShow);[DllImport(\"user32.dll\")]public static extern bool SetForegroundWindow(IntPtr hWnd);[DllImport(\"user32.dll\")]public static extern bool MoveWindow(IntPtr hWnd,int X,int Y,int nWidth,int nHeight,bool bRepaint);[DllImport(\"user32.dll\")]public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc,IntPtr lParam);[DllImport(\"user32.dll\")]public static extern bool IsWindowVisible(IntPtr hWnd);[DllImport(\"user32.dll\")]public static extern uint GetWindowThreadProcessId(IntPtr hWnd,out uint lpdwProcessId);[DllImport(\"user32.dll\")]public static extern bool GetWindowRect(IntPtr hWnd,out RECT lpRect);[StructLayout(LayoutKind.Sequential)]public struct RECT{public int Left;public int Top;public int Right;public int Bottom;}public static List<IntPtr> FindVisibleWindowsForPid(int processId){var list=new List<IntPtr>();EnumWindows((hWnd,lParam)=>{if(!IsWindowVisible(hWnd))return true;uint pid;GetWindowThreadProcessId(hWnd,out pid);if((int)pid!=processId)return true;RECT r;if(!GetWindowRect(hWnd,out r))return true;if((r.Right-r.Left)<200||(r.Bottom-r.Top)<200)return true;list.Add(hWnd);return true;},IntPtr.Zero);return list;}}'}; $end=[Environment]::TickCount+20000; while([Environment]::TickCount -lt $end){ $procs=Get-CimInstance Win32_Process -EA SilentlyContinue|?{($_.Name -match '^(msedge|chrome)\\.exe$') -and $_.CommandLine -like '*CliniqueAlwatan*app-browser*'}; foreach($proc in @($procs)){ foreach($hwnd in [AlwatanWin32Maximize]::FindVisibleWindowsForPid([int]$proc.ProcessId)){ [AlwatanWin32Maximize]::ShowWindow($hwnd,9)|Out-Null; if($bounds){[AlwatanWin32Maximize]::MoveWindow($hwnd,$bounds.X,$bounds.Y,$bounds.Width,$bounds.Height,$true)|Out-Null}; [AlwatanWin32Maximize]::ShowWindow($hwnd,3)|Out-Null; [AlwatanWin32Maximize]::SetForegroundWindow($hwnd)|Out-Null; return } }; Start-Sleep -Milliseconds 250 } } else { Start-Process $open }",
    "  };",
    "  if(Test-U $wifi){Open-U $wifi; exit 0};",
    "  if($ts -and (Test-U $ts)){Open-U $ts; exit 0};",
    "  if($wifi){Open-U $wifi; exit 1};",
    "  exit 1",
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
