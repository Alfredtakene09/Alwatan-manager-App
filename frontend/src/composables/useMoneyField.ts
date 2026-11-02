import { computed, ref } from 'vue'
import { fcfaToInputText, inputTextToFcfa, isRialCurrency } from '../lib/format-fcfa'

/**
 * Champ de montant : le formulaire garde des FCFA, l'utilisateur voit et saisit
 * dans la devise de la session (rial en arabe). Pendant la saisie, le texte tapé
 * est conservé tel quel (sinon « 12. » perdrait son point à chaque frappe).
 */
export function useMoneyField(
  enabled: () => boolean,
  modelValue: () => string | number | null | undefined,
  emitValue: (value: string) => void,
) {
  const draft = ref<string | null>(null)
  const converting = computed(() => enabled() && isRialCurrency())

  const shownValue = computed(() => {
    if (!converting.value) return modelValue() ?? ''
    return draft.value ?? fcfaToInputText(modelValue())
  })

  function onMoneyInput(text: string) {
    if (!converting.value) {
      emitValue(text)
      return
    }
    draft.value = text
    emitValue(inputTextToFcfa(text))
  }

  function onMoneyBlur() {
    draft.value = null
  }

  return { shownValue, onMoneyInput, onMoneyBlur }
}
