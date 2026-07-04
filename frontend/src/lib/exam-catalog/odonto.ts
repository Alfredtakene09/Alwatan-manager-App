import type { CatalogExam } from './types'

/** Catalogue odontologie */
export const ODONTO_EXAM_CATALOG: CatalogExam[] = [
  { id: 'consultation-odonto', code: 'consultation-odonto', label: 'Consultation dentaire', category: 'Soins', priceFcfa: 5000 },
  { id: 'detartrage', code: 'detartrage', label: 'Détartrage', category: 'Soins', priceFcfa: 8000 },
  { id: 'extraction-simple', code: 'extraction-simple', label: 'Extraction simple', category: 'Chirurgie', priceFcfa: 12000 },
  { id: 'extraction-chirurgicale', code: 'extraction-chirurgicale', label: 'Extraction chirurgicale', category: 'Chirurgie', priceFcfa: 25000 },
  { id: 'obturation', code: 'obturation', label: 'Obturation (plombage)', category: 'Soins', priceFcfa: 15000 },
  { id: 'devitalisation', code: 'devitalisation', label: 'Dévitalisation', category: 'Soins', priceFcfa: 35000 },
  { id: 'prothese', code: 'prothese', label: 'Prothèse dentaire', category: 'Prothèse', priceFcfa: 80000 },
]
