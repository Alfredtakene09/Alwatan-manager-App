import type { PrismaClient } from "@prisma/client";
import { ORTHO_TRAUMA_SERVICE_NAME } from "./ortho-trauma-service.js";

export const DEFAULT_CLINIC_SERVICES = [
  "Consultation",
  "Urgences",
  "Maternité",
  "Pédiatrie",
  "Laboratoire",
  "Imagerie",
  "Hospitalisation",
  "Bloc opératoire",
  "Pharmacie",
  "Accueil / Réception",
  ORTHO_TRAUMA_SERVICE_NAME,
  "Kinésithérapie",
] as const;

type ClinicServiceDb = Pick<PrismaClient, "clinicService">;

export async function ensureDefaultClinicServices(db: ClinicServiceDb) {
  const existing = await db.clinicService.count();
  if (existing > 0) return;

  await db.clinicService.createMany({
    data: DEFAULT_CLINIC_SERVICES.map((name, sortOrder) => ({
      name,
      active: true,
      sortOrder,
    })),
    skipDuplicates: true,
  });
}
