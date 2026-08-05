import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import type { Request, Response } from "express";
import { fileURLToPath } from "node:url";
import { UPLOADS_ROOT } from "./patient-dossier.js";

const PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export const clinicLogoDir = path.join(UPLOADS_ROOT, "clinic");
fs.mkdirSync(clinicLogoDir, { recursive: true });

const DEFAULT_ASSET_LOGO = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../assets/logo-alwatan.jpeg",
);

/** URL publique stable (cache-bust via query côté client). */
export const CLINIC_LOGO_PUBLIC_PATH = "/api/clinic-info/logo";

export const clinicLogoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, clinicLogoDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      const safeExt = ALLOWED_EXT.has(ext) ? ext : ".jpg";
      cb(null, `logo-upload-${Date.now()}${safeExt}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!PHOTO_MIME.has(file.mimetype)) {
      cb(new Error("Format logo non supporté (JPEG, PNG, WebP ou GIF)."));
      return;
    }
    cb(null, true);
  },
});

function listClinicLogoFiles(): string[] {
  if (!fs.existsSync(clinicLogoDir)) return [];
  return fs
    .readdirSync(clinicLogoDir)
    .filter((name) => name.startsWith("logo.") || name.startsWith("logo-upload-"))
    .map((name) => path.join(clinicLogoDir, name))
    .filter((abs) => fs.statSync(abs).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

/** Chemin absolu du logo clinique pour PDFKit / envoi HTTP. */
export function resolveClinicLogoAbsolutePath(logoUrl?: string | null): string | null {
  const candidates = listClinicLogoFiles();
  if (candidates[0]) return candidates[0];

  const raw = String(logoUrl ?? "").trim();
  if (raw && !raw.startsWith("/api/") && !raw.startsWith("http")) {
    // Ancien chemin public frontend (ex. /logo-alwatan.jpeg)
    const fromUploads = path.join(UPLOADS_ROOT, raw.replace(/^\/+/, ""));
    if (fs.existsSync(fromUploads)) return fromUploads;
  }

  if (fs.existsSync(DEFAULT_ASSET_LOGO)) return DEFAULT_ASSET_LOGO;
  return null;
}

export function saveClinicLogoFile(file: Express.Multer.File): {
  absolutePath: string;
  publicPath: string;
} {
  const ext = path.extname(file.filename).toLowerCase() || ".jpg";
  const safeExt = ALLOWED_EXT.has(ext) ? ext : ".jpg";
  const finalName = `logo${safeExt}`;
  const finalPath = path.join(clinicLogoDir, finalName);

  // Supprime les anciennes variantes (autres extensions + temporaires)
  for (const existing of listClinicLogoFiles()) {
    if (existing !== file.path) {
      fs.unlink(existing, () => undefined);
    }
  }

  if (file.path !== finalPath) {
    fs.renameSync(file.path, finalPath);
  }

  return {
    absolutePath: finalPath,
    publicPath: CLINIC_LOGO_PUBLIC_PATH,
  };
}

export function sendClinicLogo(res: Response, logoUrl?: string | null) {
  const absolute = resolveClinicLogoAbsolutePath(logoUrl);
  if (!absolute || !fs.existsSync(absolute)) {
    return res.status(404).json({ error: "Logo introuvable." });
  }
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.sendFile(absolute);
}

export function multerClinicLogoError(error: unknown, _req: Request, res: Response) {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Le logo ne doit pas dépasser 5 Mo." });
    }
    return res.status(400).json({ error: "Upload du logo impossible." });
  }
  if (error instanceof Error) {
    return res.status(400).json({ error: error.message });
  }
  return res.status(400).json({ error: "Upload du logo impossible." });
}
