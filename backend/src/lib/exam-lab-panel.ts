import { ExamCatalogKind } from "@prisma/client";
import { prisma } from "./db.js";
import {
  examCatalogServiceScopeKey,
  isCanonicalServiceForExamKind,
} from "./clinic-service-exam.js";
import { refreshExamPriceCache } from "./lab-exam-prices.js";
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

function buildExamCatalogCodeFromPanel(slug: string, label: string) {
  const fromSlug = slugify(slug).slice(0, 64);
  if (fromSlug.length >= 2) return fromSlug;
  const fromLabel = slugify(label).slice(0, 48);
  if (fromLabel.length >= 2) return fromLabel;
  return `lab-${Date.now().toString(36)}`;
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

async function makeUniqueExamCode(base: string, clinicServiceId: string | null) {
  const scope = examCatalogServiceScopeKey(clinicServiceId);
  const root = (slugify(base) || "examen").slice(0, 56);
  let candidate = root;
  let suffix = 1;
  // eslint-disable-next-line no-await-in-loop
  while (
    await prisma.examCatalogItem.findFirst({
      where: {
        kind: ExamCatalogKind.EXAMEN,
        code: candidate,
        serviceScopeKey: scope,
      },
      select: { id: true },
    })
  ) {
    suffix += 1;
    candidate = `${root}-${suffix}`.slice(0, 64);
  }
  return candidate;
}

async function resolveLaboratoireClinicServiceId(): Promise<string | null> {
  const services = await prisma.clinicService.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const match = services.find((service) =>
    isCanonicalServiceForExamKind(service.name, ExamCatalogKind.EXAMEN),
  );
  return match?.id ?? null;
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

/**
 * Assure qu'un formulaire labo (saisie résultats) est un examen catalagué
 * proposable au médecin (prix 0 tant que l'admin ne l'a pas tarifé).
 */
export async function ensureExamLinkedToLabPanel(panelId: string): Promise<{
  panelId: string;
  examId: string | null;
  created: boolean;
  linked: boolean;
  synced: boolean;
}> {
  const panel = await prisma.labPanel.findUnique({
    where: { id: panelId },
    select: {
      id: true,
      slug: true,
      label: true,
      active: true,
      isEntry: true,
      _count: { select: { fields: true } },
      examCatalogItems: {
        where: { kind: ExamCatalogKind.EXAMEN },
        select: { id: true, label: true, active: true },
        take: 1,
      },
    },
  });

  if (!panel) {
    return { panelId, examId: null, created: false, linked: false, synced: false };
  }

  const hasEntryForm = panel.active && panel.isEntry && panel._count.fields > 0;
  const linkedExam = panel.examCatalogItems[0] ?? null;

  // Formulaire incomplet / inactif : ne pas proposer au médecin.
  if (!hasEntryForm) {
    if (linkedExam?.active) {
      await prisma.examCatalogItem.update({
        where: { id: linkedExam.id },
        data: { active: false },
      });
      await refreshExamPriceCache();
      return {
        panelId: panel.id,
        examId: linkedExam.id,
        created: false,
        linked: false,
        synced: true,
      };
    }
    return {
      panelId: panel.id,
      examId: linkedExam?.id ?? null,
      created: false,
      linked: false,
      synced: false,
    };
  }

  // Formulaire prêt (actifs + champs) → examen prescritible (lier / créer / activer).
  if (linkedExam) {
    const needsSync =
      linkedExam.label !== panel.label || linkedExam.active !== true;
    if (needsSync) {
      await prisma.examCatalogItem.update({
        where: { id: linkedExam.id },
        data: {
          label: panel.label,
          active: true,
        },
      });
      await refreshExamPriceCache();
    }
    return {
      panelId: panel.id,
      examId: linkedExam.id,
      created: false,
      linked: false,
      synced: needsSync,
    };
  }

  const clinicServiceId = await resolveLaboratoireClinicServiceId();
  const labelKey = normalizeExamFormLabelKey(panel.label);

  const orphanExams = await prisma.examCatalogItem.findMany({
    where: {
      kind: ExamCatalogKind.EXAMEN,
      labPanelId: null,
      ...(clinicServiceId
        ? {
            OR: [{ clinicServiceId }, { clinicServiceId: null }],
          }
        : {}),
    },
    select: {
      id: true,
      label: true,
      clinicServiceId: true,
      clinicService: { select: { name: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });

  const matchedOrphan = orphanExams.find((exam) => {
    if (normalizeExamFormLabelKey(exam.label) !== labelKey) return false;
    return examNeedsLabResultForm({
      kind: ExamCatalogKind.EXAMEN,
      clinicServiceId: exam.clinicServiceId,
      clinicServiceName: exam.clinicService?.name,
    });
  });

  if (matchedOrphan) {
    await prisma.examCatalogItem.update({
      where: { id: matchedOrphan.id },
      data: {
        labPanelId: panel.id,
        label: panel.label,
        active: true,
      },
    });
    await refreshExamPriceCache();
    return {
      panelId: panel.id,
      examId: matchedOrphan.id,
      created: false,
      linked: true,
      synced: false,
    };
  }

  const codeBase = buildExamCatalogCodeFromPanel(panel.slug, panel.label);
  const code = await makeUniqueExamCode(codeBase, clinicServiceId);

  const maxOrder = await prisma.examCatalogItem.aggregate({
    where: { kind: ExamCatalogKind.EXAMEN },
    _max: { sortOrder: true },
  });

  const created = await prisma.examCatalogItem.create({
    data: {
      kind: ExamCatalogKind.EXAMEN,
      code,
      label: panel.label.trim(),
      category: "Laboratoire",
      priceFcfa: 0,
      clinicServiceId,
      labPanelId: panel.id,
      serviceScopeKey: examCatalogServiceScopeKey(clinicServiceId),
      active: true,
      sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
    },
    select: { id: true },
  });

  await refreshExamPriceCache();
  return {
    panelId: panel.id,
    examId: created.id,
    created: true,
    linked: true,
    synced: false,
  };
}

/** Désactive l’examen catalogue lié avant suppression du formulaire. */
export async function deactivateExamLinkedToLabPanel(panelId: string): Promise<number> {
  const result = await prisma.examCatalogItem.updateMany({
    where: { labPanelId: panelId, kind: ExamCatalogKind.EXAMEN },
    data: { active: false },
  });
  if (result.count > 0) await refreshExamPriceCache();
  return result.count;
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

/** Crée / rattache un examen catalogue pour chaque formulaire labo orphelin. */
export async function syncAllLabPanelExamLinks(): Promise<{
  scanned: number;
  created: number;
  linked: number;
}> {
  const panels = await prisma.labPanel.findMany({
    where: { active: true },
    select: { id: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });

  let created = 0;
  let linked = 0;
  let scanned = 0;

  for (const panel of panels) {
    scanned += 1;
    // eslint-disable-next-line no-await-in-loop
    const result = await ensureExamLinkedToLabPanel(panel.id);
    if (result.created) created += 1;
    else if (result.linked) linked += 1;
  }

  return { scanned, created, linked };
}
