import type { NextFunction, Request, Response } from "express";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function clientKey(req: Request) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]!.trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

/** Rate limiter mémoire (processus unique — suffisant pour un serveur clinique LAN). */
export function rateLimit(options: { windowMs: number; max: number; prefix?: string }) {
  const { windowMs, max, prefix = "rl" } = options;
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${prefix}:${clientKey(req)}`;
    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    existing.count += 1;
    if (existing.count > max) {
      const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: "Trop de tentatives. Réessayez dans un instant.",
        code: "RATE_LIMITED",
      });
    }
    return next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref?.();
