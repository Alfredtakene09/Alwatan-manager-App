import type { CatalogExam } from './types'

/** Catalogue échographie */
export const ECHO_EXAM_CATALOG: CatalogExam[] = [
  { id: 'echographie', code: 'echographie', label: 'Échographie', category: 'Imagerie', priceFcfa: 25000 },
  { id: 'echo-cardiaque', code: 'echo-cardiaque', label: 'Échographie cardiaque', category: 'Cardiologie', priceFcfa: 35000 },
  { id: 'ecg', code: 'ecg', label: 'ECG', category: 'Cardiologie', priceFcfa: 8000 },
]
