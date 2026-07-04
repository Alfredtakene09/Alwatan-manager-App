import type { Component } from 'vue'
import { FlaskConical, Scissors, Smile, ScanLine, Waves } from '@lucide/vue'

export type ExamCatalogKindSlug = 'examen' | 'odonto' | 'radio' | 'echo'

export type ExamCatalogKindConfig = {
  slug: ExamCatalogKindSlug | 'operation'
  label: string
  title: string
  subtitle: string
  icon: Component
  iconVariant: 'blue' | 'teal' | 'violet' | 'amber' | 'rose'
}

export const EXAM_CATALOG_KIND_CONFIG: Record<ExamCatalogKindSlug, ExamCatalogKindConfig> = {
  examen: {
    slug: 'examen',
    label: 'Labo',
    title: 'Labo',
    subtitle: 'Nomenclature et tarifs des analyses de laboratoire',
    icon: FlaskConical,
    iconVariant: 'teal',
  },
  odonto: {
    slug: 'odonto',
    label: 'Odonto',
    title: 'Odonto',
    subtitle: 'Actes et tarifs dentaires',
    icon: Smile,
    iconVariant: 'violet',
  },
  radio: {
    slug: 'radio',
    label: 'Radio',
    title: 'Radio',
    subtitle: 'Examens d\'imagerie radiologique',
    icon: ScanLine,
    iconVariant: 'amber',
  },
  echo: {
    slug: 'echo',
    label: 'Écho',
    title: 'Écho',
    subtitle: 'Examens échographiques et cardiologiques',
    icon: Waves,
    iconVariant: 'blue',
  },
}

export const EXAM_CATALOG_ADD_LABELS: Record<ExamCatalogKindSlug, string> = {
  examen: 'Ajout Examen',
  odonto: 'Ajout Odonto',
  radio: 'Ajout Radio',
  echo: 'Ajout Écho',
}

export const EXAM_CATALOG_FORM_PLACEHOLDERS: Record<
  ExamCatalogKindSlug,
  { code: string; label: string; category: string }
> = {
  examen: {
    code: 'nfs',
    label: 'Numération formule sanguine',
    category: 'Hématologie',
  },
  odonto: {
    code: 'detartrage',
    label: 'Détartrage',
    category: 'Soins',
  },
  radio: {
    code: 'radiographie',
    label: 'Radiographie thorax',
    category: 'Imagerie',
  },
  echo: {
    code: 'echographie',
    label: 'Échographie abdominale',
    category: 'Imagerie',
  },
}

export const OPERATION_KIND_CONFIG: ExamCatalogKindConfig = {
  slug: 'operation',
  label: 'Opérations',
  title: 'Opérations',
  subtitle: 'Nomenclature chirurgicale, tarifs et part médecin',
  icon: Scissors,
  iconVariant: 'rose',
}

export const EXAM_CATALOG_KIND_SLUGS: ExamCatalogKindSlug[] = ['examen', 'radio', 'echo', 'odonto']

export const EXAM_CATALOG_KIND_ROUTE_PREFIX = '/comptabilite/types-examen'

export function examCatalogKindRoute(slug: ExamCatalogKindSlug) {
  return `${EXAM_CATALOG_KIND_ROUTE_PREFIX}/${slug}`
}

export function isExamCatalogKindPath(path: string) {
  return EXAM_CATALOG_KIND_SLUGS.some((slug) => path === examCatalogKindRoute(slug))
}

export function isExamCatalogKindSlug(value: string): value is ExamCatalogKindSlug {
  return value in EXAM_CATALOG_KIND_CONFIG
}

export function findExamCatalogKindFromPath(path: string): ExamCatalogKindSlug | null {
  for (const slug of EXAM_CATALOG_KIND_SLUGS) {
    if (path === examCatalogKindRoute(slug)) return slug
  }
  return null
}
