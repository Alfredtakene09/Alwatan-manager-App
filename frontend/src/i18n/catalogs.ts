import fr from './locales/fr'

/**
 * Catalogues de traduction chargés à la demande.
 * Seul le français (langue par défaut + fallback) est dans le bundle initial :
 * EN / AR (~450 Ko) ne sont téléchargés que si nécessaires — gros gain sur
 * téléphone lent / Tailscale avant l'affichage de la page de connexion.
 */
export type CatalogLocale = 'fr' | 'en' | 'ar'

export type MessageBundle = {
  common?: Record<string, string>
  ui?: Record<string, string>
  nav?: Record<string, string>
  roles?: Record<string, string>
  [key: string]: unknown
}

export const CATALOGS: Partial<Record<CatalogLocale, MessageBundle>> = { fr }

const LOADERS: Record<Exclude<CatalogLocale, 'fr'>, () => Promise<{ default: MessageBundle }>> = {
  en: () => import('./locales/en'),
  ar: () => import('./locales/ar'),
}

const pending = new Map<CatalogLocale, Promise<MessageBundle>>()
const listeners: Array<(locale: CatalogLocale, bundle: MessageBundle) => void> = []

/** Appelé à chaque catalogue nouvellement chargé (vue-i18n, index normalisés). */
export function onCatalogLoaded(listener: (locale: CatalogLocale, bundle: MessageBundle) => void) {
  listeners.push(listener)
  for (const [locale, bundle] of Object.entries(CATALOGS) as Array<[CatalogLocale, MessageBundle]>) {
    listener(locale, bundle)
  }
}

export function isCatalogLoaded(locale: CatalogLocale): boolean {
  return CATALOGS[locale] != null
}

export function loadCatalog(locale: CatalogLocale): Promise<MessageBundle> {
  const loaded = CATALOGS[locale]
  if (loaded) return Promise.resolve(loaded)
  const inFlight = pending.get(locale)
  if (inFlight) return inFlight
  const promise = LOADERS[locale as Exclude<CatalogLocale, 'fr'>]()
    .then((mod) => {
      CATALOGS[locale] = mod.default
      for (const listener of listeners) listener(locale, mod.default)
      return mod.default
    })
    .finally(() => {
      pending.delete(locale)
    })
  pending.set(locale, promise)
  return promise
}
