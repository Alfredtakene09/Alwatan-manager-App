import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppUserRole } from '@/lib/roles'
import { getAppLocale, translateRole, translateUi } from './translate'

export function useAppI18n() {
  const { t, locale } = useI18n()

  /** Force la dépendance réactive à la locale (re-render au changement). */
  const localeCode = computed(() => locale.value)

  function uiText(label: string) {
    void localeCode.value
    return translateUi(label)
  }

  function navLabel(label: string) {
    void localeCode.value
    return translateUi(label)
  }

  function roleLabel(role: AppUserRole) {
    void localeCode.value
    return translateRole(role)
  }

  return {
    t,
    locale,
    localeCode,
    isArabic: computed(() => getAppLocale() === 'ar'),
    uiText,
    navLabel,
    roleLabel,
  }
}
