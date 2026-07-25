import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import type { Request, Response } from "express";
import { prisma } from "./db.js";
import { UPLOADS_ROOT } from "./patient-dossier.js";

const PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export const employeePhotoDir = path.join(UPLOADS_ROOT, "employees");
fs.mkdirSync(employeePhotoDir, { recursive: true });

export const employeePhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, employeePhotoDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!PHOTO_MIME.has(file.mimetype)) {
      cb(new Error("Format photo non supporté (JPEG, PNG, WebP ou GIF)."));
      return;
    }
    cb(null, true);
  },
});

export async function saveEmployeePhoto(employeeId: string, file: Express.Multer.File) {
  const relativePath = path.relative(UPLOADS_ROOT, file.path).replace(/\\/g, "/");
  const existing = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { photoPath: true },
  });
  if (!existing) {
    fs.unlink(file.path, () => undefined);
    return { error: "Employé introuvable" as const };
  }

  if (existing.photoPath) {
    const previous = path.join(UPLOADS_ROOT, existing.photoPath);
    fs.unlink(previous, () => undefined);
  }

  const updated = await prisma.employee.update({
    where: { id: employeeId },
    data: { photoPath: relativePath },
    select: { id: true, photoPath: true },
  });

  return { employee: updated };
}

export async function sendEmployeePhoto(employeeId: string, res: Response) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { photoPath: true, firstName: true, lastName: true },
  });
  if (!employee?.photoPath) {
    return res.status(404).json({ error: "Aucune photo pour cet employé." });
  }
  const absolute = path.join(UPLOADS_ROOT, employee.photoPath);
  if (!fs.existsSync(absolute)) {
    return res.status(404).json({ error: "Fichier photo introuvable." });
  }
  return res.sendFile(absolute);
}

export function multerPhotoError(error: unknown, _req: Request, res: Response) {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "La photo ne doit pas dépasser 5 Mo." });
    }
    return res.status(400).json({ error: "Upload photo impossible." });
  }
  if (error instanceof Error) {
    return res.status(400).json({ error: error.message });
  }
  return res.status(400).json({ error: "Upload photo impossible." });
}
