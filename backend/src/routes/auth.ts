import type { Response } from "express";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { COOKIE_NAME, createSessionToken, type SessionUser } from "../lib/auth.js";
import { getDefaultRoute } from "../lib/roles.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

const loginSchema = z.object({
  username: z.string().trim().min(2, "Nom d'utilisateur requis."),
  password: z.string().min(4),
});

const profileSchema = z.object({
  firstName: z.string().trim().min(2, "Le prénom doit contenir au moins 2 caractères."),
  lastName: z.string().trim().min(2, "Le nom doit contenir au moins 2 caractères."),
  email: z.string().trim().email("Adresse e-mail invalide."),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(4, "Mot de passe actuel requis."),
  newPassword: z.string().min(6, "Le nouveau mot de passe doit contenir au moins 6 caractères."),
});

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 12 * 60 * 60 * 1000,
};

function toSessionUser(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: SessionUser["role"];
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
  };
}

async function attachSession(res: Response, user: SessionUser) {
  const token = await createSessionToken(user);
  res.cookie(COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
}

router.post("/login", async (req, res) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.active) {
      return res.status(401).json({ error: "Identifiants invalides" });
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Identifiants invalides" });
    }

    const sessionUser = toSessionUser(user);
    await attachSession(res, sessionUser);

    return res.json({ success: true, user: sessionUser, redirectTo: getDefaultRoute(user.role) });
  } catch {
    return res.status(400).json({ error: "Données invalides" });
  }
});

router.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  return res.json({ success: true });
});

router.get("/me", async (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Non autorisé" });
  try {
    const { verifySessionToken } = await import("../lib/auth.js");
    const user = await verifySessionToken(token);
    return res.json(user);
  } catch {
    return res.status(401).json({ error: "Session invalide" });
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

    if (body.email !== existing.email) {
      const emailTaken = await prisma.user.findUnique({ where: { email: body.email } });
      if (emailTaken) {
        return res.status(409).json({ error: "Cet e-mail est déjà utilisé par un autre compte." });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: currentUser.id },
        data: {
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email,
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
    await attachSession(res, sessionUser);
    return res.json({ user: sessionUser });
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

    const valid = await bcrypt.compare(body.currentPassword, existing.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Mot de passe actuel incorrect." });
    }

    const passwordHash = await bcrypt.hash(body.newPassword, 10);
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { passwordHash },
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
