import { createI18n } from 'vue-i18n'
import { CATALOGS, loadCatalog, onCatalogLoaded } from './catalogs'

export const LOCALES = [
  { code: 'fr', codeLabel: 'FR', name: 'Français' },
  { code: 'ar', codeLabel: 'AR', name: 'العربية' },
  { code: 'en', codeLabel: 'ANG', name: 'English' },
] as const

export type AppLocale = (typeof LOCALES)[number]['code']

const STORAGE_KEY = 'alwatan-locale'

export function isAppLocale(value: string): value is AppLocale {
  return LOCALES.some((locale) => locale.code === value)
}

export function getStoredLocale(): AppLocale {
  if (typeof localStorage === 'undefined') return 'fr'
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored && isAppLocale(stored) ? stored : 'fr'
}

/**
 * Applique la langue et la direction du document.
 * Arabe → dir=rtl (layout logique) ; le sélecteur de langue reste LTR.
 */
export function applyDocumentLocale(locale: AppLocale) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale === 'ar' ? 'ar' : locale
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
  document.documentElement.dataset.locale = locale
  document.documentElement.classList.toggle('locale-ar', locale === 'ar')
  document.documentElement.classList.toggle('locale-en', locale === 'en')
  document.documentElement.classList.toggle('locale-fr', locale === 'fr')
  localStorage.setItem(STORAGE_KEY, locale)
}

const initialLocale = getStoredLocale()
applyDocumentLocale(initialLocale)

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: 'fr',
  messages: { fr: CATALOGS.fr! } as Record<string, any>,
})

onCatalogLoaded((locale, bundle) => {
  if (locale !== 'fr') i18n.global.setLocaleMessage(locale, bundle as any)
})

/** Charge le catalogue de la langue enregistrée (avant le montage de l’app). */
export async function ensureInitialLocale(): Promise<void> {
  if (initialLocale === 'fr') return
  try {
    await loadCatalog(initialLocale)
  } catch {
    // Réseau coupé : rester en français plutôt que bloquer l’écran.
    i18n.global.locale.value = 'fr'
    applyDocumentLocale('fr')
  }
}

/** Précharge EN / AR en arrière-plan (tickets bilingues FR + AR, changement de langue instantané). */
export function preloadAllLocales() {
  for (const { code } of LOCALES) void loadCatalog(code).catch(() => {})
}

export async function setAppLocale(locale: AppLocale) {
  await loadCatalog(locale)
  if (i18n.global.locale.value === locale) {
    applyDocumentLocale(locale)
    return
  }
  i18n.global.locale.value = locale
  applyDocumentLocale(locale)
}
