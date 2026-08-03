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

router.get("/", async (req, res) => {
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
    const specialtyServices = await prisma.clinicService.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    for (const svc of specialtyServices) {
      if (!isPrescriptionDestinationServiceName(svc.name)) continue;
      specialtyServiceIds.add(svc.id);
      specialtyServicesById.set(svc.id, svc.name);
      if (!specialtyServiceName) specialtyServiceName = svc.name;
    }
    if (specialtyServiceIds.size > 1) {
      specialtyServiceName = null;
    }
  }

  // Médecin sans service : aucun examen/opération métier hors Labo/Hospit/null.
  const examWhere =
    filterServiceIds.length > 0
      ? { active: true, ...examCatalogVisibleForServiceWhere(filterServiceIds) }
      : doctorId || isMedecin
        ? { active: true, ...examCatalogVisibleForServiceWhere(null) }
        : { active: true };

  const interventionWhere =
    filterServiceIds.length > 0
      ? { active: true, ...interventionVisibleForServicesWhere(filterServiceIds) }
      : doctorId || isMedecin
        ? { active: true, id: { in: [] as string[] } }
        : { active: true };

  const [items, interventions, rooms] = await Promise.all([
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
    operation: interventions.map((item) => ({
      id: item.id,
      code: item.code,
      label: item.label,
      category: INTERVENTION_CATEGORY_LABELS[item.category],
      priceFcfa: item.totalCostFcfa,
      clinicServiceId: item.clinicServiceId,
      clinicServiceName: item.clinicService?.name ?? null,
    })),
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
    };

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
    if (slug === "examen" || slug === "radio" || slug === "echo" || slug === "odonto") {
      // Ne pas mélanger les nomenclatures de spécialité dans Labo/Radio/Écho/Odonto
      if (!isExamVisibleOnKindTab(item, item.kind)) continue;
      grouped[slug].push(dto);
    }
  }

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
