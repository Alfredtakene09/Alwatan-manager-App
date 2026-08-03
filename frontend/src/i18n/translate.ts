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

for (const locale of Object.keys(CATALOGS) as AppLocale[]) {
  const bundle = CATALOGS[locale]
  for (const [raw, value] of Object.entries(bundle.ui ?? {})) {
    NORMALIZED_UI[locale][normalizeKey(raw)] = value
  }
  for (const [raw, value] of Object.entries(bundle.nav ?? {})) {
    NORMALIZED_NAV[locale][normalizeKey(raw)] = value
  }
}

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
  if (text == null) return ''
  const key = normalizeKey(text)
  if (!key) return text

  const locale = activeLocale()
  const fromUi = NORMALIZED_UI[locale]?.[key]
  if (fromUi != null) return fromUi
  const fromNav = NORMALIZED_NAV[locale]?.[key]
  if (fromNav != null) return fromNav

  // Repli live (évite un cache NORMALIZED_* obsolète après HMR / mise à jour partielle)
  const bundle = activeBundle()
  const liveUi = bundle.ui?.[key] ?? bundle.ui?.[text]
  if (liveUi != null) return liveUi
  const liveNav = bundle.nav?.[key] ?? bundle.nav?.[text]
  if (liveNav != null) return liveNav

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
