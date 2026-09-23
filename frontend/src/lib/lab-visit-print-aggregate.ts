import { getAllLabFormPanels, type LabPanelSlug } from './lab-form-panels'

/** Classe layout flux (contenu dense / feuille classique / condensé multi-examens). */
export const LAB_VISIT_FLOW_ARTICLE_CLASS = 'lab-result-print--flow'

/** Slug Routine Investigation — jamais condensé avec les autres formulaires. */
export const ROUTINE_PANEL_SLUG: LabPanelSlug = 'routine'

export function isRoutinePanelSlug(slug: LabPanelSlug) {
  return slug === ROUTINE_PANEL_SLUG
}

export function panelResultsHaveValues(values?: Record<string, string> | null) {
  if (!values) return false
  return Object.values(values).some((value) => String(value ?? '').trim().length > 0)
}

/**
 * Formulaires d’une visite à imprimer ensemble (condensé hors Routine, 1 job).
 * Les panneaux sans valeur (en attente / non saisis) sont exclus ; on n’agrège jamais
 * plusieurs visites — l’appelant ne passe que les résultats de la visite courante.
 */
export function resolveLabVisitPrintSlugs(
  panelResults: Partial<Record<LabPanelSlug, Record<string, string>>>,
  preferSlugs?: LabPanelSlug[],
) {
  const filled = Object.keys(panelResults).filter((slug) =>
    panelResultsHaveValues(panelResults[slug]),
  )
  if (!filled.length) return [] as LabPanelSlug[]

  const ordered: LabPanelSlug[] = []
  const push = (slug: LabPanelSlug) => {
    if (!ordered.includes(slug) && filled.includes(slug)) ordered.push(slug)
  }

  for (const slug of preferSlugs ?? []) push(slug)
  for (const panel of getAllLabFormPanels()) push(panel.slug)
  for (const slug of filled) push(slug)

  return ordered
}

export type LabVisitPrintPlan = {
  slugs: LabPanelSlug[]
  /** Toujours 1 : un seul fichier / une seule action d’impression. */
  documentCount: 1
  articleClass: typeof LAB_VISIT_FLOW_ARTICLE_CLASS
  skippedEmpty: LabPanelSlug[]
  /** Feuilles prévues : 1 condensée (si ≥1 hors Routine) + 1 par Routine. */
  expectedSheetCount: number
  condensedSlugs: LabPanelSlug[]
  routineSlugs: LabPanelSlug[]
}

export function planLabVisitPrint(
  panelResults: Partial<Record<LabPanelSlug, Record<string, string>>>,
  preferSlugs?: LabPanelSlug[],
): LabVisitPrintPlan {
  const slugs = resolveLabVisitPrintSlugs(panelResults, preferSlugs)
  const skippedEmpty = Object.keys(panelResults).filter(
    (slug) => !panelResultsHaveValues(panelResults[slug]),
  )
  const condensedSlugs = slugs.filter((slug) => !isRoutinePanelSlug(slug))
  const routineSlugs = slugs.filter((slug) => isRoutinePanelSlug(slug))
  const expectedSheetCount = (condensedSlugs.length > 0 ? 1 : 0) + routineSlugs.length
  return {
    slugs,
    documentCount: 1,
    articleClass: LAB_VISIT_FLOW_ARTICLE_CLASS,
    skippedEmpty,
    expectedSheetCount,
    condensedSlugs,
    routineSlugs,
  }
}

/** Contrats du HTML multi-feuilles (tests + garde-fous). */
export function inspectLabVisitPrintHtml(html: string) {
  const articles = html.match(/<article\b[^>]*>/gi) ?? []
  return {
    articleCount: articles.length,
    hasFlowClass: html.includes(LAB_VISIT_FLOW_ARTICLE_CLASS),
    forcedSinglePageCount: (html.match(/lab-result-print--single-page/g) ?? []).length,
    hasPageBreakAfterAlways: /page-break-after:\s*always/i.test(html),
    panelBlockCount: (html.match(/lab-result-print__panel-block/g) ?? []).length,
    hasCombinedClass: html.includes('lab-result-print--combined'),
  }
}
