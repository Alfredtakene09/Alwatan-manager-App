import type { AppUserRole } from './roles'

/** Rôles dont on peut masquer des boutons (pas Admin ni Direction). */
export const UI_ACTION_TARGET_ROLES = [
  'GESTIONNAIRE',
  'RECEPTIONNISTE',
  'MEDECIN',
  'LABORANTIN',
  'SOIGNANT',
  'PHARMACIEN',
  'LOGISTIQUE',
] as const satisfies readonly AppUserRole[]

export type UiActionTargetRole = (typeof UI_ACTION_TARGET_ROLES)[number]

export type UiActionGroupId =
  | 'general'
  | 'reception'
  | 'users'
  | 'employees'
  | 'pharmacy'
  | 'lab'
  | 'accounting'
  | 'catalog'
  | 'hospitalisation'

export type UiActionDef = {
  id: string
  group: UiActionGroupId
  label: string
  hint?: string
  defaultRoles: readonly UiActionTargetRole[]
}

const ALL_TARGETS = UI_ACTION_TARGET_ROLES
const DIRECTION_STAFF: readonly UiActionTargetRole[] = ['GESTIONNAIRE']
const LAB_FORMS_ROLES: readonly UiActionTargetRole[] = ['GESTIONNAIRE', 'LABORANTIN']
const ROOMS_ROLES: readonly UiActionTargetRole[] = ['GESTIONNAIRE', 'SOIGNANT']

export const UI_ACTION_GROUPS: { id: UiActionGroupId; label: string }[] = [
  { id: 'general', label: 'Actions générales' },
  { id: 'reception', label: 'Enregistrement' },
  { id: 'accounting', label: 'Comptabilité' },
  { id: 'catalog', label: 'Types & catalogues' },
  { id: 'hospitalisation', label: 'Hospitalisation & salles' },
  { id: 'lab', label: 'Laboratoire' },
  { id: 'pharmacy', label: 'Pharmacie' },
  { id: 'users', label: 'Utilisateurs' },
  { id: 'employees', label: 'Personnel' },
]

export const UI_ACTIONS: UiActionDef[] = [
  {
    id: 'table.create',
    group: 'general',
    label: 'Ajouter / Nouveau (catalogues)',
    hint: 'Boutons d’ajout sur les nomenclatures et listes.',
    defaultRoles: ALL_TARGETS,
  },
  {
    id: 'table.edit',
    group: 'general',
    label: 'Modifier une ligne',
    defaultRoles: ALL_TARGETS,
  },
  {
    id: 'table.delete',
    group: 'general',
    label: 'Supprimer une ligne',
    defaultRoles: ALL_TARGETS,
  },
  {
    id: 'table.toggle',
    group: 'general',
    label: 'Activer / Désactiver',
    defaultRoles: ALL_TARGETS,
  },
  {
    id: 'export.pdf',
    group: 'general',
    label: 'Exporter PDF',
    defaultRoles: ALL_TARGETS,
  },
  {
    id: 'export.excel',
    group: 'general',
    label: 'Exporter Excel',
    defaultRoles: ALL_TARGETS,
  },
  {
    id: 'export.print',
    group: 'general',
    label: 'Imprimer',
    hint: 'Dossiers, résultats laboratoire et ordonnances.',
    defaultRoles: ALL_TARGETS,
  },
  {
    id: 'dossier.attach',
    group: 'general',
    label: 'Joindre un fichier',
    hint: 'Ajouter un fichier au dossier patient.',
    defaultRoles: ['GESTIONNAIRE', 'MEDECIN', 'LABORANTIN'],
  },
  {
    id: 'reception.create_patient',
    group: 'reception',
    label: 'Nouveau patient',
    defaultRoles: ['GESTIONNAIRE', 'RECEPTIONNISTE'],
  },
  {
    id: 'reception.edit_patient',
    group: 'reception',
    label: 'Modifier le dossier',
    defaultRoles: ['GESTIONNAIRE', 'RECEPTIONNISTE'],
  },
  {
    id: 'reception.delete_patient',
    group: 'reception',
    label: 'Supprimer le dossier',
    defaultRoles: ['GESTIONNAIRE', 'RECEPTIONNISTE'],
  },
  {
    id: 'reception.reconsult',
    group: 'reception',
    label: 'Reconsultation',
    defaultRoles: ['GESTIONNAIRE', 'RECEPTIONNISTE'],
  },
  {
    id: 'reception.print_receipt',
    group: 'reception',
    label: 'Réimprimer le reçu de consultation',
    defaultRoles: ['GESTIONNAIRE', 'RECEPTIONNISTE'],
  },
  {
    id: 'reception.pay_consultation',
    group: 'reception',
    label: 'Encaisser la consultation',
    defaultRoles: DIRECTION_STAFF,
  },
  {
    id: 'comptabilite.encaissements',
    group: 'accounting',
    label: 'Encaissements',
    hint: 'Menu Comptabilité → Encaissements.',
    defaultRoles: DIRECTION_STAFF,
  },
  {
    id: 'comptabilite.journal',
    group: 'accounting',
    label: 'Caisse & journal',
    defaultRoles: DIRECTION_STAFF,
  },
  {
    id: 'comptabilite.depenses',
    group: 'accounting',
    label: 'Gestion des dépenses',
    defaultRoles: DIRECTION_STAFF,
  },
  {
    id: 'comptabilite.salaires',
    group: 'accounting',
    label: 'Salaires & paie',
    defaultRoles: DIRECTION_STAFF,
  },
  {
    id: 'comptabilite.factures',
    group: 'accounting',
    label: 'Factures',
    defaultRoles: DIRECTION_STAFF,
  },
  {
    id: 'comptabilite.exam_payments',
    group: 'accounting',
    label: 'Paiement examens',
    hint: 'Examens payés, réclamations, en attente de paiement.',
    defaultRoles: ['GESTIONNAIRE', 'RECEPTIONNISTE'],
  },
  {
    id: 'comptabilite.reduction',
    group: 'accounting',
    label: 'Réduction avant encaissement (consultation)',
    defaultRoles: DIRECTION_STAFF,
  },
  {
    id: 'catalog.exam_types',
    group: 'catalog',
    label: "Types d'examen",
    hint: 'Nomenclature et tarifs des examens.',
    defaultRoles: DIRECTION_STAFF,
  },
  {
    id: 'catalog.operation_types',
    group: 'catalog',
    label: 'Types opérations',
    hint: 'Types d’opération, tarifs et parts médecins.',
    defaultRoles: DIRECTION_STAFF,
  },
  {
    id: 'catalog.services',
    group: 'catalog',
    label: 'Services',
    hint: 'Services cliniques et médecins associés.',
    defaultRoles: DIRECTION_STAFF,
  },
  {
    id: 'hospitalisation.rooms',
    group: 'hospitalisation',
    label: 'Bloc & salles',
    hint: 'Menu, ajout et modification des chambres.',
    defaultRoles: ROOMS_ROLES,
  },
  {
    id: 'lab.result_forms',
    group: 'lab',
    label: 'Formulaires de résultats',
    hint: 'Créer et modifier les formulaires de résultats labo.',
    defaultRoles: LAB_FORMS_ROLES,
  },
  {
    id: 'lab.stock',
    group: 'lab',
    label: 'Stock laboratoire',
    defaultRoles: DIRECTION_STAFF,
  },
  {
    id: 'pharmacie.catalog',
    group: 'pharmacy',
    label: 'Catalogue pharmacie (catégories, fournisseurs, produits)',
    defaultRoles: DIRECTION_STAFF,
  },
  {
    id: 'users.create',
    group: 'users',
    label: 'Nouvel utilisateur',
    defaultRoles: DIRECTION_STAFF,
  },
  {
    id: 'employees.create',
    group: 'employees',
    label: 'Ajouter un employé',
    defaultRoles: DIRECTION_STAFF,
  },
]

export type HiddenByRole = Partial<Record<UiActionTargetRole, string[]>>

export function isUiActionTargetRole(role: string): role is UiActionTargetRole {
  return (UI_ACTION_TARGET_ROLES as readonly string[]).includes(role)
}

export function actionAppliesToRole(action: UiActionDef, role: UiActionTargetRole) {
  return action.defaultRoles.includes(role)
}

/** Admin et Direction ne sont jamais restreints. Sinon, masqué seulement si listé. */
export function isUiActionAllowed(
  user: { role: AppUserRole; hiddenUiActions?: string[] } | null | undefined,
  actionId: string,
) {
  if (!user) return false
  if (user.role === 'ADMIN' || user.role === 'COMPTABLE') return true
  return !(user.hiddenUiActions ?? []).includes(actionId)
}
