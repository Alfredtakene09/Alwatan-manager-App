export type AppUserRole =
  | 'ADMIN'
  | 'GESTIONNAIRE'
  | 'RECEPTIONNISTE'
  | 'MEDECIN'
  | 'COMPTABLE'
  | 'LABORANTIN'
  | 'SOIGNANT'
  | 'PHARMACIEN'

export type SessionUser = {
  id: string
  email: string
  firstName: string
  lastName: string
  role: AppUserRole
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
}

export const MANAGEABLE_USER_ROLES = [
  'GESTIONNAIRE',
  'RECEPTIONNISTE',
  'MEDECIN',
  'COMPTABLE',
  'LABORANTIN',
  'PHARMACIEN',
] as const satisfies readonly AppUserRole[]

export type ManageableUserRole = (typeof MANAGEABLE_USER_ROLES)[number]

/** Direction (COMPTABLE) gère désormais les modules d’administration. */
export const MODULE_ACCESS: Record<string, AppUserRole[]> = {
  dashboard: ['ADMIN', 'RECEPTIONNISTE', 'MEDECIN', 'COMPTABLE', 'LABORANTIN', 'PHARMACIEN', 'GESTIONNAIRE'],
  reception: ['ADMIN', 'RECEPTIONNISTE', 'COMPTABLE'],
  consultation: ['ADMIN', 'MEDECIN', 'COMPTABLE'],
  comptabilite: ['ADMIN', 'COMPTABLE'],
  hospitalisation: ['ADMIN', 'RECEPTIONNISTE', 'COMPTABLE'],
  'bloc-salles': ['ADMIN', 'COMPTABLE'],
  pharmacie: ['ADMIN', 'PHARMACIEN', 'COMPTABLE'],
  laboratoire: ['ADMIN', 'LABORANTIN', 'COMPTABLE'],
  'dossier-patient': ['ADMIN', 'MEDECIN', 'LABORANTIN', 'COMPTABLE'],
  factures: ['ADMIN', 'COMPTABLE'],
  utilisateurs: ['ADMIN', 'COMPTABLE'],
  admin: ['ADMIN', 'COMPTABLE'],
  gestionnaire: ['ADMIN', 'GESTIONNAIRE', 'COMPTABLE'],
}

export function canAccessModule(role: AppUserRole, module: string) {
  return MODULE_ACCESS[module]?.includes(role) ?? false
}

/** Nomenclatures, suppressions, structure — réservé admin / comptabilité. */
export const MANAGEMENT_ROLES: AppUserRole[] = ['ADMIN', 'COMPTABLE']

export function canManageResources(role: AppUserRole) {
  return MANAGEMENT_ROLES.includes(role)
}

export function canWriteDossierDocuments(role: AppUserRole) {
  return role === 'ADMIN' || role === 'MEDECIN' || role === 'LABORANTIN' || role === 'COMPTABLE'
}

export function getDefaultRoute(role: AppUserRole) {
  switch (role) {
    case 'RECEPTIONNISTE':
      return '/reception'
    case 'MEDECIN':
      return '/consultation'
    case 'COMPTABLE':
      return '/reception'
    case 'SOIGNANT':
      return '/bloc-salles/tableau-de-bord'
    case 'PHARMACIEN':
      return '/pharmacie/tableau-de-bord'
    case 'LABORANTIN':
      return '/laboratoire'
    case 'GESTIONNAIRE':
      return '/gestionnaire/tableau-de-bord'
    default:
      return '/dashboard'
  }
}

export function fullName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim()
}

import { formatFcfa, formatFcfaDigits } from './format-fcfa.js'

export { formatFcfa, formatFcfaDigits }
