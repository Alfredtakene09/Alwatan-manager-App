import { Router } from "express";
import { ExamCatalogKind, InterventionCategory, RoomType } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { EXAM_CATALOG_KIND_SLUGS } from "../lib/exam-catalog-seed.js";
import { HOSPITALISATION_PRESCRIPTION_LABEL } from "../lib/hospitalization-referral.js";
import {
  examCatalogVisibleForServiceWhere,
  interventionVisibleForServicesWhere,
  isExamVisibleOnKindTab,
  isPrescriptionDestinationServiceName,
  isSpecialtyClinicServiceName,
  resolveDoctorClinicServices,
} from "../lib/clinic-service-exam.js";
import { ensureKinesitherapieCatalogItems } from "../lib/kinesitherapie-catalog.js";
import { requireAuth, requireAnyModule } from "../middleware/auth.js";

const router = Router();
router.use(
  requireAuth,
  requireAnyModule("consultation", "reception", "comptabilite", "laboratoire"),
);

const KIND_TO_SLUG = Object.fromEntries(
  Object.entries(EXAM_CATALOG_KIND_SLUGS).map(([slug, kind]) => [kind, slug]),
) as Record<ExamCatalogKind, string>;

const INTERVENTION_CATEGORY_LABELS: Record<InterventionCategory, string> = {
  MAJEURE_A: "Chirurgie majeure",
  MOYENNE_B: "Chirurgie moyenne",
  PETITE_C: "Petite chirurgie",
};

type CatalogItemDto = {
  id: string;
  code: string;
  label: string;
  category: string | null;
  priceFcfa: number;
  clinicServiceId: string | null;
  clinicServiceName: string | null;
  labPanelId?: string | null;
  labPanelSlug?: string | null;
  anesthesiologistPercent?: number;
  anesthesiologistId?: string | null;
  anesthesiologistName?: string | null;
  hasAssistant?: boolean;
};

function defaultHospitalisationCatalogItem(
  rooms: Array<{ dailyRateFcfa: number; type: RoomType }>,
): CatalogItemDto {
  const simpleRoom =
    rooms.find((room) => room.type === RoomType.SIMPLE) ?? rooms[0];
  return {
    id: "hospitalisation-orientation",
    code: "HOSP",
    label: HOSPITALISATION_PRESCRIPTION_LABEL,
    category: "Orientation — salle choisie à la réception",
    priceFcfa: simpleRoom?.dailyRateFcfa ?? 25_000,
    clinicServiceId: null,
    clinicServiceName: "Hospitalisation",
  };
}

/** Destinations inter-services (ex. Kinésithérapeute) pour le modal médecin. */
async function appendPrescriptionDestinationServices(
  specialtyServiceIds: Set<string>,
  specialtyServicesById: Map<string, string>,
) {
  const destinations = await prisma.clinicService.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  for (const svc of destinations) {
    if (!isPrescriptionDestinationServiceName(svc.name)) continue;
    specialtyServiceIds.add(svc.id);
    specialtyServicesById.set(svc.id, svc.name);
  }
}

router.get("/", async (req, res) => {
  await ensureKinesitherapieCatalogItems();

  // Un médecin ne peut consulter que son propre périmètre (pas un autre doctorId).
  const isMedecin = req.user?.role === "MEDECIN";
  const queryDoctorId =
    typeof req.query.doctorId === "string" ? req.query.doctorId.trim() : "";
  const doctorId = isMedecin ? (req.user?.id ?? "") : queryDoctorId;
  const serviceId =
    typeof req.query.serviceId === "string" ? req.query.serviceId.trim() : "";

  let filterServiceIds: string[] = [];
  const specialtyServiceIds = new Set<string>();
  const specialtyServicesById = new Map<string, string>();
  let specialtyServiceName: string | null = null;

  if (doctorId) {
    const doctorServices = await resolveDoctorClinicServices(doctorId);
    if (doctorServices) {
      filterServiceIds = doctorServices.ids;
      for (const svc of doctorServices.all) {
        if (!isSpecialtyClinicServiceName(svc.name)) continue;
        specialtyServiceIds.add(svc.id);
        specialtyServicesById.set(svc.id, svc.name);
        if (svc.id === doctorServices.default.id || !specialtyServiceName) {
          specialtyServiceName = svc.name;
        }
      }
    }
    // Autres médecins : orientation vers kiné / autres spécialités (pas seulement à la réception).
    await appendPrescriptionDestinationServices(specialtyServiceIds, specialtyServicesById);
    if (specialtyServiceIds.size > 1) {
      specialtyServiceName = null;
    }
  } else if (serviceId) {
    const service = await prisma.clinicService.findFirst({
      where: { id: serviceId, active: true },
      select: { id: true, name: true },
    });
    if (service) {
      filterServiceIds = [service.id];
      if (isSpecialtyClinicServiceName(service.name)) {
        specialtyServiceIds.add(service.id);
        specialtyServicesById.set(service.id, service.name);
        specialtyServiceName = service.name;
      }
    }
  } else {
    // Réception / patient externe : tous les services de prescription actifs
    // (nouveaux services inclus même sans nomenclature encore).
    await appendPrescriptionDestinationServices(specialtyServiceIds, specialtyServicesById);
    if (specialtyServiceIds.size === 1) {
      specialtyServiceName = [...specialtyServicesById.values()][0] ?? null;
    } else {
      specialtyServiceName = null;
    }
  }

  // Médecin : ses services + destinations d’orientation (kiné, etc.) + Labo/Hospit.
  const catalogServiceIds = [...new Set([...filterServiceIds, ...specialtyServiceIds])];
  const examWhere =
    catalogServiceIds.length > 0
      ? { active: true, ...examCatalogVisibleForServiceWhere(catalogServiceIds) }
      : doctorId || isMedecin
        ? { active: true, ...examCatalogVisibleForServiceWhere(null) }
        : { active: true };

  const interventionWhere =
    filterServiceIds.length > 0
      ? { active: true, ...interventionVisibleForServicesWhere(filterServiceIds, { doctorUserId: doctorId }) }
      : doctorId || isMedecin
        ? { active: true, id: { in: [] as string[] } }
        : { active: true };

  const [items, interventions, rooms, labPanels] = await Promise.all([
    prisma.examCatalogItem.findMany({
      where: examWhere,
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
      select: {
        id: true,
        kind: true,
        code: true,
        label: true,
        category: true,
        priceFcfa: true,
        clinicServiceId: true,
        clinicService: { select: { id: true, name: true } },
        labPanelId: true,
        labPanel: { select: { id: true, slug: true } },
      },
    }),
    prisma.interventionType.findMany({
      where: interventionWhere,
      orderBy: [{ category: "asc" }, { label: "asc" }],
      select: {
        id: true,
        code: true,
        label: true,
        category: true,
        totalCostFcfa: true,
        clinicServiceId: true,
        clinicService: { select: { id: true, name: true } },
        anesthesiologistPercent: true,
        anesthesiologistId: true,
        anesthesiologistName: true,
        surgeonPercent: true,
        anesthesiologist: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.room.findMany({
      where: { active: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        type: true,
        dailyRateFcfa: true,
      },
    }),
    // Formulaires labo prêts à la saisie : actifs, mode saisie, avec au moins un champ.
    prisma.labPanel.findMany({
      where: {
        active: true,
        isEntry: true,
        fields: { some: {} },
      },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: {
        id: true,
        slug: true,
        label: true,
        sortOrder: true,
        examCatalogItems: {
          where: { kind: ExamCatalogKind.EXAMEN, active: true },
          select: {
            id: true,
            code: true,
            label: true,
            category: true,
            priceFcfa: true,
          },
          take: 1,
        },
      },
    }),
  ]);

  const grouped: Record<
    "specialty" | "examen" | "radio" | "echo" | "odonto" | "operation" | "hospitalisation",
    CatalogItemDto[]
  > = {
    specialty: [],
    examen: [],
    radio: [],
    echo: [],
    odonto: [],
    operation: interventions.map((item) => {
      const assistantLabel = item.anesthesiologist
        ? `Dr ${item.anesthesiologist.firstName} ${item.anesthesiologist.lastName}`.trim()
        : item.anesthesiologistName?.trim() || null;
      return {
        id: item.id,
        code: item.code,
        label: item.label,
        category: INTERVENTION_CATEGORY_LABELS[item.category],
        priceFcfa: item.totalCostFcfa,
        clinicServiceId: item.clinicServiceId,
        clinicServiceName: item.clinicService?.name ?? null,
        surgeonPercent: item.surgeonPercent,
        anesthesiologistPercent: item.anesthesiologistPercent,
        anesthesiologistId: item.anesthesiologistId,
        anesthesiologistName: assistantLabel,
        hasAssistant: item.anesthesiologistPercent > 0,
      };
    }),
    hospitalisation: [defaultHospitalisationCatalogItem(rooms)],
  };

  for (const item of items) {
    const dto: CatalogItemDto = {
      id: item.id,
      code: item.code,
      label: item.label,
      category: item.category,
      priceFcfa: item.priceFcfa,
      clinicServiceId: item.clinicServiceId,
      clinicServiceName: item.clinicService?.name ?? null,
      labPanelId: item.labPanelId,
      labPanelSlug: item.labPanel?.slug ?? null,
    };

    // Examens Laboratoire → toujours onglet Labo (service labo, formulaire lié, catégorie, ou sans service)
    if (item.kind === ExamCatalogKind.EXAMEN) {
      const category = (item.category ?? "").trim().toLowerCase();
      const isLabExam =
        Boolean(item.labPanelId) ||
        !item.clinicServiceId ||
        category === "laboratoire" ||
        category === "labo" ||
        isExamVisibleOnKindTab(item, ExamCatalogKind.EXAMEN);
      if (isLabExam) {
        grouped.examen.push(dto);
        continue;
      }
    }

    // Examens des services spécialisés → onglet(s) dédié(s)
    if (
      item.clinicServiceId &&
      specialtyServiceIds.has(item.clinicServiceId)
    ) {
      grouped.specialty.push({
        ...dto,
        category: dto.category || item.clinicService?.name || specialtyServiceName,
      });
      continue;
    }

    const slug = KIND_TO_SLUG[item.kind];
    if (slug === "radio" || slug === "echo" || slug === "odonto") {
      // Les examens de spécialité sont déjà détournés ci-dessus.
      // Ne pas masquer Radio/Écho/Odonto si le service lié n’est pas « canonique ».
      grouped[slug].push(dto);
    } else if (slug === "examen") {
      // Autres EXAMEN non-labo non-spécialité (visibles quand même dans Labo)
      grouped.examen.push(dto);
    }
  }

  // Source de vérité Laboratoire : uniquement les examens avec formulaire de saisie actif.
  // Les examens sans formulaire ne sont pas proposés au médecin.
  const fromPanels: CatalogItemDto[] = labPanels.map((panel) => {
    const linked = panel.examCatalogItems[0] ?? null;
    return {
      id: linked?.id ?? `lab-panel:${panel.id}`,
      code: linked?.code || panel.slug,
      label: (linked?.label || panel.label).trim(),
      category: linked?.category?.trim() || "Laboratoire",
      priceFcfa: linked?.priceFcfa ?? 0,
      clinicServiceId: null,
      clinicServiceName: "Laboratoire",
      labPanelId: panel.id,
      labPanelSlug: panel.slug,
    };
  });

  grouped.examen = fromPanels;

  grouped.specialty.sort((a, b) => a.label.localeCompare(b.label, "fr"));

  const specialtyServices = [...specialtyServicesById.entries()]
    .map(([id, name]) => {
      const hasExams = grouped.specialty.some((exam) => exam.clinicServiceId === id);
      const hasOperations = grouped.operation.some((op) => op.clinicServiceId === id);
      return { id, name, hasExams, hasOperations };
    })
    // Toujours renvoyer le service (même vide) pour qu'il apparaisse dès sa création
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

  return res.json({
    ...grouped,
    specialtyServiceName:
      specialtyServices.length === 1 ? specialtyServices[0].name : specialtyServiceName,
    specialtyServices,
  });
});

export default router;
