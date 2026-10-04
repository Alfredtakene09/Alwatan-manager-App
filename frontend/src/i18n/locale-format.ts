import type { AppLocale } from '@/i18n'
import { getAppLocale } from '@/i18n/translate'

/** Locales Intl alignées sur les langues de l’app (Tchad pour l’arabe). */
export function intlLocaleFor(locale?: AppLocale): string {
  const code = locale ?? getAppLocale()
  if (code === 'ar') return 'ar-TD'
  if (code === 'en') return 'en-GB'
  return 'fr-FR'
}

export function formatAppDate(
  value: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  locale?: AppLocale,
): string {
  if (value == null || value === '') return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(intlLocaleFor(locale), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...options,
  })
}

export function formatAppDateTime(
  value: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  locale?: AppLocale,
): string {
  if (value == null || value === '') return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(intlLocaleFor(locale), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  })
}

export function formatAppTime(
  value: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  locale?: AppLocale,
): string {
  if (value == null || value === '') return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString(intlLocaleFor(locale), {
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  })
}

export function formatAppNumber(
  value: number | null | undefined,
  options?: Intl.NumberFormatOptions,
  locale?: AppLocale,
): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat(intlLocaleFor(locale), options).format(value)
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

/** Date de reçu : toujours jj-mm-AAAA, chiffres latins, quelle que soit la langue de session. */
export function formatReceiptDateFr(value: Date): string {
  return `${pad2(value.getDate())}-${pad2(value.getMonth() + 1)}-${value.getFullYear()}`
}

/** Heure de reçu : toujours HH:MM (ou HH:MM:SS), chiffres latins. */
export function formatReceiptTimeFr(value: Date, withSeconds = false): string {
  const hm = `${pad2(value.getHours())}:${pad2(value.getMinutes())}`
  return withSeconds ? `${hm}:${pad2(value.getSeconds())}` : hm
}

/** Date et heure de reçu : `jj-mm-AAAA HH:MM`. */
export function formatReceiptDateTimeFr(value: string | number | Date | null | undefined): string {
  if (value == null || value === '') return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${formatReceiptDateFr(date)} ${formatReceiptTimeFr(date)}`
}
