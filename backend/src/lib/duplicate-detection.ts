import type { ExamCatalogKind, InterventionCategory, Patient, AgeUnit } from "@prisma/client";
import { prisma } from "./db.js";

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePhone(value?: string | null) {
  if (!value) return "";
  return value.replace(/\D/g, "");
}

function sameCalendarDay(a: Date, b: Date) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function serializePatientForDuplicate(patient: Patient) {
  return {
    id: patient.id,
    code: patient.code,
    firstName: patient.firstName,
    lastName: patient.lastName,
    phone: patient.phone,
    dateOfBirth: patient.dateOfBirth?.toISOString() ?? null,
    category: patient.category,
  };
}

/** Patient : nom + prénom + (téléphone, date de naissance ou âge). */
export async function findDuplicatePatient(input: {
  firstName: string;
  lastName: string;
  phone?: string | null;
  age?: number | null;
  ageUnit?: AgeUnit | null;
  dateOfBirth?: Date | null;
  excludeId?: string;
}) {
  const first = normalizeName(input.firstName);
  const last = normalizeName(input.lastName);
  const phone = normalizePhone(input.phone);
  const dob = input.dateOfBirth ?? null;
  const age = input.age ?? null;
  const ageUnit = input.ageUnit ?? "YEARS";

  const candidates = await prisma.patient.findMany({
    where: {
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      firstName: { equals: input.firstName.trim(), mode: "insensitive" },
      lastName: { equals: input.lastName.trim(), mode: "insensitive" },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const nameMatch = candidates.find((patient) => {
    if (normalizeName(patient.firstName) !== first || normalizeName(patient.lastName) !== last) {
      return false;
    }

    const patientPhone = normalizePhone(patient.phone);

    if (phone && patientPhone && patientPhone === phone) {
      return true;
    }

    if (dob && patient.dateOfBirth) {
      return sameCalendarDay(dob, patient.dateOfBirth);
    }

    if (
      age != null &&
      patient.age != null &&
      age === patient.age &&
      ageUnit === (patient.ageUnit ?? "YEARS")
    ) {
      return true;
    }

    if (phone && !patientPhone && !patient.dateOfBirth) {
      return true;
    }

    if (!dob && !phone && !patient.dateOfBirth && !patientPhone) {
      return true;
    }

    return false;
  });

  if (nameMatch) return nameMatch;

  if (!phone) return null;

  const phoneCandidates = await prisma.patient.findMany({
    where: {
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      phone: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    phoneCandidates.find((patient) => {
      if (normalizePhone(patient.phone) !== phone) return false;
      return normalizeName(patient.firstName) === first && normalizeName(patient.lastName) === last;
    }) ?? null
  );
}

/** Nomenclature opération : code identique ou libellé+catégorie identiques. */
export async function findDuplicateIntervention(input: {
  code: string;
  label: string;
  category: InterventionCategory;
  excludeId?: string;
}) {
  const code = input.code.trim();
  const label = normalizeName(input.label);

  const byCode = await prisma.interventionType.findFirst({
    where: {
      code,
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    },
  });
  if (byCode) return byCode;

  const byLabel = await prisma.interventionType.findMany({
    where: {
      category: input.category,
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    },
  });

  return byLabel.find((item) => normalizeName(item.label) === label) ?? null;
}

/** Catalogue examen / radio / écho / odonto : kind + code ou libellé identique. */
export async function findDuplicateExamCatalogItem(input: {
  kind: ExamCatalogKind;
  code: string;
  label: string;
  excludeId?: string;
}) {
  const code = input.code.trim();
  const label = normalizeName(input.label);

  const byCode = await prisma.examCatalogItem.findFirst({
    where: {
      kind: input.kind,
      code,
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    },
  });
  if (byCode) return byCode;

  const byLabel = await prisma.examCatalogItem.findMany({
    where: {
      kind: input.kind,
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    },
  });

  return byLabel.find((item) => normalizeName(item.label) === label) ?? null;
}

/** Opération patient : une intervention par visite (dossier chirurgical). */
export async function findDuplicateSurgeryCaseForVisit(visitId: string) {
  return prisma.surgeryCase.findUnique({ where: { visitId } });
}

/** Produit pharmacie : SKU identique ou nom identique. */
export async function findDuplicateProduct(input: {
  sku: string;
  name: string;
  excludeId?: string;
}) {
  const sku = input.sku.trim();
  const name = normalizeName(input.name);

  const bySku = await prisma.product.findFirst({
    where: {
      sku,
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    },
  });
  if (bySku) return bySku;

  const products = await prisma.product.findMany({
    where: input.excludeId ? { id: { not: input.excludeId } } : undefined,
  });
  return products.find((item) => normalizeName(item.name) === name) ?? null;
}

/** Salle : nom identique (insensible à la casse). */
export async function findDuplicateRoomByName(name: string, excludeId?: string) {
  const normalized = normalizeName(name);
  const rooms = await prisma.room.findMany({
    where: excludeId ? { id: { not: excludeId } } : undefined,
  });
  return rooms.find((room) => normalizeName(room.name) === normalized) ?? null;
}
