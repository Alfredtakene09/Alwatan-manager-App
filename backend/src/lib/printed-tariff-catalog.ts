import { ExamCatalogKind, InterventionCategory } from "@prisma/client";
import { prisma } from "./db.js";
import { examCatalogServiceScopeKey, isKinesitherapieServiceName } from "./clinic-service-exam.js";
import { findDuplicateExamCatalogItem, findDuplicateIntervention } from "./duplicate-detection.js";
import { ensureKinesitherapieCatalogItems } from "./kinesitherapie-catalog.js";

/** Suffixe catalogue du 2ᵉ tarif (patients en provenance d’émiraties). */
export const PRINTED_TARIFF_EMIRATES_SUFFIX = " (émiraties)";

/** Services créés s’ils n’existent pas encore (additif). */
export const PRINTED_TARIFF_SERVICES = ["Orthopédie", "Kinésithérapie"] as const;

export const PRINTED_TARIFF_OPERATIONS = [
  {
    code: "OP-GYN-CESAR",
    label: "Césariennes",
    category: InterventionCategory.MAJEURE_A,
    totalCostFcfa: 450_000,
    emiratesCostFcfa: 350_000,
    surgeonPercent: 60,
    serviceNames: ["Maternité", "Gynécologie"],
  },
  {
    code: "OP-GYN-ACCOUCH-NAT",
    label: "Accouchement naturel",
    category: InterventionCategory.MOYENNE_B,
    totalCostFcfa: 50_000,
    emiratesCostFcfa: 25_000,
    surgeonPercent: 65,
    serviceNames: ["Maternité", "Gynécologie"],
  },
  {
    code: "OP-GYN-FIBROME",
    label: "Ablations des fibromes",
    category: InterventionCategory.MAJEURE_A,
    totalCostFcfa: 500_000,
    emiratesCostFcfa: 80_000,
    surgeonPercent: 60,
    serviceNames: ["Maternité", "Gynécologie"],
  },
  {
    code: "OP-ORTHO-HANCHE",
    label: "Fracture de la hanche",
    category: InterventionCategory.MAJEURE_A,
    totalCostFcfa: 750_000,
    emiratesCostFcfa: 600_000,
    surgeonPercent: 60,
    serviceNames: ["Orthopédie"],
  },
  {
    code: "OP-ORTHO-BASSIN",
    label: "Fracture du bassin",
    category: InterventionCategory.MAJEURE_A,
    totalCostFcfa: 900_000,
    emiratesCostFcfa: 750_000,
    surgeonPercent: 60,
    serviceNames: ["Orthopédie"],
  },
  {
    code: "OP-ORTHO-BRAS",
    label: "Fracture du bras",
    category: InterventionCategory.MAJEURE_A,
    totalCostFcfa: 500_000,
    emiratesCostFcfa: 400_000,
    surgeonPercent: 60,
    serviceNames: ["Orthopédie"],
  },
  {
    code: "OP-ORTHO-JAMBE",
    label: "Fracture de la jambe",
    category: InterventionCategory.MAJEURE_A,
    totalCostFcfa: 600_000,
    emiratesCostFcfa: 500_000,
    surgeonPercent: 60,
    serviceNames: ["Orthopédie"],
  },
] as const;

export const PRINTED_TARIFF_RADIO = [
  {
    code: "radio-couleur",
    label: "Radio en couleur",
    priceFcfa: 75_000,
    emiratesPriceFcfa: 60_000,
    sortOrder: 10,
  },
  {
    code: "radio-simple",
    label: "Radio simple",
    priceFcfa: 10_000,
    emiratesPriceFcfa: 5_000,
    sortOrder: 11,
  },
] as const;

export const PRINTED_TARIFF_KINE = [
  {
    code: "consultation-kine",
    label: "Consultation de kinésithérapie",
    priceFcfa: 10_000,
    emiratesPriceFcfa: 5_000,
    sortOrder: 2,
  },
] as const;

type AmountVariant = {
  code: string;
  label: string;
  amountFcfa: number;
};

function amountVariants(
  code: string,
  label: string,
  standardFcfa: number,
  emiratesFcfa: number,
): AmountVariant[] {
  return [
    { code, label, amountFcfa: standardFcfa },
    {
      code: `${code}-EM`,
      label: `${label}${PRINTED_TARIFF_EMIRATES_SUFFIX}`,
      amountFcfa: emiratesFcfa,
    },
  ];
}

async function findClinicServiceId(names: readonly string[]): Promise<string | null> {
  for (const name of names) {
    const active = await prisma.clinicService.findFirst({
      where: { active: true, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (active) return active.id;
  }
  for (const name of names) {
    const any = await prisma.clinicService.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (any) return any.id;
  }
  return null;
}

async function findBlocOperatoireServiceId(): Promise<string | null> {
  const exact = await findClinicServiceId(["Bloc opératoire"]);
  if (exact) return exact;
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

async function findOrthopedieServiceId(): Promise<string | null> {
  const named = await findClinicServiceId(["Orthopédie", "Orthopedie"]);
  if (named) return named;
  const fuzzy = await prisma.clinicService.findFirst({
    where: { name: { contains: "orthop", mode: "insensitive" } },
    select: { id: true },
  });
  return fuzzy?.id ?? null;
}

async function findKinesitherapieServiceId(): Promise<string | null> {
  const named = await findClinicServiceId(["Kinésithérapie"]);
  if (named) return named;
  const services = await prisma.clinicService.findMany({
    select: { id: true, name: true },
  });
  return services.find((s) => isKinesitherapieServiceName(s.name))?.id ?? null;
}

/** Crée le service s’il n’existe pas (n’écrase ni ne réactive un service existant). */
export async function ensureClinicServiceByName(name: string): Promise<string> {
  const existing = await prisma.clinicService.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;

  const maxSort = await prisma.clinicService.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.clinicService.create({
    data: {
      name,
      active: true,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
    select: { id: true },
  });
  return created.id;
}

export async function ensurePrintedTariffServices() {
  const ids: string[] = [];
  const orthoId = (await findOrthopedieServiceId()) ?? (await ensureClinicServiceByName("Orthopédie"));
  const kineId = (await findKinesitherapieServiceId()) ?? (await ensureClinicServiceByName("Kinésithérapie"));
  ids.push(orthoId, kineId);
  return ids;
}

async function backfillInterventionService(id: string, clinicServiceId: string | null) {
  if (!clinicServiceId) return;
  const row = await prisma.interventionType.findUnique({
    where: { id },
    select: { clinicServiceId: true },
  });
  if (row && !row.clinicServiceId) {
    await prisma.interventionType.update({
      where: { id },
      data: { clinicServiceId },
    });
  }
}

async function ensureInterventionVariant(input: {
  code: string;
  label: string;
  category: InterventionCategory;
  totalCostFcfa: number;
  surgeonPercent: number;
  clinicServiceId: string | null;
}) {
  const byCode = await prisma.interventionType.findUnique({
    where: { code: input.code },
    select: { id: true, clinicServiceId: true },
  });
  if (byCode) {
    await backfillInterventionService(byCode.id, input.clinicServiceId);
    return false;
  }

  const duplicate = await findDuplicateIntervention({
    code: input.code,
    label: input.label,
    category: input.category,
  });
  if (duplicate) {
    await backfillInterventionService(duplicate.id, input.clinicServiceId);
    return false;
  }

  await prisma.interventionType.create({
    data: {
      code: input.code,
      label: input.label,
      category: input.category,
      totalCostFcfa: input.totalCostFcfa,
      surgeonPercent: input.surgeonPercent,
      clinicServiceId: input.clinicServiceId,
      active: true,
    },
  });
  return true;
}

async function ensureExamVariant(input: {
  kind: ExamCatalogKind;
  code: string;
  label: string;
  category: string;
  priceFcfa: number;
  sortOrder: number;
  clinicServiceId: string | null;
}) {
  const serviceScopeKey = examCatalogServiceScopeKey(input.clinicServiceId);
  const existing = await prisma.examCatalogItem.findFirst({
    where: { kind: input.kind, code: input.code, serviceScopeKey },
    select: { id: true },
  });
  if (existing) return false;

  const duplicate = await findDuplicateExamCatalogItem({
    kind: input.kind,
    code: input.code,
    label: input.label,
    clinicServiceId: input.clinicServiceId,
  });
  if (duplicate) return false;

  await prisma.examCatalogItem.create({
    data: {
      kind: input.kind,
      code: input.code,
      label: input.label,
      category: input.category,
      priceFcfa: input.priceFcfa,
      clinicServiceId: input.clinicServiceId,
      serviceScopeKey,
      active: true,
      sortOrder: input.sortOrder,
    },
  });
  return true;
}

/**
 * Injecte la liste tarifaire papier (gynéco, ortho, radio, kiné).
 * Additif : n’écrase jamais un prix / libellé déjà en base.
 * Le tarif émiraties est un 2ᵉ acte sélectionnable (`… (émiraties)`).
 */
export async function ensurePrintedTariffCatalogItems() {
  await ensurePrintedTariffServices();
  // Après création du service kiné : garantir la séance par défaut avant la consultation tarifée.
  await ensureKinesitherapieCatalogItems();

  let created = 0;
  const blocServiceId = await findBlocOperatoireServiceId();

  for (const item of PRINTED_TARIFF_OPERATIONS) {
    const preferred = item.code.startsWith("OP-ORTHO-")
      ? await findOrthopedieServiceId()
      : await findClinicServiceId(item.serviceNames);
    const clinicServiceId = preferred ?? blocServiceId;
    for (const variant of amountVariants(
      item.code,
      item.label,
      item.totalCostFcfa,
      item.emiratesCostFcfa,
    )) {
      const didCreate = await ensureInterventionVariant({
        code: variant.code,
        label: variant.label,
        category: item.category,
        totalCostFcfa: variant.amountFcfa,
        surgeonPercent: item.surgeonPercent,
        clinicServiceId,
      });
      if (didCreate) created += 1;
    }
  }

  for (const item of PRINTED_TARIFF_RADIO) {
    for (const [index, variant] of amountVariants(
      item.code,
      item.label,
      item.priceFcfa,
      item.emiratesPriceFcfa,
    ).entries()) {
      const didCreate = await ensureExamVariant({
        kind: ExamCatalogKind.RADIO,
        code: variant.code,
        label: variant.label,
        category: "Imagerie",
        priceFcfa: variant.amountFcfa,
        sortOrder: item.sortOrder + index,
        // Nomenclature Radio globale (comme Radiographie / Scanner) — visible à tous.
        clinicServiceId: null,
      });
      if (didCreate) created += 1;
    }
  }

  const kineServiceId = await findKinesitherapieServiceId();
  if (kineServiceId) {
    for (const item of PRINTED_TARIFF_KINE) {
      for (const [index, variant] of amountVariants(
        item.code,
        item.label,
        item.priceFcfa,
        item.emiratesPriceFcfa,
      ).entries()) {
        const didCreate = await ensureExamVariant({
          kind: ExamCatalogKind.EXAMEN,
          code: variant.code,
          label: variant.label,
          category: "Kinésithérapie",
          priceFcfa: variant.amountFcfa,
          sortOrder: item.sortOrder + index,
          clinicServiceId: kineServiceId,
        });
        if (didCreate) created += 1;
      }
    }
  }

  return { created };
}
