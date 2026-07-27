import os from "node:os";

/** Première IPv4 LAN utilisable (hors loopback / APIPA / hotspot Windows). */
export function getLanIpv4(): string | null {
  const nets = os.networkInterfaces();
  const candidates: string[] = [];

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
        candidates.push(address);
        continue;
      }
      candidates.push(address);
    }
  }

  return candidates[0] ?? null;
}

const PRIVATE_LAN_ORIGIN =
  /^https?:\/\/(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?$/;

export function isPrivateLanOrigin(origin: string) {
  return PRIVATE_LAN_ORIGIN.test(origin);
}

export function parseCorsOrigins(raw: string | undefined) {
  return (raw ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
