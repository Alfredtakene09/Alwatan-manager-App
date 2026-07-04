import type { NextFunction, Request, Response } from "express";
import { COOKIE_NAME, verifySessionToken, type SessionUser } from "../lib/auth.js";
import { canAccessModule, canManageResources, type AppUserRole } from "../lib/roles.js";

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  try {
    req.user = await verifySessionToken(token);
    next();
  } catch {
    return res.status(401).json({ error: "Session invalide" });
  }
}

export function requireModule(module: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Non autorisé" });
    }
    if (!canAccessModule(req.user.role as AppUserRole, module)) {
      return res.status(403).json({ error: "Accès refusé" });
    }
    next();
  };
}

export function requireManageAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  if (!canManageResources(req.user.role as AppUserRole)) {
    return res.status(403).json({ error: "Accès refusé — droits de gestion requis" });
  }
  next();
}

export function requireAnyModule(...modules: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Non autorisé" });
    }
    const role = req.user.role as AppUserRole;
    const allowed = modules.some((module) => canAccessModule(role, module));
    if (!allowed) {
      return res.status(403).json({ error: "Accès refusé" });
    }
    next();
  };
}
