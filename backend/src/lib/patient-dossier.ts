import fs from "node:fs/promises";
import path from "node:path";
import { PatientDocumentKind, type Prisma } from "@prisma/client";
import { prisma } from "./db.js";

export const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_DIR ?? "uploads");

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

export const DOCUMENT_KIND_LABELS: Record<PatientDocumentKind, string> = {
  EXAMEN: "Examen",
  ODONTO: "Odonto",
  RADIO: "Radio",
  ECHO: "Écho",
  CONSULTATION: "Consultation",
  AUTRE: "Autre",
};

export const CONSULTATION_COMMENT_DOC_TITLE_PREFIX = "Commentaire consultation";

export async function ensureUploadsRoot() {
  await fs.mkdir(UPLOADS_ROOT, { recursive: true });
}

export async function ensurePatientDossier(patientId: string) {
  const existing = await prisma.patientDossier.findUnique({ where: { patientId } });
  if (existing) return existing;

  return prisma.patientDossier.create({ data: { patientId } });
}

export async function ensurePatientDossierTx(
  tx: Prisma.TransactionClient,
  patientId: string,
) {
  const existing = await tx.patientDossier.findUnique({ where: { patientId } });
  if (existing) return existing;
  return tx.patientDossier.create({ data: { patientId } });
}

export async function upsertConsultationCommentDocument(
  tx: Prisma.TransactionClient,
  params: {
    patientId: string;
    visitId: string;
    comment: string;
    uploadedById: string;
    documentDate?: Date;
  },
) {
  const trimmed = params.comment.trim();
  if (!trimmed) return null;

  await ensurePatientDossierTx(tx, params.patientId);

  const existing = await tx.patientDocument.findFirst({
    where: {
      visitId: params.visitId,
      kind: PatientDocumentKind.CONSULTATION,
    },
  });

  const dir = patientUploadDir(params.patientId);
  await fs.mkdir(dir, { recursive: true });
  const displayFileName = `commentaire-consultation-${params.visitId.slice(0, 8)}.txt`;
  const storageFileName = `${Date.now()}-${displayFileName}`;
  const absolutePath = path.join(dir, storageFileName);
  await fs.writeFile(absolutePath, trimmed, "utf8");
  const relativePath = path.relative(UPLOADS_ROOT, absolutePath);
  const documentDate = params.documentDate ?? new Date();
  const title = `${CONSULTATION_COMMENT_DOC_TITLE_PREFIX} — ${documentDate.toLocaleDateString("fr-FR")}`;
  const fileSize = Buffer.byteLength(trimmed, "utf8");

  if (existing) {
    await deleteDocumentFile(existing.storagePath);
    return tx.patientDocument.update({
      where: { id: existing.id },
      data: {
        title,
        documentDate,
        fileName: displayFileName,
        mimeType: "text/plain",
        fileSize,
        storagePath: relativePath,
      },
    });
  }

  const dossier = await tx.patientDossier.findUniqueOrThrow({
    where: { patientId: params.patientId },
  });

  return tx.patientDocument.create({
    data: {
      dossierId: dossier.id,
      patientId: params.patientId,
      visitId: params.visitId,
      kind: PatientDocumentKind.CONSULTATION,
      title,
      documentDate,
      fileName: displayFileName,
      mimeType: "text/plain",
      fileSize,
      storagePath: relativePath,
      uploadedById: params.uploadedById,
    },
  });
}

export async function backfillMissingDossiers() {
  const patientsWithoutDossier = await prisma.patient.findMany({
    where: { dossier: null },
    select: { id: true },
  });

  if (!patientsWithoutDossier.length) return 0;

  await prisma.patientDossier.createMany({
    data: patientsWithoutDossier.map((p) => ({ patientId: p.id })),
    skipDuplicates: true,
  });

  return patientsWithoutDossier.length;
}

export function patientUploadDir(patientId: string) {
  return path.join(UPLOADS_ROOT, "patients", patientId);
}

export function sanitizeFileName(name: string) {
  return name.replace(/[^\w.\-() ]+/g, "_").slice(0, 180);
}

export async function deleteDocumentFile(storagePath: string) {
  const absolute = path.join(UPLOADS_ROOT, storagePath);
  try {
    await fs.unlink(absolute);
  } catch {
    // Fichier déjà absent
  }
}
