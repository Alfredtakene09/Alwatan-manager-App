import type { ExamCatalogKind, InterventionCategory, Patient, AgeUnit } from "@prisma/client";
import { prisma } from "./db.js";

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePhone(value?: string | null) {
  if (!value) return "";
  return value.replace(/\D/g, "");
}

function normalizeGender(value?: string | null) {
  if (!value) return "";
  return value.trim().toUpperCase();
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
    gender: patient.gender,
    dateOfBirth: patient.dateOfBirth?.toISOString() ?? null,
    category: patient.category,
  };
}

/** Critères stricts de fusion de dossier : nom + prénom + téléphone + genre. */
export async function findPatientForDossierFusion(input: {
  firstName: string;
  lastName: string;
  phone?: string | null;
  gender?: string | null;
  excludeId?: string;
}) {
  const first = normalizeName(input.firstName);
  const last = normalizeName(input.lastName);
  const phone = normalizePhone(input.phone);
  const gender = normalizeGender(input.gender);

  if (!phone || !gender) return null;

  const candidates = await prisma.patient.findMany({
    where: {
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      firstName: { equals: input.firstName.trim(), mode: "insensitive" },
      lastName: { equals: input.lastName.trim(), mode: "insensitive" },
      phone: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  return (
    candidates.find((patient) => {
      if (normalizeName(patient.firstName) !== first || normalizeName(patient.lastName) !== last) {
        return false;
      }
      if (normalizePhone(patient.phone) !== phone) return false;
      const patientGender = normalizeGender(patient.gender);
      if (patientGender && patientGender !== gender) return false;
      return true;
    }) ?? null
  );
}

/**
 * Fusion / doublon patient : nom + prénom + numéro de téléphone + genre.
 * Critères secondaires (date de naissance / âge) si téléphone ou genre manquant.
 */
export async function findDuplicatePatient(input: {
  firstName: string;
  lastName: string;
  phone?: string | null;
  gender?: string | null;
  age?: number | null;
  ageUnit?: AgeUnit | null;
  dateOfBirth?: Date | null;
  excludeId?: string;
}) {
  const fusion = await findPatientForDossierFusion({
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone,
    gender: input.gender,
    excludeId: input.excludeId,
  });
  if (fusion) return fusion;

  const first = normalizeName(input.firstName);
  const last = normalizeName(input.lastName);
  const phone = normalizePhone(input.phone);
  const gender = normalizeGender(input.gender);
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
    take: 40,
  });

  const nameMatches = candidates.filter(
    (patient) =>
      normalizeName(patient.firstName) === first && normalizeName(patient.lastName) === last,
  );

  // Téléphone + nom/prénom (genre non renseigné à la saisie)
  if (phone && !gender) {
    const phoneMatch = nameMatches.find((patient) => {
      const patientPhone = normalizePhone(patient.phone);
      return !!patientPhone && patientPhone === phone;
    });
    if (phoneMatch) return phoneMatch;
  }

  const secondaryMatch = nameMatches.find((patient) => {
    const patientPhone = normalizePhone(patient.phone);
    const patientGender = normalizeGender(patient.gender);

    if (phone && patientPhone && patientPhone === phone) {
      if (gender && patientGender && patientGender !== gender) return false;
      return true;
    }

    if (dob && patient.dateOfBirth) {
      if (gender && patientGender && patientGender !== gender) return false;
      return sameCalendarDay(dob, patient.dateOfBirth);
    }

    if (
      age != null &&
      patient.age != null &&
      age === patient.age &&
      ageUnit === (patient.ageUnit ?? "YEARS")
    ) {
      if (gender && patientGender && patientGender !== gender) return false;
      return true;
    }

    if (phone && !patientPhone && !patient.dateOfBirth) {
      if (gender && patientGender && patientGender !== gender) return false;
      return true;
    }

    if (!dob && !phone && !patient.dateOfBirth && !patientPhone) {
      if (gender && patientGender && patientGender !== gender) return false;
      return true;
    }

    return false;
  });

  if (secondaryMatch) return secondaryMatch;

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
      if (normalizeName(patient.firstName) !== first || normalizeName(patient.lastName) !== last) {
        return false;
      }
      const patientGender = normalizeGender(patient.gender);
      if (gender && patientGender && patientGender !== gender) return false;
      return true;
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
  clinicServiceId?: string | null;
  excludeId?: string;
}) {
  const code = input.code.trim();
  const label = normalizeName(input.label);
  const serviceScopeKey =
    input.clinicServiceId !== undefined
      ? input.clinicServiceId?.trim() || "_"
      : undefined;

  const byCode = await prisma.examCatalogItem.findFirst({
    where: {
      kind: input.kind,
      code,
      ...(serviceScopeKey !== undefined ? { serviceScopeKey } : {}),
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    },
  });
  if (byCode) return byCode;

  const byLabel = await prisma.examCatalogItem.findMany({
    where: {
      kind: input.kind,
      ...(serviceScopeKey !== undefined ? { serviceScopeKey } : {}),
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
