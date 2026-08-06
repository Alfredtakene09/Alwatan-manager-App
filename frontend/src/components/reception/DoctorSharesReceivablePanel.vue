<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { CircleDollarSign, Wallet } from '@lucide/vue'
import api from '@/api/client'
import { fullName, formatFcfa } from '@/lib/roles'
import {
  translateDashboardLabel,
  translateTemplate,
} from '@/lib/dashboard-i18n'
import { useAppI18n } from '@/i18n/useAppI18n'
import { currentMonthKey, todayDateKey } from '@/lib/date-filters'
import { showAppModal } from '@/composables/useAppModal'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'

type DoctorShareItem = {
  key: string
  kind: 'CONSULTATION' | 'OPERATION_SURGEON' | 'OPERATION_ASSISTANT'
  amountFcfa: number
  businessDate: string
  surgeryCaseId?: string
  invoiceId?: string
  label: string
}

type DoctorShareDoctor = {
  id: string
  firstName: string
  lastName: string
  hasConsultationQuota?: boolean
  canAddToSalary?: boolean
  consultationShareFcfa: number
  surgeryShareFcfa: number
  totalShareFcfa: number
  items?: DoctorShareItem[]
}

type DoctorSharesOverview = {
  totals: {
    consultationShareFcfa: number
    surgeryShareFcfa: number
    totalShareFcfa: number
    pendingPayrollFcfa: number
  }
  doctors: DoctorShareDoctor[]
}

const { localeCode } = useAppI18n()

const doctorShares = ref<DoctorSharesOverview | null>(null)
const doctorSharePeriod = ref<'day' | 'month'>('month')
const doctorShareDoctorId = ref('')
const doctorShareOptions = ref<Array<{ id: string; firstName: string; lastName: string }>>([])
const settlingDoctorShares = ref(false)
const settleSharesMessage = ref('')
const settleSharesType = ref<'success' | 'error'>('success')
const loading = ref(false)
const loadError = ref('')

const doctorSharesCardValue = computed(() => {
  const totals = doctorShares.value?.totals
  if (!totals) return formatFcfa(0)
  return formatFcfa(totals.totalShareFcfa)
})

const doctorSharesTrend = computed(() => {
  void localeCode.value
  const totals = doctorShares.value?.totals
  if (!totals) return translateDashboardLabel('Parts médecins non réglées')
  const parts = [
    translateTemplate('Consult. {amount}', { amount: formatFcfa(totals.consultationShareFcfa) }),
    translateTemplate('Opér. {amount}', { amount: formatFcfa(totals.surgeryShareFcfa) }),
  ]
  if (totals.pendingPayrollFcfa > 0) {
    parts.push(translateTemplate('Paie {amount}', { amount: formatFcfa(totals.pendingPayrollFcfa) }))
  }
  return parts.join(' · ')
})

const selectedDoctorLabel = computed(() => {
  if (!doctorShareDoctorId.value) return translateDashboardLabel('Somme globale')
  const doc = doctorShareOptions.value.find((d) => d.id === doctorShareDoctorId.value)
  return doc ? fullName(doc.firstName, doc.lastName) : translateDashboardLabel('Médecin')
})

const selectedDoctorShareRow = computed(() => {
  if (!doctorShareDoctorId.value || !doctorShares.value) return null
  return doctorShares.value.doctors.find((d) => d.id === doctorShareDoctorId.value) ?? null
})

const canSettleSelectedDoctorCash = computed(() => {
  const row = selectedDoctorShareRow.value
  return Boolean(row && (row.totalShareFcfa ?? 0) > 0 && (row.items?.length ?? 0) > 0)
})

async function settleSelectedDoctorCash() {
  const row = selectedDoctorShareRow.value
  if (!row?.items?.length) return

  const confirmed = await showAppModal({
    type: 'CONFIRM',
    title: translateDashboardLabel('Régler en espèces'),
    message: translateTemplate(
      'Confirmer le règlement cash de {amount} pour {name} ? La carte repassera à zéro.',
      {
        amount: formatFcfa(row.totalShareFcfa),
        name: fullName(row.firstName, row.lastName),
      },
    ),
    confirmLabel: 'Régler',
    cancelLabel: 'Annuler',
    showCancel: true,
  })
  if (!confirmed) return

  settlingDoctorShares.value = true
  settleSharesMessage.value = ''
  try {
    const consultItems = row.items.filter(
      (item) => item.kind === 'CONSULTATION' && item.invoiceId,
    )
    if (consultItems.length) {
      await api.post('/doctor-shares/settle-consultations-cash', {
        items: consultItems.map((item) => ({
          invoiceId: item.invoiceId!,
          amountFcfa: item.amountFcfa,
          businessDate: item.businessDate,
          doctorUserId: row.id,
        })),
      })
    }

    const surgeryShares = new Map<string, Set<'surgeon' | 'assistant'>>()
    for (const item of row.items) {
      if (!item.surgeryCaseId) continue
      if (item.kind !== 'OPERATION_SURGEON' && item.kind !== 'OPERATION_ASSISTANT') continue
      const set = surgeryShares.get(item.surgeryCaseId) ?? new Set()
      set.add(item.kind === 'OPERATION_SURGEON' ? 'surgeon' : 'assistant')
      surgeryShares.set(item.surgeryCaseId, set)
    }
    for (const [surgeryId, shares] of surgeryShares) {
      await api.post('/doctor-shares/settle-surgery-cash', {
        surgeryId,
        shares: [...shares],
      })
    }

    settleSharesType.value = 'success'
    settleSharesMessage.value = translateDashboardLabel(
      'Parts réglées en espèces — la carte est à jour.',
    )
    await loadDoctorShares()
  } catch (error: unknown) {
    const err = error as { response?: { data?: { error?: string } } }
    settleSharesType.value = 'error'
    settleSharesMessage.value =
      err.response?.data?.error ||
      translateDashboardLabel('Impossible de régler ces parts en espèces.')
  } finally {
    settlingDoctorShares.value = false
  }
}

async function loadDoctorShares() {
  loading.value = true
  loadError.value = ''
  try {
    const params: Record<string, string> = {
      period: doctorSharePeriod.value,
    }
    if (doctorSharePeriod.value === 'day') params.day = todayDateKey()
    else params.month = currentMonthKey()
    if (doctorShareDoctorId.value) params.doctorId = doctorShareDoctorId.value

    const [{ data: overviewData }, { data: doctors }] = await Promise.all([
      api.get<DoctorSharesOverview>('/doctor-shares/receivable', { params }),
      doctorShareOptions.value.length
        ? Promise.resolve({ data: doctorShareOptions.value })
        : api.get<Array<{ id: string; firstName: string; lastName: string }>>(
            '/doctor-shares/doctors',
          ),
    ])
    doctorShares.value = overviewData
    if (!doctorShareOptions.value.length) {
      doctorShareOptions.value = doctors
    }
  } catch {
    doctorShares.value = null
    loadError.value = translateDashboardLabel('Impossible de charger les parts médecins.')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadDoctorShares()
})

watch([doctorSharePeriod, doctorShareDoctorId], () => {
  settleSharesMessage.value = ''
  void loadDoctorShares()
})

defineExpose({ reload: loadDoctorShares })
</script>

<template>
  <section class="doctor-shares-section">
    <div class="doctor-shares-section__header">
      <h3>{{ translateDashboardLabel('Parts médecins à percevoir') }}</h3>
      <span>{{ selectedDoctorLabel }}</span>
    </div>

    <p v-if="loadError" class="doctor-shares-section__message doctor-shares-section__message--error">
      {{ loadError }}
    </p>

    <div class="doctor-shares-section__filters">
      <UiSelect v-model="doctorSharePeriod" :label="translateDashboardLabel('Période')">
        <option value="day">{{ translateDashboardLabel("Aujourd'hui") }}</option>
        <option value="month">{{ translateDashboardLabel('Mois') }}</option>
      </UiSelect>
      <UiSelect v-model="doctorShareDoctorId" :label="translateDashboardLabel('Médecin')">
        <option value="">{{ translateDashboardLabel('Tous (somme globale)') }}</option>
        <option v-for="doc in doctorShareOptions" :key="doc.id" :value="doc.id">
          {{ fullName(doc.firstName, doc.lastName) }}
        </option>
      </UiSelect>
      <div class="doctor-shares-section__actions">
        <UiButton
          v-if="canSettleSelectedDoctorCash"
          type="button"
          size="sm"
          variant="secondary"
          :icon="Wallet"
          :loading="settlingDoctorShares"
          @click="settleSelectedDoctorCash"
        >
          {{ translateDashboardLabel('Régler en espèces') }}
        </UiButton>
        <p v-else-if="!doctorShareDoctorId" class="doctor-shares-section__hint">
          {{
            translateDashboardLabel(
              'Sélectionnez un médecin pour afficher le bouton de règlement.',
            )
          }}
        </p>
        <p
          v-else-if="(selectedDoctorShareRow?.totalShareFcfa ?? 0) <= 0"
          class="doctor-shares-section__hint"
        >
          {{ translateDashboardLabel('Rien à régler pour ce médecin.') }}
        </p>
        <UiButton
          type="button"
          size="sm"
          variant="ghost"
          :loading="loading"
          @click="loadDoctorShares"
        >
          {{ translateDashboardLabel('Actualiser') }}
        </UiButton>
      </div>
    </div>

    <UiStatCard
      :label="translateDashboardLabel('À percevoir (parts %)')"
      :value="doctorSharesCardValue"
      :trend="doctorSharesTrend"
      :icon="CircleDollarSign"
      variant="rose"
      compact
    />

    <p
      v-if="settleSharesMessage"
      class="doctor-shares-section__message"
      :class="`doctor-shares-section__message--${settleSharesType}`"
    >
      {{ settleSharesMessage }}
    </p>
  </section>
</template>

<style scoped>
.doctor-shares-section {
  display: grid;
  gap: 0.75rem;
  padding: 1rem 1.1rem;
  border-radius: 14px;
  border: 1px solid rgba(225, 29, 72, 0.14);
  background: linear-gradient(180deg, rgba(255, 241, 242, 0.9), #fff);
}

.doctor-shares-section__header {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: baseline;
}

.doctor-shares-section__header h3 {
  margin: 0;
  font-size: 1rem;
}

.doctor-shares-section__header span {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.doctor-shares-section__filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  align-items: end;
}

.doctor-shares-section__actions {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem;
}

.doctor-shares-section__hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.doctor-shares-section__message {
  margin: 0;
  font-size: 0.8125rem;
}

.doctor-shares-section__message--success {
  color: #047857;
}

.doctor-shares-section__message--error {
  color: #be123c;
}

@media (max-width: 1100px) {
  .doctor-shares-section__filters {
    grid-template-columns: 1fr;
  }
}
</style>
