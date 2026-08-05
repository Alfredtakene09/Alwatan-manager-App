<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  Stethoscope,
  FlaskConical,
  ClipboardList,
  CheckCircle2,
  CircleDollarSign,
  FolderOpen,
  Wallet,
} from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { currentMonthKey, todayDateKey } from '@/lib/date-filters'

const { uiText } = useAppI18n()

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

type MedecinStats = {
  consultationToday: number
  dejaConsulteToday: number
  labsWaitingToday: number
  labsResultsToday: number
  hasQuota: boolean
  consultationsTotalToday: number | null
  consultationsGrossFcfa: number | null
  consultationsDoctorShareFcfa: number | null
  consultationTotalFcfa: number | null
  consultationQuotaMode: 'PERCENT' | 'FIXED_AMOUNT' | null
  consultationQuotaPercent: number | null
  consultationQuotaFcfa: number | null
  dossierPatientsCount: number
}

const router = useRouter()

const props = defineProps<{
  refreshKey?: number | string
}>()

const stats = ref<MedecinStats>({
  consultationToday: 0,
  dejaConsulteToday: 0,
  labsWaitingToday: 0,
  labsResultsToday: 0,
  hasQuota: false,
  consultationsTotalToday: null,
  consultationsGrossFcfa: null,
  consultationsDoctorShareFcfa: null,
  consultationTotalFcfa: null,
  consultationQuotaMode: null,
  consultationQuotaPercent: null,
  consultationQuotaFcfa: null,
  dossierPatientsCount: 0,
})

const receivable = ref<ReceivablePayload | null>(null)
const periodMode = ref<'day' | 'month'>('month')
const loading = ref(false)
const addingToSalary = ref(false)
const loadError = ref('')
const actionMessage = ref('')
const actionType = ref<'success' | 'error'>('success')

const payableValue = computed(() => {
  const total = receivable.value?.totals.totalShareFcfa ?? 0
  return formatFcfa(total)
})

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

const myItems = computed(() => {
  return receivable.value?.me?.items ?? receivable.value?.doctors?.[0]?.items ?? []
})

async function loadStats() {
  loading.value = true
  loadError.value = ''
  try {
    const params =
      periodMode.value === 'day'
        ? { period: 'day', day: todayDateKey() }
        : { period: 'month', month: currentMonthKey() }
    const [statsRes, recvRes] = await Promise.all([
      api.get<MedecinStats>('/consultations/medecin-stats'),
      api.get<ReceivablePayload>('/doctor-shares/receivable', { params }),
    ])
    stats.value = statsRes.data
    receivable.value = recvRes.data
  } catch {
    loadError.value = uiText(
      'Impossible de charger les statistiques. Réessayez ou redémarrez le serveur API.',
    )
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
    actionMessage.value = uiText('Parts ajoutées au salaire du mois — la carte repasse à zéro.')
    await loadStats()
  } catch (error: unknown) {
    const err = error as { response?: { data?: { error?: string } } }
    actionType.value = 'error'
    actionMessage.value =
      err.response?.data?.error || uiText('Impossible d’ajouter ces parts au salaire.')
  } finally {
    addingToSalary.value = false
  }
}

onMounted(loadStats)
watch(() => props.refreshKey, loadStats)
watch(periodMode, loadStats)

function openDossierPatient() {
  router.push({ name: 'dossier-patient' })
}
</script>

<template>
  <div class="stats-grid medecin-stats" :class="{ 'medecin-stats--loading': loading }">
    <p v-if="loadError" class="medecin-stats__error">{{ loadError }}</p>
    <UiStatCard
      mini
      label="Consultation"
      :value="stats.consultationToday"
      :icon="Stethoscope"
      variant="teal"
    />
    <UiStatCard
      mini
      label="Déjà consulté"
      :value="stats.dejaConsulteToday"
      :icon="CheckCircle2"
      variant="blue"
    />
    <UiStatCard
      mini
      label="Labos attente"
      :value="stats.labsWaitingToday"
      :icon="FlaskConical"
      variant="amber"
    />
    <UiStatCard
      mini
      label="Résultats labos"
      :value="stats.labsResultsToday"
      :icon="ClipboardList"
      variant="violet"
    />
    <button type="button" class="medecin-stats__link" @click="openDossierPatient">
      <UiStatCard
        mini
        label="Dossier patient"
        :value="stats.dossierPatientsCount"
        :icon="FolderOpen"
        variant="rose"
      />
    </button>

    <div class="medecin-stats__receivable">
      <div class="medecin-stats__receivable-tools">
        <UiSelect v-model="periodMode" :label="uiText('Période')">
          <option value="day">{{ uiText('Aujourd’hui') }}</option>
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
        label="À percevoir"
        :value="payableValue"
        :icon="CircleDollarSign"
        variant="amber"
      />
      <p class="medecin-stats__receivable-detail">{{ payableTrend }}</p>
      <p
        v-if="actionMessage"
        class="medecin-stats__action"
        :class="`medecin-stats__action--${actionType}`"
      >
        {{ actionMessage }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.medecin-stats {
  margin-bottom: 0;
}

.medecin-stats--loading {
  opacity: 0.65;
  pointer-events: none;
}

.medecin-stats__error {
  grid-column: 1 / -1;
  margin: 0 0 0.25rem;
  padding: 0.55rem 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 0.75rem;
}

.medecin-stats__link {
  display: block;
  padding: 0;
  border: none;
  background: none;
  text-align: inherit;
  cursor: pointer;
  border-radius: var(--radius);
}

.medecin-stats__link:focus-visible {
  outline: 2px solid var(--accent-500);
  outline-offset: 2px;
}

.medecin-stats__link:hover :deep(.stat-card) {
  border-color: var(--accent-300);
  box-shadow: 0 2px 10px rgba(15, 118, 110, 0.1);
}

.medecin-stats__receivable {
  grid-column: 1 / -1;
  display: grid;
  gap: 0.45rem;
  padding: 0.65rem 0.75rem;
  border-radius: 12px;
  border: 1px solid rgba(217, 119, 6, 0.2);
  background: linear-gradient(180deg, rgba(251, 191, 36, 0.08), #fff);
}

.medecin-stats__receivable-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  align-items: flex-end;
  justify-content: space-between;
}

.medecin-stats__receivable-detail {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.medecin-stats__action {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
}

.medecin-stats__action--success {
  color: var(--success, #15803d);
}

.medecin-stats__action--error {
  color: var(--danger);
}
</style>
