import fr from './locales/fr'
import en from './locales/en'
import ar from './locales/ar'
import { i18n, type AppLocale } from './index'

type MessageBundle = {
  common?: Record<string, string>
  ui?: Record<string, string>
  nav?: Record<string, string>
  roles?: Record<string, string>
}

const CATALOGS: Record<AppLocale, MessageBundle> = { fr, en, ar }

/** Clés common (code) → libellé FR source. */
const COMMON_FR: Record<string, string> = {
  logout: 'Déconnexion',
  openMenu: 'Ouvrir le menu',
  closeMenu: 'Fermer le menu',
  navigation: 'Navigation',
  dbConnected: 'PostgreSQL connecté',
  language: 'Langue',
  refresh: 'Actualiser',
  myAccount: 'Mon compte',
  continueConsultation: 'Continuer la consultation',
}

function normalizeKey(text: string): string {
  return text
    .replace(/\u2019/g, "'")
    .replace(/\u2018/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Index ui/nav avec clés normalisées (évite les échecs sur \\n vs espaces). */
const NORMALIZED_UI: Record<AppLocale, Record<string, string>> = {
  fr: {},
  en: {},
  ar: {},
}
const NORMALIZED_NAV: Record<AppLocale, Record<string, string>> = {
  fr: {},
  en: {},
  ar: {},
}

function rebuildNormalizedIndexes() {
  for (const locale of Object.keys(CATALOGS) as AppLocale[]) {
    const bundle = CATALOGS[locale]
    const uiIndex: Record<string, string> = {}
    const navIndex: Record<string, string> = {}
    for (const [raw, value] of Object.entries(bundle.ui ?? {})) {
      uiIndex[normalizeKey(raw)] = value
    }
    for (const [raw, value] of Object.entries(bundle.nav ?? {})) {
      navIndex[normalizeKey(raw)] = value
    }
    NORMALIZED_UI[locale] = uiIndex
    NORMALIZED_NAV[locale] = navIndex
  }
}

rebuildNormalizedIndexes()

function activeLocale(): AppLocale {
  return (i18n.global.locale.value || 'fr') as AppLocale
}

function activeBundle(): MessageBundle {
  return CATALOGS[activeLocale()] ?? CATALOGS.fr
}

/**
 * Traduit un libellé d’interface (FR → langue active).
 * Les données BD / dynamiques ne sont pas dans le dictionnaire : inchangées.
 */
export function translateUi(text: string | null | undefined): string {
  return translateUiLocale(text, activeLocale())
}

/**
 * Libellé d’examen / formulaire labo : en arabe, conserver l’anglais (pas la traduction arabe).
 */
export function translateExamName(text: string | null | undefined): string {
  if (text == null) return ''
  if (activeLocale() === 'ar') {
    return translateUiLocale(text, 'en')
  }
  return translateUi(text)
}

/** Traduction figée vers une locale (ex. tickets thermiques toujours en arabe). */
export function translateUiLocale(
  text: string | null | undefined,
  locale: AppLocale,
): string {
  if (text == null) return ''
  const key = normalizeKey(text)
  if (!key) return text

  const bundle = CATALOGS[locale] ?? CATALOGS.fr
  // Priorité au catalogue vivant (HMR / fichiers locale mis à jour).
  const liveUi = bundle.ui?.[text] ?? bundle.ui?.[key]
  if (liveUi != null) return liveUi
  const liveNav = bundle.nav?.[text] ?? bundle.nav?.[key]
  if (liveNav != null) return liveNav

  const fromUi = NORMALIZED_UI[locale]?.[key]
  if (fromUi != null) return fromUi
  const fromNav = NORMALIZED_NAV[locale]?.[key]
  if (fromNav != null) return fromNav

  for (const [code, frLabel] of Object.entries(COMMON_FR)) {
    if (normalizeKey(frLabel) === key && bundle.common?.[code]) return bundle.common[code]
  }

  return key
}

export function translateRole(role: string): string {
  return activeBundle().roles?.[role] ?? role
}

export function getAppLocale(): AppLocale {
  return activeLocale()
}
