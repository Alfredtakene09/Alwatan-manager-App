import { ExamCatalogKind } from "@prisma/client";
import { prisma } from "./db.js";
import { isCanonicalServiceForExamKind } from "./clinic-service-exam.js";
import { refreshLabPanelRegistry } from "./lab-panels-registry.js";

export function normalizeExamFormLabelKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

async function makeUniquePanelSlug(base: string) {
  const root = slugify(base) || "examen";
  let candidate = root;
  let suffix = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await prisma.labPanel.findUnique({ where: { slug: candidate } })) {
    suffix += 1;
    candidate = `${root}-${suffix}`;
  }
  return candidate;
}

/** Examens du compte Laboratoire (pas les nomenclatures de spécialité). */
export function examNeedsLabResultForm(item: {
  kind: ExamCatalogKind;
  clinicServiceId?: string | null;
  clinicServiceName?: string | null;
}): boolean {
  if (item.kind !== ExamCatalogKind.EXAMEN) return false;
  if (!item.clinicServiceId) return true;
  return isCanonicalServiceForExamKind(item.clinicServiceName, ExamCatalogKind.EXAMEN);
}

/**
 * Assure qu'un examen labo a un formulaire de résultats lié.
 * - Réutilise un formulaire existant au même libellé s'il n'est pas déjà lié
 * - Sinon crée un formulaire vide (champs à compléter plus tard)
 */
export async function ensureLabPanelLinkedToExam(examId: string): Promise<{
  examId: string;
  labPanelId: string | null;
  created: boolean;
  linked: boolean;
}> {
  const exam = await prisma.examCatalogItem.findUnique({
    where: { id: examId },
    select: {
      id: true,
      kind: true,
      code: true,
      label: true,
      clinicServiceId: true,
      labPanelId: true,
      clinicService: { select: { name: true } },
      labPanel: { select: { id: true, label: true } },
    },
  });

  if (!exam) {
    return { examId, labPanelId: null, created: false, linked: false };
  }

  if (
    !examNeedsLabResultForm({
      kind: exam.kind,
      clinicServiceId: exam.clinicServiceId,
      clinicServiceName: exam.clinicService?.name,
    })
  ) {
    return { examId: exam.id, labPanelId: exam.labPanelId, created: false, linked: false };
  }

  if (exam.labPanelId && exam.labPanel) {
    if (exam.labPanel.label !== exam.label) {
      await prisma.labPanel.update({
        where: { id: exam.labPanel.id },
        data: { label: exam.label },
      });
      await refreshLabPanelRegistry();
    }
    return { examId: exam.id, labPanelId: exam.labPanelId, created: false, linked: false };
  }

  const labelKey = normalizeExamFormLabelKey(exam.label);
  const candidates = await prisma.labPanel.findMany({
    where: { examCatalogItems: { none: {} } },
    select: { id: true, label: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  const matched = candidates.find(
    (panel) => normalizeExamFormLabelKey(panel.label) === labelKey,
  );

  if (matched) {
    await prisma.examCatalogItem.update({
      where: { id: exam.id },
      data: { labPanelId: matched.id },
    });
    if (matched.label !== exam.label) {
      await prisma.labPanel.update({
        where: { id: matched.id },
        data: { label: exam.label },
      });
      await refreshLabPanelRegistry();
    }
    return { examId: exam.id, labPanelId: matched.id, created: false, linked: true };
  }

  const maxOrder = await prisma.labPanel.aggregate({ _max: { sortOrder: true } });
  const slug = await makeUniquePanelSlug(exam.code || exam.label);
  const panel = await prisma.labPanel.create({
    data: {
      slug,
      label: exam.label,
      isEntry: true,
      active: true,
      sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
    },
  });

  await prisma.examCatalogItem.update({
    where: { id: exam.id },
    data: { labPanelId: panel.id },
  });
  await refreshLabPanelRegistry();

  return { examId: exam.id, labPanelId: panel.id, created: true, linked: true };
}

/** Lie / crée les formulaires pour tous les examens labo déjà en base. */
export async function syncAllExamLabPanelLinks(): Promise<{
  scanned: number;
  created: number;
  linked: number;
}> {
  const exams = await prisma.examCatalogItem.findMany({
    where: { kind: ExamCatalogKind.EXAMEN },
    select: {
      id: true,
      kind: true,
      clinicServiceId: true,
      labPanelId: true,
      clinicService: { select: { name: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });

  let created = 0;
  let linked = 0;
  let scanned = 0;

  for (const exam of exams) {
    if (
      !examNeedsLabResultForm({
        kind: exam.kind,
        clinicServiceId: exam.clinicServiceId,
        clinicServiceName: exam.clinicService?.name,
      })
    ) {
      continue;
    }
    scanned += 1;
    // eslint-disable-next-line no-await-in-loop
    const result = await ensureLabPanelLinkedToExam(exam.id);
    if (result.created) created += 1;
    else if (result.linked) linked += 1;
  }

  return { scanned, created, linked };
}
