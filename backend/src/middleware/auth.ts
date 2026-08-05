import type { NextFunction, Request, Response } from "express";
import {
  COOKIE_NAME,
  createSessionToken,
  sessionCookieOptions,
  verifySessionToken,
  type SessionUser,
} from "../lib/auth.js";
import { prisma } from "../lib/db.js";
import {
  isAccountLocked,
  isSessionIdle,
  SESSION_ACTIVITY_TOUCH_MS,
} from "../lib/session-security.js";
import {
  canAccessModule,
  canManageLabStock,
  canManagePharmacyCatalog,
  canManageResources,
  type AppUserRole,
} from "../lib/roles.js";

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

async function clearAuthCookie(req: Request, res: Response) {
  res.clearCookie(COOKIE_NAME, sessionCookieOptions(req));
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "Non autorisé", code: "NO_SESSION" });
  }
  try {
    const sessionUser = await verifySessionToken(token);
    const dbUser = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: {
        id: true,
        username: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        active: true,
        lockedAt: true,
        sessionTokenId: true,
        lastActivityAt: true,
      },
    });

    if (!dbUser?.active) {
      await clearAuthCookie(req, res);
      return res.status(401).json({ error: "Compte désactivé", code: "ACCOUNT_DISABLED" });
    }

    if (isAccountLocked(dbUser.lockedAt)) {
      await clearAuthCookie(req, res);
      if (dbUser.sessionTokenId) {
        await prisma.user.update({
          where: { id: dbUser.id },
          data: { sessionTokenId: null, lastActivityAt: null },
        });
      }
      return res.status(401).json({
        error: "Compte verrouillé. Contactez l'administrateur.",
        code: "ACCOUNT_LOCKED",
      });
    }

    if (!dbUser.sessionTokenId || dbUser.sessionTokenId !== sessionUser.sid) {
      await clearAuthCookie(req, res);
      return res.status(401).json({
        error: "Session invalide ou remplacée. Reconnectez-vous.",
        code: "SESSION_REPLACED",
      });
    }

    if (isSessionIdle(dbUser.lastActivityAt)) {
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { sessionTokenId: null, lastActivityAt: null },
      });
      await clearAuthCookie(req, res);
      return res.status(401).json({
        error: "Session expirée pour inactivité (30 minutes).",
        code: "SESSION_IDLE",
      });
    }

    const now = Date.now();
    const lastTouch = dbUser.lastActivityAt?.getTime() ?? 0;
    const shouldTouch = now - lastTouch >= SESSION_ACTIVITY_TOUCH_MS;
    if (shouldTouch) {
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { lastActivityAt: new Date(now) },
      });
    }

    // Toujours reprendre le rôle / identité depuis la DB (évite JWT périmé → Accès refusé).
    req.user = {
      id: dbUser.id,
      username: dbUser.username,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      role: dbUser.role,
    };

    // Renouvelle le cookie à chaque requête authentifiée (fenêtre glissante 30 min).
    try {
      const freshToken = await createSessionToken(req.user, sessionUser.sid);
      res.cookie(COOKIE_NAME, freshToken, sessionCookieOptions(req));
    } catch {
      // Ne bloque pas la requête si le renouvellement échoue.
    }

    next();
  } catch {
    await clearAuthCookie(req, res);
    return res.status(401).json({ error: "Session invalide", code: "SESSION_INVALID" });
  }
}

export function requireModule(module: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Non autorisé" });
    }
    if (!canAccessModule(req.user.role as AppUserRole, module)) {
      return res.status(403).json({
        error: "Accès refusé",
        detail: `Le rôle « ${req.user.role} » n'a pas accès au module « ${module} ».`,
      });
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

export function requirePharmacyCatalogAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  if (!canManagePharmacyCatalog(req.user.role as AppUserRole)) {
    return res.status(403).json({ error: "Accès refusé — catalogue pharmacie réservé à la direction / gestion" });
  }
  next();
}

export function requireLabStockAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  if (!canManageLabStock(req.user.role as AppUserRole)) {
    return res.status(403).json({ error: "Accès refusé — stock laboratoire réservé à la direction / gestion" });
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
      return res.status(403).json({
        error: "Accès refusé",
        detail: `Le rôle « ${role} » n'a accès à aucun de : ${modules.join(", ")}.`,
      });
    }
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({
      error: "Accès réservé à l'administrateur.",
      code: "ADMIN_ONLY",
    });
  }
  next();
}
