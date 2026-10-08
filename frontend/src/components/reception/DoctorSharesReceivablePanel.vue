<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { CircleDollarSign, Scissors, Stethoscope, Wallet } from '@lucide/vue'
import api from '@/api/client'
import { fullName, formatFcfa } from '@/lib/roles'
import {
  translateDashboardLabel,
  translateTemplate,
} from '@/lib/dashboard-i18n'
import { useAppI18n } from '@/i18n/useAppI18n'
import { currentMonthKey, todayDateKey, yesterdayDateKey } from '@/lib/date-filters'
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
  pendingPayrollFcfa?: number
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
const doctorSharePeriod = ref<'day' | 'month'>('day')
const doctorShareDay = ref(todayDateKey())
const doctorShareMonth = ref(currentMonthKey())
const doctorShareDoctorId = ref('')
const settlingDoctorShares = ref(false)
const settleSharesMessage = ref('')
const settleSharesType = ref<'success' | 'error'>('success')
const loading = ref(false)
const loadError = ref('')

const doctorsWithShare = computed(() => {
  const rows = doctorShares.value?.doctors ?? []
  const owed = rows.filter((doc) => doc.totalShareFcfa > 0)
  const selected = rows.find((doc) => doc.id === doctorShareDoctorId.value)
  const list =
    selected && !owed.some((doc) => doc.id === selected.id) ? [...owed, selected] : owed
  return list.sort((a, b) =>
    fullName(a.firstName, a.lastName).localeCompare(fullName(b.firstName, b.lastName), 'fr'),
  )
})

const shareTotals = computed(() => {
  const row = selectedDoctorShareRow.value
  if (row) {
    return {
      consultationShareFcfa: row.consultationShareFcfa ?? 0,
      surgeryShareFcfa: row.surgeryShareFcfa ?? 0,
      totalShareFcfa: row.totalShareFcfa ?? 0,
      pendingPayrollFcfa: row.pendingPayrollFcfa ?? 0,
    }
  }
  const totals = doctorShares.value?.totals
  return {
    consultationShareFcfa: totals?.consultationShareFcfa ?? 0,
    surgeryShareFcfa: totals?.surgeryShareFcfa ?? 0,
    totalShareFcfa: totals?.totalShareFcfa ?? 0,
    pendingPayrollFcfa: totals?.pendingPayrollFcfa ?? 0,
  }
})

const payrollTrend = computed(() => {
  void localeCode.value
  const pending = shareTotals.value.pendingPayrollFcfa
  if (pending <= 0) return ''
  return translateTemplate('Paie {amount}', { amount: formatFcfa(pending) })
})

const selectedDoctorLabel = computed(() => {
  if (!doctorShareDoctorId.value) return translateDashboardLabel('Somme globale')
  const doc = doctorsWithShare.value.find((d) => d.id === doctorShareDoctorId.value)
  return doc ? fullName(doc.firstName, doc.lastName) : translateDashboardLabel('Médecin')
})

const periodCaption = computed(() => {
  if (doctorSharePeriod.value === 'day') {
    const [year, month, day] = doctorShareDay.value.split('-').map(Number)
    if (!year || !month || !day) return ''
    return new Date(year, month - 1, day).toLocaleDateString('fr-FR')
  }
  const [year, month] = doctorShareMonth.value.split('-').map(Number)
  if (!year || !month) return ''
  return new Date(year, month - 1, 1).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  })
})

function selectShareDay(day: string) {
  doctorSharePeriod.value = 'day'
  doctorShareDay.value = day
}

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
    let alreadySettled = 0
    if (consultItems.length) {
      const { data } = await api.post<{ count: number; alreadySettled?: number }>(
        '/doctor-shares/settle-consultations-cash',
        {
          items: consultItems.map((item) => ({
            invoiceId: item.invoiceId!,
            amountFcfa: item.amountFcfa,
            businessDate: item.businessDate,
            doctorUserId: row.id,
          })),
        },
      )
      alreadySettled = data.alreadySettled ?? 0
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
      alreadySettled > 0 && consultItems.length > 0 && alreadySettled >= consultItems.length
        ? 'Ces consultations sont déjà réglées. La somme a été retirée.'
        : 'Parts réglées en espèces — la carte est à jour.',
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
    if (doctorSharePeriod.value === 'day') params.day = doctorShareDay.value || todayDateKey()
    else params.month = doctorShareMonth.value || currentMonthKey()

    const { data: overviewData } = await api.get<DoctorSharesOverview>('/doctor-shares/receivable', {
      params,
    })
    doctorShares.value = overviewData
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

watch([doctorSharePeriod, doctorShareDay, doctorShareMonth], () => {
  settleSharesMessage.value = ''
  void loadDoctorShares()
})

watch(doctorShareDoctorId, () => {
  settleSharesMessage.value = ''
})

defineExpose({ reload: loadDoctorShares })
</script>

<template>
  <section class="doctor-shares-section">
    <div class="doctor-shares-section__header">
      <h3>{{ translateDashboardLabel('Parts médecins à percevoir') }}</h3>
      <span>{{ periodCaption }} · {{ selectedDoctorLabel }}</span>
    </div>

    <p v-if="loadError" class="doctor-shares-section__message doctor-shares-section__message--error">
      {{ loadError }}
    </p>

    <div class="doctor-shares-section__filters">
      <UiSelect v-model="doctorSharePeriod" :label="translateDashboardLabel('Période')">
        <option value="day">{{ translateDashboardLabel('Jour') }}</option>
        <option value="month">{{ translateDashboardLabel('Mois') }}</option>
      </UiSelect>
      <div v-if="doctorSharePeriod === 'day'" class="doctor-shares-date-wrap">
        <label class="doctor-shares-date">
          <span>{{ translateDashboardLabel('Date') }}</span>
          <input v-model="doctorShareDay" type="date" />
        </label>
        <div class="doctor-shares-date__quick">
          <button type="button" @click="selectShareDay(todayDateKey())">
            {{ translateDashboardLabel("Aujourd'hui") }}
          </button>
          <button type="button" @click="selectShareDay(yesterdayDateKey())">
            {{ translateDashboardLabel('Hier') }}
          </button>
        </div>
      </div>
      <label v-else class="doctor-shares-date">
        <span>{{ translateDashboardLabel('Mois') }}</span>
        <input v-model="doctorShareMonth" type="month" />
      </label>
      <UiSelect v-model="doctorShareDoctorId" :label="translateDashboardLabel('Médecin')">
        <option value="">{{ translateDashboardLabel('Tous (somme globale)') }}</option>
        <option v-for="doc in doctorsWithShare" :key="doc.id" :value="doc.id">
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

    <div class="doctor-shares-cards" :class="{ 'doctor-shares-cards--loading': loading }">
      <UiStatCard
        label="Consultations"
        :value="formatFcfa(shareTotals.consultationShareFcfa)"
        :icon="Stethoscope"
        variant="blue"
        compact
      />
      <UiStatCard
        label="Opérations"
        :value="formatFcfa(shareTotals.surgeryShareFcfa)"
        :icon="Scissors"
        variant="amber"
        compact
      />
      <UiStatCard
        label="Somme globale"
        :value="formatFcfa(shareTotals.totalShareFcfa)"
        :trend="payrollTrend"
        :icon="CircleDollarSign"
        variant="rose"
        compact
      />
    </div>

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
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  align-items: end;
}

.doctor-shares-date-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: end;
}

.doctor-shares-date-wrap .doctor-shares-date {
  flex: 1 1 9rem;
}

.doctor-shares-date span {
  display: block;
  margin-bottom: 0.4rem;
  font-size: 0.8125rem;
  font-weight: 600;
}

.doctor-shares-date input {
  width: 100%;
  min-height: var(--app-control-height);
  padding: var(--density-control-pad-y) var(--density-control-pad-x);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text);
}

.doctor-shares-date__quick {
  display: flex;
  gap: 0.4rem;
}

.doctor-shares-date__quick button {
  height: var(--app-control-height);
  padding: 0 0.75rem;
  border: 1px solid var(--primary-200, #99f6e4);
  border-radius: 8px;
  background: #fff;
  color: var(--text);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.doctor-shares-date__quick button:hover {
  border-color: var(--primary, #0f766e);
  color: var(--primary, #0f766e);
}

.doctor-shares-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.doctor-shares-cards--loading {
  opacity: 0.55;
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
  .doctor-shares-section__filters,
  .doctor-shares-cards {
    grid-template-columns: 1fr;
  }
}
</style>
