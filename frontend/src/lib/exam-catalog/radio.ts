import type { CatalogExam } from './types'

/** Catalogue radiologie */
export const RADIO_EXAM_CATALOG: CatalogExam[] = [
  { id: 'radiographie', code: 'radiographie', label: 'Radiographie', category: 'Imagerie', priceFcfa: 15000 },
  { id: 'scanner', code: 'scanner', label: 'Scanner', category: 'Imagerie', priceFcfa: 80000 },
  { id: 'irm', code: 'irm', label: 'IRM', category: 'Imagerie', priceFcfa: 120000 },
]
