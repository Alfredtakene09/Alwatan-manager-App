import { InterventionCategory } from "@prisma/client";
import { prisma } from "./db.js";
import { findDuplicateIntervention } from "./duplicate-detection.js";

/** Service clinique cible pour la prescription au bloc. */
export const PETITE_CHIRURGIE_BLOC_SERVICE_NAME = "Bloc opératoire";

/** Aligné sur le gabarit seed CHIR-C (Petite chirurgie Type C). */
export const PETITE_CHIRURGIE_SURGEON_PERCENT = 70;

/**
 * Actes additifs de petite chirurgie (codes stables).
 * Ne pas réutiliser ces codes pour d’autres libellés — l’upsert prod se fait uniquement par `code`.
 */
export const PETITE_CHIRURGIE_CATALOG_ITEMS = [
  { code: "PC-SOUTIR", label: "Soutir", totalCostFcfa: 2000 },
  { code: "PC-PANSEMENT", label: "Pansement", totalCostFcfa: 1000 },
  { code: "PC-GRAND-SOUTIR", label: "Grand soutir", totalCostFcfa: 5000 },
] as const;

export type PetiteChirurgieCatalogItem = (typeof PETITE_CHIRURGIE_CATALOG_ITEMS)[number];

async function findBlocOperatoireServiceId(): Promise<string | null> {
  const exact = await prisma.clinicService.findFirst({
    where: {
      active: true,
      name: { equals: PETITE_CHIRURGIE_BLOC_SERVICE_NAME, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (exact) return exact.id;

  const fuzzy = await prisma.clinicService.findFirst({
    where: {
      active: true,
      AND: [
        { name: { contains: "bloc", mode: "insensitive" } },
        { name: { contains: "opérat", mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  return fuzzy?.id ?? null;
}

/**
 * Crée les 3 actes s’ils n’existent pas encore (par code, sinon par libellé + PETITE_C).
 * N’écrase jamais un prix / libellé déjà en base — additif uniquement.
 */
export async function ensurePetiteChirurgieCatalogItems() {
  const clinicServiceId = await findBlocOperatoireServiceId();
  let created = 0;

  for (const item of PETITE_CHIRURGIE_CATALOG_ITEMS) {
    const byCode = await prisma.interventionType.findUnique({
      where: { code: item.code },
      select: { id: true, clinicServiceId: true },
    });

    if (byCode) {
      if (!byCode.clinicServiceId && clinicServiceId) {
        await prisma.interventionType.update({
          where: { id: byCode.id },
          data: { clinicServiceId },
        });
      }
      continue;
    }

    const duplicate = await findDuplicateIntervention({
      code: item.code,
      label: item.label,
      category: InterventionCategory.PETITE_C,
    });
    if (duplicate) {
      if (!duplicate.clinicServiceId && clinicServiceId) {
        await prisma.interventionType.update({
          where: { id: duplicate.id },
          data: { clinicServiceId },
        });
      }
      continue;
    }

    await prisma.interventionType.create({
      data: {
        code: item.code,
        label: item.label,
        category: InterventionCategory.PETITE_C,
        totalCostFcfa: item.totalCostFcfa,
        surgeonPercent: PETITE_CHIRURGIE_SURGEON_PERCENT,
        clinicServiceId,
        active: true,
      },
    });
    created += 1;
  }

  return { created };
}
