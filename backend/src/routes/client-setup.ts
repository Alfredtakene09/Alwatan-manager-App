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

  // Wi‑Fi puis hotspot puis Tailscale (jamais Tailscale en premier)
  push(wifi);
  push(hotspot);
  push(tailscale);
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
    "    $base = $Url.TrimEnd('/')",
    "    $r = Invoke-WebRequest -Uri ($base + '/api/health') -UseBasicParsing -TimeoutSec 3",
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
    "  $profileRoot = Join-Path $env:LOCALAPPDATA 'CliniqueAlwatan\\app-browser'",
    "  $defaultDir = Join-Path $profileRoot 'Default'",
    "  if (-not (Test-Path -LiteralPath $defaultDir)) { New-Item -ItemType Directory -Path $defaultDir -Force | Out-Null }",
    "  $prefsPath = Join-Path $defaultDir 'Preferences'",
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
    "  } catch { }",
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
    "# Wi-Fi d'abord — ne jamais placer Tailscale en tête même si $wifi est vide/erroné",
    "if ($wifi -and -not (Test-IsTailscaleUrl $wifi)) { [void]$candidates.Add($wifi) }",
    "if ($ts -and $ts -ne $wifi) { [void]$candidates.Add($ts) }",
    "if ($wifi -and (Test-IsTailscaleUrl $wifi) -and -not $candidates.Contains($wifi)) { [void]$candidates.Add($wifi) }",
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
    "  $fallback = $null",
    "  if ($wifi -and -not (Test-IsTailscaleUrl $wifi)) { $fallback = $wifi }",
    "  elseif ($wifi) { $fallback = $wifi }",
    "  elseif ($ts) { $fallback = $ts }",
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

  // Jamais d’IP Tailscale comme URL Wi‑Fi principale
  let wifiUrl = bases.wifi ?? bases.hotspot ?? bases.primary;
  try {
    if (wifiUrl && isTailscaleHost(new URL(wifiUrl).hostname)) {
      wifiUrl = bases.hotspot ?? bases.primary;
      if (wifiUrl && isTailscaleHost(new URL(wifiUrl).hostname)) {
        // dernier recours : garder l’IP demandée mais signaler via logs clients
        wifiUrl = bases.primary;
      }
    }
  } catch {
    /* keep wifiUrl */
  }

  const body = buildDesktopShortcutCmd({
    apiBase: wifiUrl,
    wifiUrl,
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
