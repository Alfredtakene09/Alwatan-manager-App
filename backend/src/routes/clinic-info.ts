import { Router } from "express";
import { z } from "zod";
import {
  getClinicInfo,
  serializeClinicInfo,
  updateClinicInfo,
} from "../lib/clinic.js";
import {
  CLINIC_LOGO_PUBLIC_PATH,
  clinicLogoUpload,
  multerClinicLogoError,
  saveClinicLogoFile,
  sendClinicLogo,
} from "../lib/clinic-logo.js";
import { requireAuth } from "../middleware/auth.js";
import type { AppUserRole } from "../lib/roles.js";

const router = Router();

const CLINIC_INFO_EDITORS: AppUserRole[] = ["ADMIN", "GESTIONNAIRE"];

const updateSchema = z.object({
  nameFr: z.string().trim().min(2).max(200).optional(),
  nameAr: z.string().trim().min(1).max(200).optional(),
  shortName: z.string().trim().min(1).max(80).optional(),
  logo: z.string().trim().min(1).max(500).optional(),
  city: z.string().trim().min(1).max(200).optional(),
  address: z.string().trim().min(1).max(300).optional(),
  fullAddress: z.string().trim().max(400).optional(),
  phones: z.string().trim().min(1).max(200).optional(),
  phoneLabel: z.string().trim().max(220).optional(),
  email: z.string().trim().email().max(200).optional(),
  nif: z.string().trim().max(120).optional(),
  rc: z.string().trim().max(120).optional(),
  printFooter: z.string().trim().max(400).optional(),
});

function requireClinicInfoEditor(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  if (!req.user) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  if (!CLINIC_INFO_EDITORS.includes(req.user.role as AppUserRole)) {
    return res.status(403).json({
      error: "Accès réservé à la Direction et au Gestionnaire.",
      code: "CLINIC_INFO_FORBIDDEN",
    });
  }
  next();
}

function withLogoCacheBust(logo: string, updatedAt?: Date | string | number) {
  const base = logo.startsWith(CLINIC_LOGO_PUBLIC_PATH)
    ? CLINIC_LOGO_PUBLIC_PATH
    : logo;
  const stamp =
    updatedAt instanceof Date
      ? updatedAt.getTime()
      : updatedAt
        ? new Date(updatedAt).getTime()
        : Date.now();
  if (!Number.isFinite(stamp)) return base;
  return `${base}?v=${stamp}`;
}

router.get("/logo", async (_req, res) => {
  const info = await getClinicInfo();
  return sendClinicLogo(res, info.logo);
});

router.get("/", requireAuth, async (_req, res) => {
  const info = await getClinicInfo({ force: true });
  const payload = serializeClinicInfo(info);
  return res.json({
    ...payload,
    logo: withLogoCacheBust(payload.logo),
  });
});

router.put("/", requireAuth, requireClinicInfoEditor, async (req, res) => {
  try {
    const body = updateSchema.parse(req.body ?? {});
    if (Object.keys(body).length === 0) {
      return res.status(400).json({ error: "Aucun champ à mettre à jour." });
    }
    const info = await updateClinicInfo(body);
    const payload = serializeClinicInfo(info);
    return res.json({
      ...payload,
      logo: withLogoCacheBust(payload.logo),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides.", details: error.flatten() });
    }
    return res.status(400).json({ error: "Impossible d’enregistrer les infos clinique." });
  }
});

router.post(
  "/logo",
  requireAuth,
  requireClinicInfoEditor,
  (req, res, next) => {
    clinicLogoUpload.single("logo")(req, res, (error) => {
      if (error) return multerClinicLogoError(error, req, res);
      next();
    });
  },
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Aucun fichier logo reçu." });
    }
    try {
      const saved = saveClinicLogoFile(req.file);
      const info = await updateClinicInfo({ logo: CLINIC_LOGO_PUBLIC_PATH });
      const payload = serializeClinicInfo(info);
      return res.json({
        ...payload,
        logo: withLogoCacheBust(CLINIC_LOGO_PUBLIC_PATH),
        absolutePath: saved.absolutePath,
        message: "Logo enregistré sur le disque.",
      });
    } catch {
      return res.status(400).json({ error: "Impossible d’enregistrer le logo." });
    }
  },
);

export default router;
