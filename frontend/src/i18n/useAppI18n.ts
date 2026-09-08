import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppUserRole } from '@/lib/roles'
import { getAppLocale, translateClinicService, translateExamName, translateRole, translateUi } from './translate'
import {
  formatAppDate,
  formatAppDateTime,
  formatAppNumber,
  formatAppTime,
  intlLocaleFor,
} from './locale-format'

export function useAppI18n() {
  const { t, locale } = useI18n()

  /** Force la dépendance réactive à la locale (re-render au changement). */
  const localeCode = computed(() => locale.value)

  function uiText(label: string) {
    void localeCode.value
    return translateUi(label)
  }

  function examNameText(label: string) {
    void localeCode.value
    return translateExamName(label)
  }

  function clinicServiceText(name: string) {
    void localeCode.value
    return translateClinicService(name)
  }

  function navLabel(label: string) {
    void localeCode.value
    return translateUi(label)
  }

  function roleLabel(role: AppUserRole) {
    void localeCode.value
    return translateRole(role)
  }

  function dateText(
    value: string | number | Date | null | undefined,
    options?: Intl.DateTimeFormatOptions,
  ) {
    void localeCode.value
    return formatAppDate(value, options)
  }

  function dateTimeText(
    value: string | number | Date | null | undefined,
    options?: Intl.DateTimeFormatOptions,
  ) {
    void localeCode.value
    return formatAppDateTime(value, options)
  }

  function timeText(
    value: string | number | Date | null | undefined,
    options?: Intl.DateTimeFormatOptions,
  ) {
    void localeCode.value
    return formatAppTime(value, options)
  }

  function numberText(value: number | null | undefined, options?: Intl.NumberFormatOptions) {
    void localeCode.value
    return formatAppNumber(value, options)
  }

  return {
    t,
    locale,
    localeCode,
    isArabic: computed(() => getAppLocale() === 'ar'),
    isRtl: computed(() => getAppLocale() === 'ar'),
    intlLocale: computed(() => intlLocaleFor()),
    uiText,
    examNameText,
    clinicServiceText,
    navLabel,
    roleLabel,
    dateText,
    dateTimeText,
    timeText,
    numberText,
  }
}
