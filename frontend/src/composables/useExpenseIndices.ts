import { computed, ref } from 'vue'
import {
  fetchExpenseIndices,
  toActiveIndiceOptions,
  type ExpenseIndiceRecord,
} from '@/lib/expense-indices'

export function useExpenseIndices() {
  const items = ref<ExpenseIndiceRecord[]>([])
  const loading = ref(false)

  const activeIndices = computed(() => toActiveIndiceOptions(items.value))

  async function loadIndices() {
    loading.value = true
    try {
      items.value = await fetchExpenseIndices()
    } catch {
      items.value = []
    } finally {
      loading.value = false
    }
  }

  return { items, activeIndices, loading, loadIndices }
}
