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
}

function activeBundle(): MessageBundle {
  const locale = (i18n.global.locale.value || 'fr') as AppLocale
  return CATALOGS[locale] ?? CATALOGS.fr
}

/**
 * Traduit un libellé d’interface (FR → langue active).
 * Les données BD / dynamiques ne sont pas dans le dictionnaire : inchangées.
 */
export function translateUi(text: string | null | undefined): string {
  if (text == null) return ''
  const key = text.replace(/\s+/g, ' ').trim()
  if (!key) return text

  const bundle = activeBundle()

  if (bundle.ui?.[key]) return bundle.ui[key]
  if (bundle.nav?.[key]) return bundle.nav[key]

  for (const [code, frLabel] of Object.entries(COMMON_FR)) {
    if (frLabel === key && bundle.common?.[code]) return bundle.common[code]
  }

  return key
}

export function translateRole(role: string): string {
  return activeBundle().roles?.[role] ?? role
}

export function getAppLocale(): AppLocale {
  return (i18n.global.locale.value || 'fr') as AppLocale
}
