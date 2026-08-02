import type { Component } from 'vue'
import {
  Stethoscope,
  LayoutDashboard,
  Wallet,
  BedDouble,
  PillBottle,
  FileText,
  Settings,
  Users,
  FlaskConical,
  UserRound,
  UserCheck,
  ClipboardList,
  CheckCircle2,
  Clock,
  Receipt,
  Scissors,
  FolderOpen,
  Banknote,
  Coins,
  ShoppingCart,
  Tags,
  Package,
  History,
  BarChart3,
  BellRing,
  Building2,
  Warehouse,
  TrendingUp,
  ListChecks,
} from '@lucide/vue'
import type { AppUserRole } from './roles'
import { canAccessModule, canManageLabStock, canManagePharmacyCatalog } from './roles'
import {
  EXAM_CATALOG_KIND_CONFIG,
  findExamCatalogKindFromPath,
  isExamCatalogKindPath,
  examCatalogKindRoute,
} from './exam-catalog-kinds'

export type NavChildItem = {
  to?: string
  label: string
  icon: Component
  module: string
  description?: string
  badgeKey?: 'depenses' | 'salaires' | 'caisse'
  /** Catégories / fournisseurs pharmacie — admin & gestionnaire uniquement */
  pharmacyCatalog?: boolean
  /** Stock laboratoire — gestionnaire & Direction uniquement */
  labStock?: boolean
  children?: NavChildItem[]
}

export type NavItem = {
  to?: string
  label: string
  icon: Component
  module: string
  description?: string
  primary?: boolean
  badgeKey?: 'depenses' | 'salaires' | 'caisse'
  /** Catégories / fournisseurs pharmacie — admin & gestionnaire uniquement */
  pharmacyCatalog?: boolean
  labStock?: boolean
  children?: NavChildItem[]
}

export function hasNavChildren(item: NavItem): item is NavItem & { children: NavChildItem[] } {
  return Boolean(item.children?.length)
}

export function hasNavChildChildren(
  child: NavChildItem,
): child is NavChildItem & { children: NavChildItem[] } {
  return Boolean(child.children?.length)
}

export type NavSection = {
  label?: string
  items: NavItem[]
  /** Ancre la section en bas de la barre latérale (ex. Paramètres). */
  pinnedBottom?: boolean
}

export type NavConfig = {
  sidebarTitle: string
  sections: NavSection[]
}

const pharmacyNavChildren: NavChildItem[] = [
  {
    to: '/pharmacie/caisse',
    label: 'Caisse',
    icon: ShoppingCart,
    module: 'pharmacie',
    description: 'Catalogue, panier et vente au comptoir',
  },
  {
    to: '/pharmacie/categories',
    label: 'Catégories',
    icon: Tags,
    module: 'pharmacie',
    pharmacyCatalog: true,
    description: 'Organisation du catalogue',
  },
  {
    to: '/pharmacie/produits',
    label: 'Produits',
    icon: Package,
    module: 'pharmacie',
    description: 'Prix, stock et références',
  },
  {
    to: '/pharmacie/ventes',
    label: 'Ventes',
    icon: History,
    module: 'pharmacie',
    description: 'Historique des ventes',
  },
  {
    to: '/pharmacie/rapports',
    label: 'Rapports',
    icon: BarChart3,
    module: 'pharmacie',
    description: 'Synthèse et statistiques',
  },
  {
    to: '/pharmacie/alertes',
    label: 'Alertes',
    icon: BellRing,
    module: 'pharmacie',
    description: 'Stocks bas et péremption',
  },
  {
    to: '/pharmacie/fournisseurs',
    label: 'Fournisseurs',
    icon: Building2,
    module: 'pharmacie',
    pharmacyCatalog: true,
    description: 'Contacts fournisseurs',
  },
]

const logisticsNavChildren: NavChildItem[] = [
  {
    to: '/logistique/articles',
    label: 'Articles',
    icon: Package,
    module: 'logistique',
    description: 'Catalogue des consommables et matériel',
  },
  {
    to: '/logistique/categories',
    label: 'Catégories',
    icon: Tags,
    module: 'logistique',
    description: 'Classement du stock',
  },
  {
    to: '/logistique/fournisseurs',
    label: 'Fournisseurs',
    icon: Building2,
    module: 'logistique',
    description: 'Partenaires d’approvisionnement',
  },
  {
    to: '/logistique/alertes',
    label: 'Alertes',
    icon: BellRing,
    module: 'logistique',
    description: 'Stocks bas et péremption',
  },
  {
    to: '/logistique/rapports',
    label: 'Rapports',
    icon: BarChart3,
    module: 'logistique',
    description: 'Valeur du stock et statistiques',
  },
]

const laboratoireNavChildren: NavChildItem[] = [
  {
    to: '/laboratoire',
    label: 'Analyses en attente',
    icon: FlaskConical,
    module: 'laboratoire',
    description: "File d'attente des analyses",
  },
  {
    to: '/laboratoire/termines',
    label: 'Examens terminés',
    icon: CheckCircle2,
    module: 'laboratoire',
    description: 'Patients dont les analyses sont clôturées',
  },
  {
    to: '/laboratoire/formulaires',
    label: 'Formulaires de résultats',
    icon: ClipboardList,
    module: 'laboratoire',
    description: 'Créer et modifier les formulaires de résultats',
  },
  {
    to: '/laboratoire/stock',
    label: 'Stock laboratoire',
    icon: Package,
    module: 'laboratoire',
    description: 'Réactifs et consommables — gestionnaire & direction',
    labStock: true,
  },
]

const logistiqueNav: NavSection[] = [
  {
    items: [
      {
        to: '/logistique/tableau-de-bord',
        label: 'Tableau de bord',
        icon: LayoutDashboard,
        module: 'logistique',
        primary: true,
      },
      ...logisticsNavChildren.map((item) => ({ ...item })),
    ],
  },
]

const examensPaiementsNavChildren: NavChildItem[] = [
  {
    to: '/reception/en-attente-paiement',
    label: 'En attente de paiement',
    icon: Clock,
    module: 'reception',
  },
  {
    to: '/reception/examens-payes',
    label: 'Examens payés',
    icon: CheckCircle2,
    module: 'reception',
  },
  {
    to: '/reception/examens-payes/reclamations',
    label: 'Réclamations',
    icon: ClipboardList,
    module: 'reception',
  },
]

const receptionNav: NavSection[] = [
  {
    items: [
      {
        to: '/reception',
        label: 'Enregistrement',
        icon: UserRound,
        module: 'reception',
        primary: true,
      },
      {
        label: 'Patients',
        icon: Users,
        module: 'reception',
        children: [
          {
            to: '/reception/patient-externe',
            label: 'Patient externe',
            icon: FlaskConical,
            module: 'reception',
            description: 'Examens sans consultation',
          },
          {
            to: '/reception/patient-personnel',
            label: 'Personnel',
            icon: UserCheck,
            module: 'reception',
            description: 'Parcours gratuit — recommandé par le personnel',
          },
        ],
      },
      {
        label: 'Examens & paiements',
        icon: Wallet,
        module: 'reception',
        children: examensPaiementsNavChildren.map((item) => ({ ...item })),
      },
      {
        to: '/reception/comptabilite',
        label: 'Encaissements clinique',
        icon: Wallet,
        module: 'reception',
        description: 'Consultations, examens, chirurgie et hospitalisation',
      },
    ],
  },
]

const medecinNav: NavSection[] = [
  {
    items: [
      {
        to: '/consultation',
        label: 'Consultation',
        icon: Stethoscope,
        module: 'consultation',
        description: 'Patients assignés ou transférés',
        primary: true,
      },
      {
        to: '/medecin/deja-consulte',
        label: 'Déjà consulté',
        icon: CheckCircle2,
        module: 'consultation',
        description: 'Patients déjà vus',
      },
      {
        to: '/medecin/labs-attente',
        label: 'En attente de labos',
        icon: FlaskConical,
        module: 'consultation',
        description: 'Analyses en cours',
      },
      {
        to: '/medecin/labs-resultats',
        label: 'Résultats de labos',
        icon: ClipboardList,
        module: 'consultation',
        description: 'Résultats disponibles',
      },
      {
        to: '/medecin/operations',
        label: 'Mes opérations',
        icon: Scissors,
        module: 'consultation',
        description: 'Suivi et règlement de votre part',
      },
      {
        to: '/medecin/nomenclature',
        label: 'Ma nomenclature',
        icon: ListChecks,
        module: 'consultation',
        description: 'Examens et tarifs de votre service',
      },
      {
        to: '/dossier-patient',
        label: 'Dossiers patients',
        icon: FolderOpen,
        module: 'dossier-patient',
        description: 'Vos patients — suivi et historique',
      },
    ],
  },
]

/**
 * Menu Direction d’origine (avant fusion admin) — conservé à l’identique.
 * Employés, utilisateurs, salles, types d’examen, etc.
 */
const directionOperationalNav: NavSection[] = [
  {
    items: [
      {
        to: '/dashboard',
        label: 'Tableau de board',
        icon: LayoutDashboard,
        module: 'dashboard',
        description: 'Vue d’ensemble, finances, caisses et supervision',
      },
      {
        to: '/reception',
        label: 'Enregistrement',
        icon: UserRound,
        module: 'reception',
        primary: true,
      },
      {
        label: 'Patients',
        icon: Users,
        module: 'reception',
        children: [
          {
            to: '/reception/patient-externe',
            label: 'Patient externe',
            icon: FlaskConical,
            module: 'reception',
          },
          {
            to: '/reception/patient-personnel',
            label: 'Personnel',
            icon: UserCheck,
            module: 'reception',
          },
        ],
      },
      {
        to: '/admin/depenses',
        label: 'Gestion des dépenses',
        icon: Receipt,
        module: 'admin',
        badgeKey: 'depenses',
      },
      {
        label: 'Examens & paiements',
        icon: Wallet,
        module: 'reception',
        children: examensPaiementsNavChildren.map((item) => ({ ...item })),
      },
      {
        label: 'Comptabilité',
        icon: Receipt,
        module: 'comptabilite',
        children: [
          {
            to: '/comptabilite/tableau-de-bord',
            label: 'Encaissements',
            icon: Banknote,
            module: 'comptabilite',
            description: "Recettes et files d'attente",
          },
          {
            to: '/reception/comptabilite',
            label: 'Encaissements clinique',
            icon: Wallet,
            module: 'reception',
            description: 'Consultations, examens, chirurgie et hospitalisation',
          },
          {
            to: '/admin/salaires',
            label: 'Salaires & paie',
            icon: Coins,
            module: 'admin',
            badgeKey: 'salaires',
          },
          {
            to: '/comptabilite/journal-encaissements',
            label: 'Journal encaissements',
            icon: FileText,
            module: 'comptabilite',
          },
          {
            to: '/comptabilite/compte-rendu-caisse',
            label: 'Compte rendu caisse',
            icon: Banknote,
            module: 'comptabilite',
            description: 'Rapprochement des créneaux matin, soir et nuit',
          },
          {
            to: '/factures',
            label: 'Factures',
            icon: FileText,
            module: 'factures',
          },
        ],
      },
      {
        label: 'Suivi hospitalier',
        icon: BedDouble,
        module: 'reception',
        children: [
          {
            to: '/reception/operations-attente',
            label: 'Opérations en attente',
            icon: Clock,
            module: 'reception',
          },
          {
            to: '/reception/operations-effectuees',
            label: 'Opérations effectuées',
            icon: CheckCircle2,
            module: 'reception',
          },
          {
            to: '/hospitalisation',
            label: 'Hospitalisation',
            icon: BedDouble,
            module: 'hospitalisation',
          },
        ],
      },
    ],
  },
]

/** Sous-menus Paramètres partagés (clinique). */
const clinicParametresChildren = [
  {
    to: '/comptabilite/types-examen/operation',
    label: 'Types opérations',
    icon: Scissors,
    module: 'comptabilite',
    description: 'Types d’opération, tarifs et parts médecins',
  },
  {
    to: '/comptabilite/types-examen/examen',
    label: "Types d'examen",
    icon: FlaskConical,
    module: 'comptabilite',
  },
  {
    to: '/comptabilite/parametres/salles',
    label: 'Salles',
    icon: BedDouble,
    module: 'comptabilite',
  },
] as const

/** Paramètres Clinique — identiques pour Direction et Gestionnaire. */
const parametresChildren = [
  ...clinicParametresChildren,
  {
    to: '/admin/employes',
    label: 'Employés',
    icon: UserRound,
    module: 'utilisateurs',
  },
  {
    to: '/admin/services',
    label: 'Services',
    icon: Building2,
    module: 'utilisateurs',
  },
  {
    to: '/admin/utilisateurs',
    label: 'Utilisateurs',
    icon: Users,
    module: 'user-accounts',
  },
]

/** Modules admin ajoutés à la Direction (sans dupliquer le menu d’origine). */
const directionAdminNav: NavSection[] = [
  {
    label: 'Clinique',
    items: [
      {
        label: 'Supervision',
        icon: Stethoscope,
        module: 'consultation',
        description: 'Lecture seule — activité du jour',
        children: [
          {
            to: '/consultation',
            label: 'File de consultation',
            icon: Stethoscope,
            module: 'consultation',
          },
          {
            to: '/dossier-patient',
            label: 'Dossiers patients',
            icon: FolderOpen,
            module: 'dossier-patient',
          },
          {
            to: '/hospitalisation',
            label: 'Hospitalisation',
            icon: BedDouble,
            module: 'hospitalisation',
          },
          {
            to: '/bloc-salles',
            label: 'Bloc & salles',
            icon: Scissors,
            module: 'bloc-salles',
          },
        ],
      },
      {
        label: 'Pharmacie',
        icon: PillBottle,
        module: 'pharmacie',
        children: pharmacyNavChildren,
      },
      {
        label: 'Logistique',
        icon: Warehouse,
        module: 'logistique',
        children: logisticsNavChildren,
      },
      {
        label: 'Laboratoire',
        icon: FlaskConical,
        module: 'laboratoire',
        children: laboratoireNavChildren,
      },
      {
        label: 'Paramètres',
        icon: Settings,
        module: 'admin',
        children: [...parametresChildren],
      },
    ],
  },
]

/** Trésorerie gestionnaire — partagée avec Direction. */
const directionTresorerieNav: NavSection[] = [
  {
    label: 'Trésorerie',
    items: [
      {
        to: '/gestionnaire/caisse',
        label: 'Caisse & décaissement',
        icon: Banknote,
        module: 'gestionnaire',
        badgeKey: 'caisse',
      },
      {
        to: '/gestionnaire/livre-journal',
        label: 'Livre journal',
        icon: FileText,
        module: 'gestionnaire',
      },
      {
        to: '/gestionnaire/finances',
        label: 'Finances',
        icon: TrendingUp,
        module: 'gestionnaire',
      },
    ],
  },
]

/** Direction & Gestionnaire = opérationnel + trésorerie + modules admin. */
const directionNav: NavSection[] = [
  ...directionOperationalNav,
  ...directionTresorerieNav,
  ...directionAdminNav,
]

const soignantNav: NavSection[] = [
  {
    items: [
      { to: '/bloc-salles/tableau-de-bord', label: 'Tableau de bord', icon: LayoutDashboard, module: 'bloc-salles', primary: true },
      { to: '/bloc-salles', label: 'Bloc & Salles', icon: BedDouble, module: 'bloc-salles' },
    ],
  },
]

const pharmacienNav: NavSection[] = [
  {
    items: [
      {
        to: '/pharmacie/tableau-de-bord',
        label: 'Tableau de bord',
        icon: LayoutDashboard,
        module: 'pharmacie',
        primary: true,
      },
      ...pharmacyNavChildren.map((item) => ({ ...item })),
    ],
  },
]

const laborantinNav: NavSection[] = [
  {
    items: [
      {
        to: '/laboratoire',
        label: 'Analyses en attente',
        icon: FlaskConical,
        module: 'laboratoire',
        description: 'File d\'attente des analyses',
        primary: true,
      },
      ...laboratoireNavChildren
        .filter((item) => item.to !== '/laboratoire')
        .map((item) => ({ ...item })),
    ],
  },
]

const NAV_BY_ROLE: Partial<Record<AppUserRole, NavSection[]>> = {
  ADMIN: directionNav,
  /** Même menu que Direction — droits et vues unifiés. */
  GESTIONNAIRE: directionNav,
  RECEPTIONNISTE: receptionNav,
  MEDECIN: medecinNav,
  COMPTABLE: directionNav,
  SOIGNANT: soignantNav,
  PHARMACIEN: pharmacienNav,
  LABORANTIN: laborantinNav,
  LOGISTIQUE: logistiqueNav,
}

const SIDEBAR_TITLES: Record<AppUserRole, string> = {
  ADMIN: 'Direction',
  GESTIONNAIRE: 'Direction',
  RECEPTIONNISTE: 'Réception',
  MEDECIN: 'Espace médecin',
  COMPTABLE: 'Direction',
  SOIGNANT: 'Soins',
  PHARMACIEN: 'Pharmacie',
  LABORANTIN: 'Laboratoire',
  LOGISTIQUE: 'Logistique',
}

function filterNavChild(child: NavChildItem, role: AppUserRole): NavChildItem | null {
  if (hasNavChildChildren(child)) {
    const children = child.children
      .map((nested) => filterNavChild(nested, role))
      .filter((nested): nested is NavChildItem => nested !== null)
    if (!children.length) return null
    if (child.labStock) {
      if (!canManageLabStock(role)) return null
      return { ...child, children }
    }
    if (child.pharmacyCatalog && !canManagePharmacyCatalog(role)) return null
    if (!canAccessModule(role, child.module)) return null
    return { ...child, children }
  }
  if (!child.to) return null
  if (child.labStock) {
    return canManageLabStock(role) ? child : null
  }
  if (child.pharmacyCatalog && !canManagePharmacyCatalog(role)) return null
  if (!canAccessModule(role, child.module)) return null
  return child
}

function filterNavItem(item: NavItem, role: AppUserRole): NavItem | null {
  if (hasNavChildren(item)) {
    const children = item.children
      .map((child) => filterNavChild(child, role))
      .filter((child): child is NavChildItem => child !== null)
    if (!children.length) return null
    if (item.labStock) {
      if (!canManageLabStock(role)) return null
      return { ...item, children }
    }
    if (item.pharmacyCatalog && !canManagePharmacyCatalog(role)) return null
    if (!canAccessModule(role, item.module)) return null
    return { ...item, children }
  }
  if (!item.to) return null
  if (item.labStock) {
    return canManageLabStock(role) ? item : null
  }
  if (item.pharmacyCatalog && !canManagePharmacyCatalog(role)) return null
  if (!canAccessModule(role, item.module)) return null
  return item
}

function filterSections(sections: NavSection[], role: AppUserRole): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .map((item) => filterNavItem(item, role))
        .filter((item): item is NavItem => item !== null),
    }))
    .filter((section) => section.items.length > 0)
}

export function getNavigation(role: AppUserRole): NavConfig {
  const sections = filterSections(NAV_BY_ROLE[role] ?? [], role)
  return {
    sidebarTitle: SIDEBAR_TITLES[role],
    sections,
  }
}

const allNavItems: NavItem[] = [
  ...directionNav,
  ...receptionNav,
  ...medecinNav,
  ...soignantNav,
  ...pharmacienNav,
  ...laborantinNav,
  ...logistiqueNav,
].flatMap((s) => s.items)

function flattenNavChildLinks(children: NavChildItem[]): NavChildItem[] {
  return children.flatMap((child) => {
    if (hasNavChildChildren(child)) return flattenNavChildLinks(child.children)
    if (child.to) return [child]
    return []
  })
}

const allNavLinks: NavChildItem[] = allNavItems.flatMap((item) => {
  if (hasNavChildren(item)) return flattenNavChildLinks(item.children)
  if (item.to) {
    return [
      {
        to: item.to,
        label: item.label,
        icon: item.icon,
        module: item.module,
        description: item.description,
      },
    ]
  }
  return []
})

function navChildMatchesPath(path: string, child: NavChildItem): boolean {
  if (hasNavChildChildren(child)) {
    return child.children.some((nested) => navChildMatchesPath(path, nested))
  }
  return child.to ? isNavItemActive(path, child.to) : false
}

export function isNavChildGroupActive(path: string, child: NavChildItem): boolean {
  if (!hasNavChildChildren(child)) return false
  return child.children.some((nested) => navChildMatchesPath(path, nested))
}

export function findNavLabel(path: string, role: AppUserRole): string | undefined {
  const examKind = findExamCatalogKindFromPath(path)
  if (examKind) return EXAM_CATALOG_KIND_CONFIG[examKind].label

  function findInChildren(children: NavChildItem[]): string | undefined {
    for (const child of children) {
      if (hasNavChildChildren(child)) {
        const nested = findInChildren(child.children)
        if (nested) return nested
        continue
      }
      if (child.to && isNavItemActive(path, child.to)) return child.label
    }
    return undefined
  }

  for (const section of getNavigation(role).sections) {
    for (const item of section.items) {
      if (item.to && isNavItemActive(path, item.to)) return item.label
      if (hasNavChildren(item)) {
        const match = findInChildren(item.children)
        if (match) return match
      }
    }
  }
  return allNavLinks.find((item) => item.to && isNavItemActive(path, item.to))?.label
}

export function isNavGroupActive(path: string, item: NavItem): boolean {
  if (!hasNavChildren(item)) return false
  return item.children.some((child) => navChildMatchesPath(path, child))
}

export function isNavItemActive(path: string, itemTo: string): boolean {
  if (path === itemTo) return true
  if (itemTo === examCatalogKindRoute('examen') && isExamCatalogKindPath(path)) return true
  if (itemTo === '/dashboard' || itemTo === '/reception') return false
  // Sous-routes dédiées (ex. réclamations) sans activer le parent « Examens payés ».
  if (
    (itemTo === '/reception/examens-payes' || itemTo === '/comptabilite/examens-payes') &&
    path.startsWith(`${itemTo}/`)
  ) {
    return false
  }
  if (itemTo === '/admin/employes' && path.startsWith('/admin/employes/')) {
    return false
  }
  return path.startsWith(`${itemTo}/`)
}
