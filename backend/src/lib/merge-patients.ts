import type { Patient, Prisma } from "@prisma/client";
import { prisma } from "./db.js";

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizePatientPhone(value?: string | null) {
  if (!value) return "";
  return value.replace(/\D/g, "");
}

/** Numéro utilisable pour rattacher un doublon (min. 6 chiffres). */
export function isUsablePatientPhone(value?: string | null) {
  return normalizePatientPhone(value).length >= 6;
}

/**
 * Plus ancien dossier avec même nom + prénom + numéro de téléphone.
 * Utilisé pour fusionner un réenregistrement (option A) au stade médecin / facture.
 */
export async function findCanonicalPatientByPhone(
  patient: Pick<Patient, "id" | "firstName" | "lastName" | "phone" | "createdAt">,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const phone = normalizePatientPhone(patient.phone);
  if (!phone) return null;

  const first = normalizeName(patient.firstName);
  const last = normalizeName(patient.lastName);

  const candidates = await db.patient.findMany({
    where: {
      id: { not: patient.id },
      firstName: { equals: patient.firstName.trim(), mode: "insensitive" },
      lastName: { equals: patient.lastName.trim(), mode: "insensitive" },
      phone: { not: null },
      createdAt: { lt: patient.createdAt },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  return (
    candidates.find((candidate) => {
      if (normalizeName(candidate.firstName) !== first) return false;
      if (normalizeName(candidate.lastName) !== last) return false;
      return normalizePatientPhone(candidate.phone) === phone;
    }) ?? null
  );
}

export type MergePatientResult = {
  merged: boolean;
  patientId: string;
  sourcePatientId?: string;
  targetPatientId?: string;
};

/**
 * Réaffecte visites, factures et documents du patient source vers le dossier canonique
 * (même identité + même numéro), puis supprime le doublon vide.
 */
export async function mergePatientIntoCanonical(
  sourcePatientId: string,
): Promise<MergePatientResult> {
  const source = await prisma.patient.findUnique({ where: { id: sourcePatientId } });
  if (!source) {
    return { merged: false, patientId: sourcePatientId };
  }

  const target = await findCanonicalPatientByPhone(source);
  if (!target) {
    return { merged: false, patientId: source.id };
  }

  await prisma.$transaction(async (tx) => {
    await tx.visit.updateMany({
      where: { patientId: source.id },
      data: { patientId: target.id },
    });
    await tx.invoice.updateMany({
      where: { patientId: source.id },
      data: { patientId: target.id },
    });
    await tx.prescription.updateMany({
      where: { patientId: source.id },
      data: { patientId: target.id },
    });
    await tx.examReclamation.updateMany({
      where: { patientId: source.id },
      data: { patientId: target.id },
    });
    await tx.vitalSign.updateMany({
      where: { patientId: source.id },
      data: { patientId: target.id },
    });
    await tx.patientDocument.updateMany({
      where: { patientId: source.id },
      data: { patientId: target.id },
    });

    const sourceDossier = await tx.patientDossier.findUnique({
      where: { patientId: source.id },
    });
    if (sourceDossier) {
      let targetDossier = await tx.patientDossier.findUnique({
        where: { patientId: target.id },
      });
      if (!targetDossier) {
        targetDossier = await tx.patientDossier.create({
          data: { patientId: target.id },
        });
      }
      await tx.patientDocument.updateMany({
        where: { dossierId: sourceDossier.id },
        data: { dossierId: targetDossier.id, patientId: target.id },
      });
      await tx.patientDossier.delete({ where: { id: sourceDossier.id } });
    }

    await tx.patient.update({
      where: { id: target.id },
      data: {
        ...(target.phone ? {} : source.phone ? { phone: source.phone } : {}),
        ...(target.gender ? {} : source.gender ? { gender: source.gender } : {}),
        ...(target.address ? {} : source.address ? { address: source.address } : {}),
        ...(target.age != null ? {} : source.age != null ? { age: source.age, ageUnit: source.ageUnit } : {}),
        ...(target.dateOfBirth ? {} : source.dateOfBirth ? { dateOfBirth: source.dateOfBirth } : {}),
        ...(target.service ? {} : source.service ? { service: source.service } : {}),
        ...(target.treatingDoctorId
          ? {}
          : source.treatingDoctorId
            ? { treatingDoctorId: source.treatingDoctorId }
            : {}),
        ...(target.recommendedByName
          ? {}
          : source.recommendedByName
            ? { recommendedByName: source.recommendedByName }
            : {}),
      },
    });

    await tx.patient.delete({ where: { id: source.id } });
  });

  return {
    merged: true,
    patientId: target.id,
    sourcePatientId: source.id,
    targetPatientId: target.id,
  };
}

/** Fusionne si un dossier plus ancien partage le même nom + numéro. */
export async function ensurePatientMergedByPhone(
  patientId: string,
): Promise<MergePatientResult> {
  return mergePatientIntoCanonical(patientId);
}

/** Idem à partir d’une visite (médecin / facture). */
export async function ensureVisitPatientMergedByPhone(
  visitId: string,
): Promise<MergePatientResult | null> {
  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    select: { patientId: true },
  });
  if (!visit) return null;
  return mergePatientIntoCanonical(visit.patientId);
}

/** Idem à partir d’une facture. */
export async function ensureInvoicePatientMergedByPhone(
  invoiceId: string,
): Promise<MergePatientResult | null> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { patientId: true },
  });
  if (!invoice?.patientId) return null;
  return mergePatientIntoCanonical(invoice.patientId);
}
