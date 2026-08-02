import type { ExamCatalogKindSlug } from '@/lib/exam-catalog-kinds'

/** Aligné avec backend suggestExamCatalogKindFromServiceName. */
export function suggestExamCatalogKindSlugFromServiceName(
  serviceName: string | null | undefined,
): ExamCatalogKindSlug {
  const name = String(serviceName ?? '')
    .trim()
    .toLowerCase()
  if (name.includes('odonto') || name.includes('dent')) return 'odonto'
  if (name.includes('radio') || name.includes('imagerie')) return 'radio'
  if (
    name.includes('echo') ||
    name.includes('échographie') ||
    name.includes('echographie') ||
    name.includes('cardio')
  ) {
    return 'echo'
  }
  return 'examen'
}
