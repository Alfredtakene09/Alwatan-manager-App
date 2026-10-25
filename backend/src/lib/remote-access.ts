import type { NextFunction, Request, Response } from "express";

/**
 * Verrou des suppressions à distance (Tailscale / hors réseau local).
 *
 * Une requête est « à distance » dès qu’un seul indice le montre :
 * - IP cliente Tailscale (100.64.0.0/10, fd7a:115c:a1e0::/48) ou IP publique ;
 * - en-tête Host *.ts.net ou IP Tailscale ;
 * - en-têtes ajoutés par `tailscale serve` / Funnel, ou X-Forwarded-For Tailscale/public.
 *
 * Les en-têtes peuvent être forgés depuis le LAN, mais uniquement pour se
 * restreindre davantage : aucun en-tête ne peut lever le verrou.
 */

function stripIpv4Mapped(address: string): string {
  const lower = address.trim().toLowerCase();
  return lower.startsWith("::ffff:") ? lower.slice(7) : lower;
}

function parseIpv4(address: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

export function isTailscaleAddress(raw: string): boolean {
  const address = stripIpv4Mapped(raw);
  const v4 = parseIpv4(address);
  if (v4) return v4[0] === 100 && v4[1] >= 64 && v4[1] <= 127;
  return address.startsWith("fd7a:115c:a1e0:");
}

/** Loopback / réseau local du cabinet (hors Tailscale). */
export function isLocalNetworkAddress(raw: string): boolean {
  const address = stripIpv4Mapped(raw);
  const v4 = parseIpv4(address);
  if (v4) {
    const [a, b] = v4;
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (address === "::1") return true;
  if (address.startsWith("fe80:")) return true;
  // ULA fc00::/7, sauf la plage Tailscale.
  return /^f[cd][0-9a-f]{2}:/.test(address) && !isTailscaleAddress(address);
}

function isRemoteAddress(raw: string): boolean {
  if (!raw) return false;
  return isTailscaleAddress(raw) || !isLocalNetworkAddress(raw);
}

function hostnameOf(hostHeader: string): string {
  const host = hostHeader.trim().toLowerCase();
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]"));
  return host.replace(/:\d+$/, "");
}

export type RemoteAccessInput = {
  socketAddress?: string | null;
  host?: string | null;
  forwardedFor?: string | null;
  tailscaleHeader?: boolean;
};

export function isRemoteAccess(input: RemoteAccessInput): boolean {
  if (input.tailscaleHeader) return true;
  if (input.socketAddress && isRemoteAddress(input.socketAddress)) return true;
  if (input.host) {
    const hostname = hostnameOf(input.host);
    if (hostname.endsWith(".ts.net") || isTailscaleAddress(hostname)) return true;
  }
  if (input.forwardedFor) {
    for (const hop of input.forwardedFor.split(",")) {
      if (isRemoteAddress(hop.trim())) return true;
    }
  }
  return false;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.join(",");
  return value ?? null;
}

export function isRemoteRequest(req: Request): boolean {
  return isRemoteAccess({
    socketAddress: req.socket?.remoteAddress ?? null,
    host: headerValue(req.headers.host),
    forwardedFor: headerValue(req.headers["x-forwarded-for"]),
    tailscaleHeader:
      req.headers["tailscale-user-login"] != null ||
      req.headers["tailscale-funnel-request"] != null,
  });
}

/** Routes non-DELETE qui suppriment / désactivent des données (suppression logique). */
const DELETE_LIKE_PATH =
  /\/(?:[^/]*-)?(?:delete|remove|purge|reset|clear|archive|deactivate|cancel|supprimer)(?:-[^/]*)?\/?$/i;

export function isDeleteLikeRequest(method: string, path: string): boolean {
  const m = method.toUpperCase();
  if (m === "DELETE") return true;
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return false;
  return DELETE_LIKE_PATH.test(path);
}

export const REMOTE_DELETE_BLOCKED_CODE = "REMOTE_DELETE_BLOCKED";

/** Middleware /api : refuse toute suppression demandée à distance (Tailscale). */
export function blockRemoteDeletes(req: Request, res: Response, next: NextFunction) {
  if (!isDeleteLikeRequest(req.method, req.path) || !isRemoteRequest(req)) {
    next();
    return;
  }
  console.warn(
    `[remote-delete-lock] refusé ${req.method} ${req.originalUrl} depuis ${req.socket?.remoteAddress ?? "?"}`,
  );
  res.status(403).json({
    error:
      "Suppression verrouillée à distance (Tailscale). Effectuez cette action depuis un poste du réseau local de la clinique.",
    code: REMOTE_DELETE_BLOCKED_CODE,
  });
}
