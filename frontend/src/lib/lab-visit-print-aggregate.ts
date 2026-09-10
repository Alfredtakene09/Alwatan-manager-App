import { getAllLabFormPanels, type LabPanelSlug } from './lab-form-panels'

/** Un seul article HTML pour toute la visite — la pagination est un flux CSS, pas plusieurs jobs. */
export const LAB_VISIT_FLOW_ARTICLE_CLASS = 'lab-result-print--flow'

export function panelResultsHaveValues(values?: Record<string, string> | null) {
  if (!values) return false
  return Object.values(values).some((value) => String(value ?? '').trim().length > 0)
}

/**
 * Formulaires d’une visite à imprimer ensemble.
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
}

export function planLabVisitPrint(
  panelResults: Partial<Record<LabPanelSlug, Record<string, string>>>,
  preferSlugs?: LabPanelSlug[],
): LabVisitPrintPlan {
  const slugs = resolveLabVisitPrintSlugs(panelResults, preferSlugs)
  const skippedEmpty = Object.keys(panelResults).filter(
    (slug) => !panelResultsHaveValues(panelResults[slug]),
  )
  return {
    slugs,
    documentCount: 1,
    articleClass: LAB_VISIT_FLOW_ARTICLE_CLASS,
    skippedEmpty,
  }
}

/** Contrats du HTML combiné (tests + garde-fous). */
export function inspectLabVisitPrintHtml(html: string) {
  const articles = html.match(/<article\b[^>]*>/gi) ?? []
  return {
    articleCount: articles.length,
    hasFlowClass: html.includes(LAB_VISIT_FLOW_ARTICLE_CLASS),
    forcedSinglePageCount: (html.match(/lab-result-print--single-page/g) ?? []).length,
    panelBlockCount: (html.match(/lab-result-print__panel-block/g) ?? []).length,
    hasPageBreakInsideAvoid: /page-break-inside:\s*avoid/i.test(html),
  }
}
