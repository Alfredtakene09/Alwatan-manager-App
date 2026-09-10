/**
 * Groupes de facturation Routine : plusieurs sections DB (saisie / impression)
 * = une seule coche et un seul tarif à la prescription.
 */
import { isNamedLabSectionTitle, type LabFormSection } from './lab-form-panels'

export type RoutineBillingGroupId = 'urine' | 'stool'

export type RoutineBillingGroupDef = {
  id: RoutineBillingGroupId
  /** Libellé panier / prescription (ex. « Urine Analysis »). */
  label: string
  families: string[]
}

function normalizeTitleKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Famille de section (alignée sur le backend lab-panels-seed).
 * Urine Analysis ≈ Urine General ; Disposite ≈ Deposit ; Miscroscopic ≈ Microscopic.
 */
export function classicSectionFamily(section: string | null | undefined): string {
  const raw = (section ?? '').trim().toLowerCase()
  if (!raw) return 'main'
  if (raw.includes('deposit') || raw.includes('disposit') || raw.includes('diposit')) {
    return 'urine-deposit'
  }
  if (raw.includes('urine')) return 'urine-general'
  if (
    raw.includes('microscopic') ||
    raw.includes('miscrocopic') ||
    raw.includes('miscroscopic') ||
    raw.includes('miscro') ||
    raw.includes('micro')
  ) {
    return 'stool-micro'
  }
  if (raw.includes('stool') || raw.includes('selle')) return 'stool-general'
  return raw
}

export const ROUTINE_BILLING_GROUPS: RoutineBillingGroupDef[] = [
  {
    id: 'urine',
    label: 'Urine Analysis',
    families: ['urine-general', 'urine-deposit'],
  },
  {
    id: 'stool',
    label: 'Stool General',
    families: ['stool-general', 'stool-micro'],
  },
]

export function billingGroupForSectionTitle(
  title: string | null | undefined,
): RoutineBillingGroupDef | null {
  if (!isNamedLabSectionTitle(title)) return null
  const family = classicSectionFamily(title)
  return ROUTINE_BILLING_GROUPS.find((group) => group.families.includes(family)) ?? null
}

/** Toutes les sections d’un panel appartenant au même groupe de facturation. */
export function collectSectionsForBillingGroup(
  sections: LabFormSection[],
  group: RoutineBillingGroupDef,
): LabFormSection[] {
  return sections.filter((section) => {
    const family = classicSectionFamily(section.title)
    return group.families.includes(family)
  })
}

/**
 * Section « primaire » du groupe = première section nommée du panel
 * dont la famille appartient au groupe (là où on stocke le tarif).
 */
export function primarySectionTitleForBillingGroup(
  sectionTitles: string[],
  group: RoutineBillingGroupDef,
): string | null {
  for (const title of sectionTitles) {
    if (!isNamedLabSectionTitle(title)) continue
    const family = classicSectionFamily(title)
    if (group.families.includes(family)) return title.trim()
  }
  return null
}

export function isPrimaryBillingSectionTitle(
  title: string | null | undefined,
  allSectionTitles: string[],
): boolean {
  const group = billingGroupForSectionTitle(title)
  if (!group) return true
  const primary = primarySectionTitleForBillingGroup(allSectionTitles, group)
  if (!primary) return true
  return normalizeTitleKey(title ?? '') === normalizeTitleKey(primary)
}

/** Libellés de section qui partagent le même tarif / la même coche. */
export function billingGroupAliasTitles(
  sections: LabFormSection[],
  group: RoutineBillingGroupDef,
): string[] {
  const titles = collectSectionsForBillingGroup(sections, group)
    .map((section) => section.title?.trim())
    .filter((title): title is string => Boolean(title))
  return [...new Set([group.label, ...titles])]
}

export function resolveBillingGroupPriceFcfa(sections: LabFormSection[]): number | undefined {
  const prices = sections
    .map((section) => section.priceFcfa)
    .filter((price): price is number => price != null && Number.isFinite(price) && price > 0)
  if (!prices.length) return undefined
  return prices[0]
}

export function findBillingGroupMatchingFormLabel(
  formLabel: string,
  sectionTitles: string[],
): RoutineBillingGroupDef | null {
  const formKey = normalizeTitleKey(formLabel)
  if (!formKey) return null
  for (const group of ROUTINE_BILLING_GROUPS) {
    if (normalizeTitleKey(group.label) === formKey) return group
    const primary = primarySectionTitleForBillingGroup(sectionTitles, group)
    if (primary && normalizeTitleKey(primary) === formKey) return group
    for (const title of sectionTitles) {
      const matched = billingGroupForSectionTitle(title)
      if (matched?.id === group.id && normalizeTitleKey(title) === formKey) return group
    }
  }
  return null
}
