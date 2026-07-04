import { LAB_EXAM_CATALOG } from './lab'
import { RADIO_EXAM_CATALOG } from './radio'
import { ECHO_EXAM_CATALOG } from './echo'
import { ODONTO_EXAM_CATALOG } from './odonto'
import { getExamCatalogSync } from './store'
import { EXAM_KIND_ORDER, type ExamKindSlug } from './types'

const FALLBACK_LABEL_KIND = new Map<string, ExamKindSlug>([
  ...LAB_EXAM_CATALOG.map((e) => [e.label, 'examen'] as const),
  ...RADIO_EXAM_CATALOG.map((e) => [e.label, 'radio'] as const),
  ...ECHO_EXAM_CATALOG.map((e) => [e.label, 'echo'] as const),
  ...ODONTO_EXAM_CATALOG.map((e) => [e.label, 'odonto'] as const),
])

function buildLabelKindMap(): Map<string, ExamKindSlug> {
  const map = new Map(FALLBACK_LABEL_KIND)
  const catalog = getExamCatalogSync()
  for (const kind of EXAM_KIND_ORDER) {
    for (const exam of catalog[kind] ?? []) {
      map.set(exam.label, kind)
    }
  }
  return map
}

export function inferExamKindFromLabel(label: string): ExamKindSlug {
  return buildLabelKindMap().get(label.trim()) ?? 'examen'
}
