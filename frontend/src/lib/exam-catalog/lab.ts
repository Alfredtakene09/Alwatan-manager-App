import type { CatalogExam } from './types'

/** Catalogue laboratoire — analyses biologiques */
export const LAB_EXAM_CATALOG: CatalogExam[] = [
  { id: 'nfs', code: 'nfs', label: 'Numération formule sanguine (NFS)', category: 'Hématologie', priceFcfa: 5000 },
  { id: 'groupage', code: 'groupage', label: 'Groupage sanguin', category: 'Hématologie', priceFcfa: 4000 },
  { id: 'glycemie', code: 'glycemie', label: 'Glycémie', category: 'Biochimie', priceFcfa: 2500 },
  { id: 'creatinine', code: 'creatinine', label: 'Créatininémie', category: 'Biochimie', priceFcfa: 3500 },
  { id: 'uree', code: 'uree', label: 'Urée sanguine', category: 'Biochimie', priceFcfa: 3500 },
  { id: 'hepatique', code: 'hepatique', label: 'Bilan hépatique', category: 'Biochimie', priceFcfa: 12000 },
  { id: 'lipidique', code: 'lipidique', label: 'Bilan lipidique', category: 'Biochimie', priceFcfa: 10000 },
  { id: 'ionogramme', code: 'ionogramme', label: 'Ionogramme sanguin', category: 'Biochimie', priceFcfa: 6000 },
  { id: 'crp', code: 'crp', label: 'CRP', category: 'Biochimie', priceFcfa: 4500 },
  { id: 'ecbu', code: 'ecbu', label: 'ECBU', category: 'Urinaire', priceFcfa: 4000 },
  { id: 'proteinurie', code: 'proteinurie', label: 'Protéinurie des 24 h', category: 'Urinaire', priceFcfa: 5000 },
  { id: 'vih', code: 'vih', label: 'Sérologie VIH', category: 'Sérologie', priceFcfa: 5000 },
  { id: 'hbs', code: 'hbs', label: 'Ag HBs', category: 'Sérologie', priceFcfa: 4500 },
  { id: 'hcv', code: 'hcv', label: 'Sérologie HCV', category: 'Sérologie', priceFcfa: 4500 },
  { id: 'paludisme', code: 'paludisme', label: 'Test paludisme (TDR)', category: 'Parasitologie', priceFcfa: 3000 },
  { id: 'grossesse', code: 'grossesse', label: 'Test de grossesse (BHCG)', category: 'Biologie', priceFcfa: 3500 },
]
