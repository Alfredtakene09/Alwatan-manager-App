<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { CircleDollarSign, Wallet } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { useAppI18n } from '@/i18n/useAppI18n'
import { currentMonthKey, todayDateKey } from '@/lib/date-filters'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import UiAlert from '@/components/ui/UiAlert.vue'

type ReceivableItem = {
  key: string
  kind: 'CONSULTATION' | 'OPERATION_SURGEON' | 'OPERATION_ASSISTANT'
  amountFcfa: number
  businessDate: string
  surgeryCaseId?: string
  invoiceId?: string
  label: string
}

type ReceivablePayload = {
  period: 'day' | 'month'
  totals: {
    consultationShareFcfa: number
    surgeryShareFcfa: number
    totalShareFcfa: number
    pendingPayrollFcfa: number
  }
  me?: {
    canAddToSalary: boolean
    hasConsultationQuota: boolean
    items: ReceivableItem[]
  }
  doctors?: Array<{
    id: string
    canAddToSalary?: boolean
    items?: ReceivableItem[]
  }>
}

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { uiText } = useAppI18n()

const periodMode = ref<'day' | 'month'>('month')
const receivable = ref<ReceivablePayload | null>(null)
const loading = ref(false)
const addingToSalary = ref(false)
const loadError = ref('')
const actionMessage = ref('')
const actionType = ref<'success' | 'error'>('success')

const payableValue = computed(() => formatFcfa(receivable.value?.totals.totalShareFcfa ?? 0))

const payableTrend = computed(() => {
  const t = receivable.value?.totals
  if (!t) return ''
  const parts: string[] = []
  if (t.consultationShareFcfa > 0) {
    parts.push(`${uiText('Consult.')} ${formatFcfa(t.consultationShareFcfa)}`)
  }
  if (t.surgeryShareFcfa > 0) {
    parts.push(`${uiText('Opér.')} ${formatFcfa(t.surgeryShareFcfa)}`)
  }
  if (t.pendingPayrollFcfa > 0) {
    parts.push(`${uiText('En paie')} ${formatFcfa(t.pendingPayrollFcfa)}`)
  }
  return parts.join(' · ') || uiText('Rien à percevoir')
})

const canAddToSalary = computed(() => {
  const me = receivable.value?.me ?? receivable.value?.doctors?.[0]
  return Boolean(me?.canAddToSalary && (receivable.value?.totals.totalShareFcfa ?? 0) > 0)
})

const myItems = computed(
  () => receivable.value?.me?.items ?? receivable.value?.doctors?.[0]?.items ?? [],
)

const kindLabel = (kind: ReceivableItem['kind']) => {
  if (kind === 'CONSULTATION') return uiText('Consultation')
  if (kind === 'OPERATION_SURGEON') return uiText('Opération (chirurgien)')
  return uiText('Opération (assistant)')
}

async function loadReceivable() {
  loading.value = true
  loadError.value = ''
  try {
    const params =
      periodMode.value === 'day'
        ? { period: 'day', day: todayDateKey() }
        : { period: 'month', month: currentMonthKey() }
    const { data } = await api.get<ReceivablePayload>('/doctor-shares/receivable', { params })
    receivable.value = data
  } catch {
    loadError.value = uiText('Impossible de charger les parts à percevoir.')
    receivable.value = null
  } finally {
    loading.value = false
  }
}

async function addAllToSalary() {
  if (!canAddToSalary.value || !myItems.value.length) return
  addingToSalary.value = true
  actionMessage.value = ''
  try {
    await api.post('/doctor-shares/request-payroll', {
      items: myItems.value.map((item) => ({
        kind: item.kind,
        amountFcfa: item.amountFcfa,
        businessDate: item.businessDate,
        surgeryCaseId: item.surgeryCaseId,
        invoiceId: item.invoiceId,
      })),
    })
    actionType.value = 'success'
    actionMessage.value = uiText('Parts ajoutées au salaire du mois — le solde repasse à zéro.')
    await loadReceivable()
  } catch (error: unknown) {
    const err = error as { response?: { data?: { error?: string } } }
    actionType.value = 'error'
    actionMessage.value =
      err.response?.data?.error || uiText('Impossible d’ajouter ces parts au salaire.')
  } finally {
    addingToSalary.value = false
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      actionMessage.value = ''
      void loadReceivable()
    }
  },
)

watch(periodMode, () => {
  if (props.open) void loadReceivable()
})

onMounted(() => {
  if (props.open) void loadReceivable()
})
</script>

<template>
  <UiFormModal
    v-if="open"
    title="À percevoir"
    subtitle="Choisissez la période puis consultez vos parts"
    :icon="CircleDollarSign"
    @close="emit('close')"
  >
    <div class="recv-modal" :class="{ 'recv-modal--loading': loading }">
      <UiAlert v-if="loadError" type="error" :message="loadError" />

      <div class="recv-modal__tools">
        <UiSelect v-model="periodMode" :label="uiText('Période')">
          <option value="day">{{ uiText("Aujourd'hui") }}</option>
          <option value="month">{{ uiText('Mois') }}</option>
        </UiSelect>
        <UiButton
          v-if="canAddToSalary"
          type="button"
          size="sm"
          variant="secondary"
          :loading="addingToSalary"
          :icon="Wallet"
          @click="addAllToSalary"
        >
          {{ uiText('Ajouter au salaire') }}
        </UiButton>
      </div>

      <UiStatCard
        mini
        :label="uiText('À percevoir')"
        :value="payableValue"
        :icon="CircleDollarSign"
        variant="amber"
      />
      <p class="recv-modal__detail">{{ payableTrend }}</p>

      <p
        v-if="actionMessage"
        class="recv-modal__action"
        :class="`recv-modal__action--${actionType}`"
      >
        {{ actionMessage }}
      </p>

      <ul v-if="myItems.length" class="recv-modal__list">
        <li v-for="item in myItems" :key="item.key" class="recv-modal__item">
          <div>
            <strong>{{ item.label || kindLabel(item.kind) }}</strong>
            <span>{{ kindLabel(item.kind) }} · {{ item.businessDate }}</span>
          </div>
          <em>{{ formatFcfa(item.amountFcfa) }}</em>
        </li>
      </ul>
      <p v-else-if="!loading && !loadError" class="recv-modal__empty">
        {{ uiText('Aucune part à percevoir pour cette période.') }}
      </p>
    </div>
  </UiFormModal>
</template>

<style scoped>
.recv-modal {
  display: grid;
  gap: 0.85rem;
}

.recv-modal--loading {
  opacity: 0.65;
  pointer-events: none;
}

.recv-modal__tools {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  align-items: flex-end;
  justify-content: space-between;
}

.recv-modal__detail {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.recv-modal__action {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
}

.recv-modal__action--success {
  color: var(--success, #15803d);
}

.recv-modal__action--error {
  color: var(--danger);
}

.recv-modal__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: min(40vh, 18rem);
  overflow: auto;
}

.recv-modal__item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  background: #fffbeb;
  border: 1px solid rgba(217, 119, 6, 0.18);
  font-size: 0.8125rem;
}

.recv-modal__item strong {
  display: block;
  font-size: 0.875rem;
}

.recv-modal__item span {
  display: block;
  margin-top: 0.15rem;
  color: var(--text-muted);
  font-size: 0.75rem;
}

.recv-modal__item em {
  font-style: normal;
  font-weight: 700;
  color: #b45309;
  white-space: nowrap;
}

.recv-modal__empty {
  margin: 0;
  padding: 0.85rem;
  border-radius: 10px;
  background: #f0fdf4;
  color: #166534;
  font-size: 0.875rem;
}
</style>
