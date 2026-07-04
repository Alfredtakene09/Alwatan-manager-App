import { Router } from "express";
import { ExamCatalogKind, InterventionCategory, RoomType } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { EXAM_CATALOG_KIND_SLUGS } from "../lib/exam-catalog-seed.js";
import { HOSPITALISATION_PRESCRIPTION_LABEL } from "../lib/hospitalization-referral.js";
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
  };
}

router.get("/", async (_req, res) => {
  const [items, interventions, rooms] = await Promise.all([
    prisma.examCatalogItem.findMany({
      where: { active: true },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
      select: {
        id: true,
        kind: true,
        code: true,
        label: true,
        category: true,
        priceFcfa: true,
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
    "examen" | "radio" | "echo" | "odonto" | "operation" | "hospitalisation",
    CatalogItemDto[]
  > = {
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
    })),
    hospitalisation: [defaultHospitalisationCatalogItem(rooms)],
  };

  for (const item of items) {
    const slug = KIND_TO_SLUG[item.kind];
    if (slug === "examen" || slug === "radio" || slug === "echo" || slug === "odonto") {
      grouped[slug].push(item);
    }
  }

  return res.json(grouped);
});

export default router;
