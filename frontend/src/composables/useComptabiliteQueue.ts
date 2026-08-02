import { reactive, ref } from 'vue'
import api from '@/api/client'

export function useComptabiliteQueue() {
  const data = ref<any>(null)
  const message = ref('')
  const messageType = ref<'success' | 'error'>('success')
  const loading = ref(false)
  const surgeryForm = reactive<Record<string, { interventionTypeId: string; surgeonId: string }>>({})
  const roomSelections = reactive<Record<string, string>>({})
  const deposits = reactive<Record<string, string>>({})
  const dischargeDates = reactive<Record<string, string>>({})

  async function load(opts?: { silent?: boolean }) {
    if (!opts?.silent) loading.value = true
    try {
      const { data: res } = await api.get('/comptabilite')
      data.value = res
      for (const s of res.surgeries) {
        surgeryForm[s.id] = { interventionTypeId: s.interventionTypeId, surgeonId: s.surgeonId }
      }
    } finally {
      if (!opts?.silent) loading.value = false
    }
  }

  return {
    data,
    message,
    messageType,
    loading,
    surgeryForm,
    roomSelections,
    deposits,
    dischargeDates,
    load,
  }
}
