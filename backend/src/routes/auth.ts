import type { Request, Response } from "express";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import {
  COOKIE_NAME,
  createSessionToken,
  newSessionId,
  sessionCookieOptions,
  type SessionUser,
} from "../lib/auth.js";
import { getDefaultRoute } from "../lib/roles.js";
import { requireAuth } from "../middleware/auth.js";
import { doctorCanAccessOperationsMenu } from "../lib/clinic-service-exam.js";
import { getEffectiveHiddenUiActions } from "../lib/role-ui-settings.js";
import {
  isAccountLocked,
  isSessionIdle,
  LAST_ATTEMPT_WARNING_AT,
  MAX_FAILED_LOGIN_ATTEMPTS,
  SESSION_ACTIVITY_TOUCH_MS,
} from "../lib/session-security.js";

const router = Router();

const loginSchema = z.object({
  username: z.string().trim().min(2, "Nom d'utilisateur requis."),
  password: z.string().min(1, "Mot de passe requis."),
});

const profileSchema = z.object({
  firstName: z.string().trim().min(2, "Le prénom doit contenir au moins 2 caractères."),
  lastName: z.string().trim().min(2, "Le nom doit contenir au moins 2 caractères."),
  username: z
    .string()
    .trim()
    .min(2, "Le nom d'utilisateur doit contenir au moins 2 caractères.")
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/, "Caractères autorisés : lettres, chiffres, . _ -"),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(4, "Mot de passe actuel requis."),
  newPassword: z.string().min(6, "Le nouveau mot de passe doit contenir au moins 6 caractères."),
});

export type AuthUserPayload = SessionUser & {
  /** MEDECIN : afficher « Mes opérations » (bloc / chirurgie / chirurgien autorisé). */
  showDoctorOperations?: boolean;
  /** Boutons UI masqués pour ce rôle (vide pour Admin / Direction). */
  hiddenUiActions?: string[];
};

function toSessionUser(user: {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: SessionUser["role"];
}): SessionUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
  };
}

async function toAuthUserPayload(
  user: SessionUser,
  userHiddenRaw?: unknown,
): Promise<AuthUserPayload> {
  const hiddenUiActions = await getEffectiveHiddenUiActions(user.role, userHiddenRaw);
  if (user.role !== "MEDECIN") {
    return { ...user, hiddenUiActions };
  }
  return {
    ...user,
    hiddenUiActions,
    showDoctorOperations: await doctorCanAccessOperationsMenu(user.id),
  };
}

async function attachSession(res: Response, user: SessionUser, sessionId: string, req?: Request) {
  const token = await createSessionToken(user, sessionId);
  res.cookie(COOKIE_NAME, token, sessionCookieOptions(req));
}

async function clearSessionCookie(req: Request, res: Response) {
  res.clearCookie(COOKIE_NAME, sessionCookieOptions(req));
}

router.post("/login", async (req, res) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    const login = username.trim();

    // Identifiant insensible à la casse — username ou e-mail.
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: login, mode: "insensitive" } },
          { email: { equals: login, mode: "insensitive" } },
        ],
      },
    });

    if (!user) {
      return res.status(401).json({
        error: "Identifiants invalides",
        code: "INVALID_CREDENTIALS",
      });
    }

    if (!user.active) {
      return res.status(401).json({
        error: "Compte désactivé. Contactez l'administrateur.",
        code: "ACCOUNT_DISABLED",
      });
    }

    if (isAccountLocked(user.lockedAt)) {
      return res.status(403).json({
        error:
          "Compte verrouillé suite à trop de tentatives incorrectes. Seul un administrateur peut le déverrouiller.",
        code: "ACCOUNT_LOCKED",
      });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      const nextAttempts = user.failedLoginAttempts + 1;

      if (nextAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: nextAttempts,
            lockedAt: new Date(),
            sessionTokenId: null,
            lastActivityAt: null,
          },
        });
        return res.status(403).json({
          error:
            "Compte verrouillé après trop de mots de passe incorrects. Contactez un administrateur pour le déverrouiller.",
          code: "ACCOUNT_LOCKED",
        });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: nextAttempts },
      });

      if (nextAttempts === LAST_ATTEMPT_WARNING_AT) {
        return res.status(401).json({
          error:
            "Mot de passe incorrect. Attention : il s'agit de votre dernière tentative avant verrouillage du compte.",
          code: "LAST_ATTEMPT",
          attemptsRemaining: 1,
        });
      }

      return res.status(401).json({
        error: "Identifiants invalides",
        code: "INVALID_CREDENTIALS",
        attemptsRemaining: MAX_FAILED_LOGIN_ATTEMPTS - nextAttempts,
      });
    }

    const sessionId = newSessionId();
    const now = new Date();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedAt: null,
        sessionTokenId: sessionId,
        lastActivityAt: now,
      },
    });

    const sessionUser = toSessionUser(user);
    await attachSession(res, sessionUser, sessionId, req);

    return res.json({
      success: true,
      user: await toAuthUserPayload(sessionUser, user.hiddenUiActions),
      redirectTo: getDefaultRoute(user.role),
    });
  } catch {
    return res.status(400).json({ error: "Données invalides" });
  }
});

router.post("/logout", async (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (token) {
    try {
      const { verifySessionToken } = await import("../lib/auth.js");
      const session = await verifySessionToken(token);
      await prisma.user.updateMany({
        where: { id: session.id, sessionTokenId: session.sid },
        data: { sessionTokenId: null, lastActivityAt: null },
      });
    } catch {
      // Cookie déjà invalide
    }
  }
  await clearSessionCookie(req, res);
  return res.json({ success: true });
});

router.get("/me", async (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Non autorisé", code: "NO_SESSION" });
  try {
    const { verifySessionToken } = await import("../lib/auth.js");
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
        hiddenUiActions: true,
      },
    });
    if (!dbUser?.active) {
      await clearSessionCookie(req, res);
      return res.status(401).json({ error: "Compte désactivé", code: "ACCOUNT_DISABLED" });
    }
    if (isAccountLocked(dbUser.lockedAt)) {
      await clearSessionCookie(req, res);
      return res.status(401).json({
        error: "Compte verrouillé. Contactez l'administrateur.",
        code: "ACCOUNT_LOCKED",
      });
    }
    if (!dbUser.sessionTokenId || dbUser.sessionTokenId !== sessionUser.sid) {
      await clearSessionCookie(req, res);
      return res.status(401).json({
        error: "Session fermée — connexion ouverte sur un autre poste.",
        code: "SESSION_REPLACED",
      });
    }
    if (isSessionIdle(dbUser.lastActivityAt)) {
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { sessionTokenId: null, lastActivityAt: null },
      });
      await clearSessionCookie(req, res);
      return res.status(401).json({
        error: "Session expiree pour inactivite (12 heures).",
        code: "SESSION_IDLE",
      });
    }

    const now = Date.now();
    const lastTouch = dbUser.lastActivityAt?.getTime() ?? 0;
    if (now - lastTouch >= SESSION_ACTIVITY_TOUCH_MS) {
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { lastActivityAt: new Date(now) },
      });
    }

    const session = toSessionUser(dbUser);
    const freshToken = await createSessionToken(session, sessionUser.sid);
    res.cookie(COOKIE_NAME, freshToken, sessionCookieOptions(req));
    return res.json(await toAuthUserPayload(session, dbUser.hiddenUiActions));
  } catch {
    await clearSessionCookie(req, res);
    return res.status(401).json({ error: "Session invalide", code: "SESSION_INVALID" });
  }
});

router.patch("/profile", requireAuth, async (req, res) => {
  try {
    const body = profileSchema.parse(req.body);
    const currentUser = req.user!;

    const existing = await prisma.user.findUnique({ where: { id: currentUser.id } });
    if (!existing || !existing.active) {
      return res.status(404).json({ error: "Compte introuvable." });
    }

    const usernameChanged = body.username.toLowerCase() !== existing.username.toLowerCase();
    if (usernameChanged) {
      const usernameTaken = await prisma.user.findFirst({
        where: {
          username: { equals: body.username, mode: "insensitive" },
          NOT: { id: currentUser.id },
        },
        select: { id: true },
      });
      if (usernameTaken) {
        return res.status(409).json({ error: "Ce nom d'utilisateur est déjà utilisé." });
      }
    }

    // E-mail technique auto (@alwatan.local) : rester aligné sur le nom d'utilisateur.
    let nextEmail = existing.email;
    if (usernameChanged && existing.email.toLowerCase().endsWith("@alwatan.local")) {
      const candidate = `${body.username}@alwatan.local`;
      const emailTaken = await prisma.user.findFirst({
        where: {
          email: { equals: candidate, mode: "insensitive" },
          NOT: { id: currentUser.id },
        },
        select: { id: true },
      });
      if (!emailTaken) {
        nextEmail = candidate;
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: currentUser.id },
        data: {
          firstName: body.firstName,
          lastName: body.lastName,
          username: body.username,
          email: nextEmail,
        },
      });

      await tx.employee.update({
        where: { id: user.employeeId },
        data: {
          firstName: body.firstName,
          lastName: body.lastName,
        },
      });

      return user;
    });

    const sessionUser = toSessionUser(updated);
    const sid = updated.sessionTokenId ?? newSessionId();
    if (!updated.sessionTokenId) {
      await prisma.user.update({
        where: { id: updated.id },
        data: { sessionTokenId: sid, lastActivityAt: new Date() },
      });
    }
    await attachSession(res, sessionUser, sid, req);
    return res.json({
      user: await toAuthUserPayload(sessionUser, updated.hiddenUiActions),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? "Données invalides." });
    }
    return res.status(400).json({ error: "Mise à jour impossible." });
  }
});

router.patch("/password", requireAuth, async (req, res) => {
  try {
    const body = passwordSchema.parse(req.body);
    const currentUser = req.user!;

    const existing = await prisma.user.findUnique({ where: { id: currentUser.id } });
    if (!existing || !existing.active) {
      return res.status(404).json({ error: "Compte introuvable." });
    }
    if (isAccountLocked(existing.lockedAt)) {
      return res.status(403).json({
        error: "Compte verrouillé. Seul un administrateur peut réinitialiser le mot de passe.",
        code: "ACCOUNT_LOCKED",
      });
    }

    const valid = await bcrypt.compare(body.currentPassword, existing.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Mot de passe actuel incorrect." });
    }

    const passwordHash = await bcrypt.hash(body.newPassword, 10);
    await prisma.user.update({
      where: { id: currentUser.id },
      data: {
        passwordHash,
        failedLoginAttempts: 0,
        lockedAt: null,
      },
    });

    return res.json({ success: true, message: "Mot de passe mis à jour." });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? "Données invalides." });
    }
    return res.status(400).json({ error: "Modification impossible." });
  }
});

export default router;
