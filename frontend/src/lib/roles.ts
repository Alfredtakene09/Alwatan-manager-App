export type AppUserRole =
  | 'ADMIN'
  | 'GESTIONNAIRE'
  | 'RECEPTIONNISTE'
  | 'MEDECIN'
  | 'COMPTABLE'
  | 'LABORANTIN'
  | 'SOIGNANT'
  | 'PHARMACIEN'
  | 'LOGISTIQUE'

export type SessionUser = {
  id: string
  username: string
  email: string
  firstName: string
  lastName: string
  role: AppUserRole
  /** MEDECIN : afficher « Mes opérations » (bloc / chirurgie / chirurgien autorisé). */
  showDoctorOperations?: boolean
  /** Boutons UI masqués pour ce rôle (vide pour Admin / Direction). */
  hiddenUiActions?: string[]
}

export const ROLE_LABELS: Record<AppUserRole, string> = {
  ADMIN: 'Administrateur',
  GESTIONNAIRE: 'Gestionnaire',
  RECEPTIONNISTE: 'Réceptionniste',
  MEDECIN: 'Médecin',
  COMPTABLE: 'Direction',
  LABORANTIN: 'Laborantin',
  SOIGNANT: 'Soignant',
  PHARMACIEN: 'Pharmacien',
  LOGISTIQUE: 'Logistique',
}

export const MANAGEABLE_USER_ROLES = [
  'GESTIONNAIRE',
  'RECEPTIONNISTE',
  'MEDECIN',
  'COMPTABLE',
  'LABORANTIN',
  'SOIGNANT',
  'PHARMACIEN',
  'LOGISTIQUE',
] as const satisfies readonly AppUserRole[]

export type ManageableUserRole = (typeof MANAGEABLE_USER_ROLES)[number]

/** Rôles assignables par l’administrateur (y compris ADMIN). */
export const ADMIN_ASSIGNABLE_USER_ROLES = [
  'ADMIN',
  ...MANAGEABLE_USER_ROLES,
] as const satisfies readonly AppUserRole[]

export type AdminAssignableUserRole = (typeof ADMIN_ASSIGNABLE_USER_ROLES)[number]

/**
 * Direction (COMPTABLE) et Gestionnaire partagent les mêmes vues / modules.
 * ADMIN conserve un accès transversal.
 */
export const DIRECTION_GESTIONNAIRE_ROLES: AppUserRole[] = ['ADMIN', 'COMPTABLE', 'GESTIONNAIRE']

export const MODULE_ACCESS: Record<string, AppUserRole[]> = {
  dashboard: ['ADMIN', 'RECEPTIONNISTE', 'MEDECIN', 'COMPTABLE', 'LABORANTIN', 'PHARMACIEN', 'GESTIONNAIRE', 'LOGISTIQUE', 'SOIGNANT'],
  reception: ['ADMIN', 'RECEPTIONNISTE', 'COMPTABLE', 'GESTIONNAIRE'],
  consultation: ['ADMIN', 'MEDECIN', 'COMPTABLE', 'GESTIONNAIRE'],
  comptabilite: [...DIRECTION_GESTIONNAIRE_ROLES],
  hospitalisation: ['ADMIN', 'RECEPTIONNISTE', 'COMPTABLE', 'GESTIONNAIRE'],
  'bloc-salles': ['ADMIN', 'COMPTABLE', 'SOIGNANT', 'GESTIONNAIRE'],
  pharmacie: ['ADMIN', 'PHARMACIEN', 'COMPTABLE', 'GESTIONNAIRE'],
  logistique: ['ADMIN', 'LOGISTIQUE', 'COMPTABLE', 'GESTIONNAIRE'],
  laboratoire: ['ADMIN', 'LABORANTIN', 'COMPTABLE', 'GESTIONNAIRE'],
  'dossier-patient': ['ADMIN', 'MEDECIN', 'LABORANTIN', 'COMPTABLE', 'GESTIONNAIRE'],
  factures: [...DIRECTION_GESTIONNAIRE_ROLES],
  utilisateurs: [...DIRECTION_GESTIONNAIRE_ROLES],
  /** Comptes de connexion — admin, direction et gestionnaire. */
  'user-accounts': [...DIRECTION_GESTIONNAIRE_ROLES],
  admin: [...DIRECTION_GESTIONNAIRE_ROLES],
  gestionnaire: [...DIRECTION_GESTIONNAIRE_ROLES],
}

export function canAccessModule(role: AppUserRole, module: string) {
  return MODULE_ACCESS[module]?.includes(role) ?? false
}

export function canAccessAnyModule(role: AppUserRole, modules: string[]) {
  return modules.some((module) => canAccessModule(role, module))
}

/** Nomenclatures, suppressions, structure — réservé admin / direction / gestionnaire. */
export const MANAGEMENT_ROLES: AppUserRole[] = DIRECTION_GESTIONNAIRE_ROLES

export function canManageResources(role: AppUserRole) {
  return MANAGEMENT_ROLES.includes(role)
}

/** Direction et Gestionnaire — mêmes droits de supervision / lecture clinique. */
export function isDirectionOrGestionnaire(role: AppUserRole) {
  return role === 'COMPTABLE' || role === 'GESTIONNAIRE' || role === 'ADMIN'
}

/**
 * Catalogue pharmacie (catégories / fournisseurs / écriture produits).
 * Tous les rôles ayant accès au module pharmacie.
 */
export const PHARMACY_CATALOG_ROLES: AppUserRole[] = MODULE_ACCESS.pharmacie

export function canManagePharmacyCatalog(role: AppUserRole) {
  return PHARMACY_CATALOG_ROLES.includes(role)
}

/** Écriture catalogue pharmacie (aligné sur le backend — sans filtre UI granulaire). */
export function canWritePharmacyCatalog(user: SessionUser | null | undefined) {
  if (!user?.role) return false
  return canManagePharmacyCatalog(user.role)
}

/**
 * Stock laboratoire (réactifs / consommables).
 * Réservé gestionnaire et Direction — laborantin exclu.
 */
export const LAB_STOCK_ROLES: AppUserRole[] = DIRECTION_GESTIONNAIRE_ROLES

export function canManageLabStock(role: AppUserRole) {
  return LAB_STOCK_ROLES.includes(role)
}

export function canWriteDossierDocuments(role: AppUserRole) {
  return (
    role === 'ADMIN' ||
    role === 'MEDECIN' ||
    role === 'LABORANTIN' ||
    role === 'COMPTABLE' ||
    role === 'GESTIONNAIRE'
  )
}

export function getDefaultRoute(role: AppUserRole) {
  switch (role) {
    case 'RECEPTIONNISTE':
      return '/reception'
    case 'MEDECIN':
      return '/consultation'
    case 'COMPTABLE':
    case 'GESTIONNAIRE':
      return '/dashboard'
    case 'SOIGNANT':
      return '/bloc-salles/tableau-de-bord'
    case 'PHARMACIEN':
      return '/pharmacie/caisse'
    case 'LOGISTIQUE':
      return '/logistique/tableau-de-bord'
    case 'LABORANTIN':
      return '/laboratoire'
    default:
      return '/dashboard'
  }
}

export function fullName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim()
}

import { formatFcfa, formatFcfaCompact, formatFcfaDigits, formatFcfaShort } from './format-fcfa.js'

export { formatFcfa, formatFcfaCompact, formatFcfaDigits, formatFcfaShort }
