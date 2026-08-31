import os from "node:os";

function isTailscaleCgNat(address: string): boolean {
  // Tailscale utilise typiquement 100.64.0.0/10
  const m = /^100\.(\d+)\./.exec(address);
  if (!m) return false;
  const second = Number(m[1]);
  return second >= 64 && second <= 127;
}

export type NetworkAccessEndpoints = {
  wifiIp: string | null;
  hotspotIp: string | null;
  tailscaleIp: string | null;
};

/** Adresses d’accès : Ethernet (prioritaire), Wi‑Fi, hotspot Windows, Tailscale. */
export function getNetworkAccessEndpoints(): NetworkAccessEndpoints {
  const nets = os.networkInterfaces();
  const ethernet: string[] = [];
  const preferred: string[] = [];
  const hotspot: string[] = [];
  const mesh: string[] = [];

  for (const [alias, entries] of Object.entries(nets)) {
    if (!entries?.length) continue;
    const lower = alias.toLowerCase();
    if (lower.includes("vether") || lower.includes("virtual") || lower.includes("hyper-v")) {
      continue;
    }
    for (const net of entries) {
      const family = String(net.family);
      if (family !== "IPv4" && family !== "4") continue;
      if (net.internal) continue;
      const address = net.address;
      if (address.startsWith("127.") || address.startsWith("169.254.")) continue;
      if (address.startsWith("192.168.137.")) {
        hotspot.push(address);
        continue;
      }
      if (isTailscaleCgNat(address) || lower.includes("tailscale")) {
        mesh.push(address);
        continue;
      }
      if (lower.startsWith("ethernet")) {
        ethernet.push(address);
        continue;
      }
      preferred.push(address);
    }
  }

  return {
    // Politique cabinet : câble d’abord, puis Wi‑Fi si pas d’Ethernet
    wifiIp: ethernet[0] ?? preferred[0] ?? null,
    hotspotIp: hotspot[0] ?? null,
    tailscaleIp: mesh[0] ?? null,
  };
}

/** Première IPv4 LAN utilisable (Wi‑Fi / Ethernet, hors hotspot / Tailscale). */
export function getLanIpv4(): string | null {
  const { wifiIp, hotspotIp, tailscaleIp } = getNetworkAccessEndpoints();
  return wifiIp ?? hotspotIp ?? tailscaleIp ?? null;
}

export function getTailscaleIpv4(): string | null {
  return getNetworkAccessEndpoints().tailscaleIp;
}

const PRIVATE_LAN_ORIGIN =
  /^https?:\/\/(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.\d{1,3}\.\d{1,3}\.\d{1,3}|[\w.-]+\.ts\.net)(?::\d+)?$/i;

export function isPrivateLanOrigin(origin: string) {
  return PRIVATE_LAN_ORIGIN.test(origin);
}

export function parseCorsOrigins(raw: string | undefined) {
  return (raw ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
