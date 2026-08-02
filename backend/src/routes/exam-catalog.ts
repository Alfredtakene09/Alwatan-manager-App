import { Router } from "express";
import { ExamCatalogKind, InterventionCategory, RoomType } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { EXAM_CATALOG_KIND_SLUGS } from "../lib/exam-catalog-seed.js";
import { HOSPITALISATION_PRESCRIPTION_LABEL } from "../lib/hospitalization-referral.js";
import {
  examCatalogVisibleForServiceWhere,
  isSpecialtyClinicServiceName,
  resolveDoctorClinicService,
  resolveDoctorClinicServiceId,
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
  const doctorId =
    typeof req.query.doctorId === "string" ? req.query.doctorId.trim() : "";
  const serviceId =
    typeof req.query.serviceId === "string" ? req.query.serviceId.trim() : "";

  let filterServiceId: string | null = serviceId || null;
  let specialtyServiceName: string | null = null;

  if (doctorId) {
    const doctorService = await resolveDoctorClinicService(doctorId);
    if (!filterServiceId && doctorService) {
      filterServiceId = doctorService.id;
    }
    if (doctorService && isSpecialtyClinicServiceName(doctorService.name)) {
      specialtyServiceName = doctorService.name;
    }
  } else if (filterServiceId) {
    const service = await prisma.clinicService.findFirst({
      where: { id: filterServiceId, active: true },
      select: { id: true, name: true },
    });
    if (service && isSpecialtyClinicServiceName(service.name)) {
      specialtyServiceName = service.name;
    }
  }

  if (!filterServiceId && doctorId) {
    filterServiceId = await resolveDoctorClinicServiceId(doctorId);
  }

  const examWhere = filterServiceId
    ? { active: true, ...examCatalogVisibleForServiceWhere(filterServiceId) }
    : doctorId
      ? { active: true, ...examCatalogVisibleForServiceWhere(null) }
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
      where: { active: true },
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

    // Examens du service spécialisé du médecin → onglet dédié (ex. Ophtalmologie)
    if (
      specialtyServiceName &&
      filterServiceId &&
      item.clinicServiceId === filterServiceId
    ) {
      grouped.specialty.push({
        ...dto,
        category: dto.category || specialtyServiceName,
      });
      continue;
    }

    const slug = KIND_TO_SLUG[item.kind];
    if (slug === "examen" || slug === "radio" || slug === "echo" || slug === "odonto") {
      grouped[slug].push(dto);
    }
  }

  grouped.specialty.sort((a, b) => a.label.localeCompare(b.label, "fr"));

  return res.json({
    ...grouped,
    specialtyServiceName,
  });
});

export default router;
