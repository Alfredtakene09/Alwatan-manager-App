import { ExamCatalogKind } from "@prisma/client";
import { prisma } from "./db.js";
import {
  examCatalogServiceScopeKey,
  isKinesitherapieServiceName,
} from "./clinic-service-exam.js";

/** Acte d’orientation / séance proposé dans le modal de prescription. */
export const KINESITHERAPIE_SESSION_LABEL = "Séance de kinésithérapie";
export const KINESITHERAPIE_SESSION_CODE = "seance-kine";
const DEFAULT_KINE_SESSION_PRICE_FCFA = 5_000;

/**
 * Garantit au moins un acte catalogue pour chaque service kiné actif,
 * afin que l’onglet apparaisse dans le modal consultation (médecins + réception).
 */
export async function ensureKinesitherapieCatalogItems() {
  const services = await prisma.clinicService.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      examCatalogItems: {
        where: { active: true },
        select: { id: true },
        take: 1,
      },
    },
  });

  for (const service of services) {
    if (!isKinesitherapieServiceName(service.name)) continue;
    if (service.examCatalogItems.length > 0) continue;

    const serviceScopeKey = examCatalogServiceScopeKey(service.id);
    const existing = await prisma.examCatalogItem.findFirst({
      where: {
        kind: ExamCatalogKind.EXAMEN,
        code: KINESITHERAPIE_SESSION_CODE,
        serviceScopeKey,
      },
      select: { id: true, active: true },
    });

    if (existing) {
      if (!existing.active) {
        await prisma.examCatalogItem.update({
          where: { id: existing.id },
          data: { active: true, clinicServiceId: service.id },
        });
      }
      continue;
    }

    await prisma.examCatalogItem.create({
      data: {
        kind: ExamCatalogKind.EXAMEN,
        code: KINESITHERAPIE_SESSION_CODE,
        label: KINESITHERAPIE_SESSION_LABEL,
        category: "Kinésithérapie",
        priceFcfa: DEFAULT_KINE_SESSION_PRICE_FCFA,
        clinicServiceId: service.id,
        serviceScopeKey,
        active: true,
        sortOrder: 1,
      },
    });
  }
}
