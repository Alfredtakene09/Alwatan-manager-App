import { createI18n } from 'vue-i18n'
import fr from './locales/fr'
import en from './locales/en'
import ar from './locales/ar'

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
 * Ne pas mettre dir="rtl" sur <html> : le texte latin non traduit
 * (et certaines polices) se retrouve inversé caractère par caractère.
 * Le RTL est appliqué uniquement sur les zones traduites (sidebar, etc.).
 */
export function applyDocumentLocale(locale: AppLocale) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale === 'ar' ? 'ar' : locale
  document.documentElement.dir = 'ltr'
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
  messages: { fr, en, ar },
})

export function setAppLocale(locale: AppLocale) {
  if (i18n.global.locale.value === locale) {
    applyDocumentLocale(locale)
    return
  }
  i18n.global.locale.value = locale
  applyDocumentLocale(locale)
}
