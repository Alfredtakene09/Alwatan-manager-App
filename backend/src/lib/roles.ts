export const USER_ROLES = [
  "ADMIN",
  "GESTIONNAIRE",
  "RECEPTIONNISTE",
  "MEDECIN",
  "COMPTABLE",
  "LABORANTIN",
  "SOIGNANT",
  "PHARMACIEN",
  "LOGISTIQUE",
] as const;

export type AppUserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<AppUserRole, string> = {
  ADMIN: "Administrateur",
  GESTIONNAIRE: "Gestionnaire",
  RECEPTIONNISTE: "Réceptionniste",
  MEDECIN: "Médecin",
  COMPTABLE: "Direction",
  LABORANTIN: "Laborantin",
  SOIGNANT: "Soignant",
  PHARMACIEN: "Pharmacien",
  LOGISTIQUE: "Logistique",
};

export const MANAGEABLE_USER_ROLES = [
  "GESTIONNAIRE",
  "RECEPTIONNISTE",
  "MEDECIN",
  "COMPTABLE",
  "LABORANTIN",
  "SOIGNANT",
  "PHARMACIEN",
  "LOGISTIQUE",
] as const satisfies readonly AppUserRole[];

export type ManageableUserRole = (typeof MANAGEABLE_USER_ROLES)[number];

/** Rôles assignables par l’administrateur (y compris ADMIN). */
export const ADMIN_ASSIGNABLE_USER_ROLES = [
  "ADMIN",
  ...MANAGEABLE_USER_ROLES,
] as const satisfies readonly AppUserRole[];

export type AdminAssignableUserRole = (typeof ADMIN_ASSIGNABLE_USER_ROLES)[number];

/** Direction (COMPTABLE) gère désormais les modules d’administration. */
export const MODULE_ACCESS: Record<string, AppUserRole[]> = {
  dashboard: [...USER_ROLES],
  reception: ["ADMIN", "RECEPTIONNISTE", "COMPTABLE"],
  consultation: ["ADMIN", "MEDECIN", "COMPTABLE"],
  comptabilite: ["ADMIN", "COMPTABLE"],
  hospitalisation: ["ADMIN", "RECEPTIONNISTE", "COMPTABLE"],
  "bloc-salles": ["ADMIN", "COMPTABLE", "SOIGNANT"],
  pharmacie: ["ADMIN", "PHARMACIEN", "COMPTABLE", "GESTIONNAIRE"],
  logistique: ["ADMIN", "LOGISTIQUE", "COMPTABLE"],
  laboratoire: ["ADMIN", "LABORANTIN", "COMPTABLE"],
  "dossier-patient": ["ADMIN", "MEDECIN", "LABORANTIN", "COMPTABLE"],
  factures: ["ADMIN", "COMPTABLE"],
  utilisateurs: ["ADMIN", "COMPTABLE"],
  /** Comptes de connexion — réservé à l’administrateur plateforme. */
  "user-accounts": ["ADMIN"],
  admin: ["ADMIN", "COMPTABLE"],
  gestionnaire: ["ADMIN", "GESTIONNAIRE", "COMPTABLE"],
};

export function canAccessModule(role: AppUserRole, module: string) {
  return MODULE_ACCESS[module]?.includes(role) ?? false
}

/** Nomenclatures, suppressions, structure (salles, dossiers…) — pas la réception. */
export const MANAGEMENT_ROLES: AppUserRole[] = ["ADMIN", "COMPTABLE"]

export function canManageResources(role: AppUserRole) {
  return MANAGEMENT_ROLES.includes(role)
}

/**
 * Catalogue pharmacie (catégories, produits, fournisseurs, mouvements).
 * PHARMACIEN exclu — Direction (COMPTABLE) conserve l’accès admin existant.
 */
export const PHARMACY_CATALOG_ROLES: AppUserRole[] = ["ADMIN", "GESTIONNAIRE", "COMPTABLE"]

export function canManagePharmacyCatalog(role: AppUserRole) {
  return PHARMACY_CATALOG_ROLES.includes(role)
}

export function canWriteDossierDocuments(role: AppUserRole) {
  return (
    role === "ADMIN" ||
    role === "MEDECIN" ||
    role === "LABORANTIN" ||
    role === "COMPTABLE"
  )
}

export function getDefaultRoute(role: AppUserRole) {
  switch (role) {
    case "RECEPTIONNISTE":
      return "/reception";
    case "MEDECIN":
      return "/consultation";
    case "COMPTABLE":
      return "/reception";
    case "SOIGNANT":
      return "/bloc-salles/tableau-de-bord";
    case "PHARMACIEN":
      return "/pharmacie/tableau-de-bord";
    case "LOGISTIQUE":
      return "/logistique/tableau-de-bord";
    case "LABORANTIN":
      return "/laboratoire";
    case "GESTIONNAIRE":
      return "/dashboard";
    default:
      return "/dashboard";
  }
}
