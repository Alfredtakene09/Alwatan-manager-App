<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Wallet,
  Download,
  RefreshCw,
  ArrowRight,
  Clock,
  UserCheck,
  Sun,
  Moon,
  History,
  ListOrdered,
  Banknote,
  AlertTriangle,
  Plus,
  Pencil,
  Eye,
} from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { showSuccessModal, showApiErrorModal } from '@/lib/api-modal-helper'
import {
  formatCashDelayLabel,
  formatDateTimeFr,
  formatShortTimeFr,
  comptableScheduleBadgeLabel,
} from '@/lib/gestionnaire-dashboard'
import GestionnaireDisburseModal, {
  type CashRegisterDetail,
} from '@/components/gestionnaire/GestionnaireDisburseModal.vue'
import GestionnaireDisburseHistoryModal, {
  type DisburseHistoryDetail,
  type DisburseHistoryRow,
} from '@/components/gestionnaire/GestionnaireDisburseHistoryModal.vue'
import GestionnaireRowAction from '@/components/gestionnaire/GestionnaireRowAction.vue'
import GestionnaireRowActionGroup from '@/components/gestionnaire/GestionnaireRowActionGroup.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import '@/assets/gestionnaire-page.css'

type CashRegisterSummary = {
  id: 'comptabilite'
  label: string
  balanceFcfa: number
  transactionCount: number
  lastDisbursementAt: string | null
  hoursSinceLastDisbursement: number | null
  overdue: boolean
  disbursementPhase?: 'ok' | 'during_day' | 'evening_due' | 'morning_due' | 'carry_over'
  disbursementStatusLabel?: string
  disbursementHint?: string
}

type HistoryRow = DisburseHistoryRow

const WORKFLOW_STEPS = [
  {
    step: '1',
    title: 'Comptable',
    text: 'Tirelire consolidée — créneaux matin, soir et nuit',
    icon: Sun,
  },
  {
    step: '2',
    title: 'Gestionnaire',
    text: 'Collecte journalière — après chaque créneau',
    icon: Moon,
  },
] as const

const comptableRegister = ref<CashRegisterSummary | null>(null)
const historyRows = ref<HistoryRow[]>([])
const loading = ref(false)
const historyLoading = ref(false)
const disburseSaving = ref(false)

const showDisburseModal = ref(false)
const disburseDetail = ref<CashRegisterDetail | null>(null)

const showHistoryModal = ref(false)
const historyModalMode = ref<'view' | 'edit'>('view')
const historyTarget = ref<HistoryRow | null>(null)
const historyDetail = ref<DisburseHistoryDetail | null>(null)
const historyDetailLoading = ref(false)
const historySaving = ref(false)

const historyFrom = ref('')
const historyTo = ref('')

async function loadRegisters() {
  loading.value = true
  try {
    const { data } = await api.get<{ registers: CashRegisterSummary[] }>(
      '/gestionnaire/cash/registers',
    )
    comptableRegister.value = data.registers.find((r) => r.id === 'comptabilite') ?? null
  } finally {
    loading.value = false
  }
}

async function loadHistory() {
  historyLoading.value = true
  try {
    const params = new URLSearchParams({ register: 'comptabilite' })
    if (historyFrom.value) params.set('from', historyFrom.value)
    if (historyTo.value) params.set('to', historyTo.value)
    const { data } = await api.get<{ rows: HistoryRow[] }>(
      `/gestionnaire/cash/history?${params.toString()}`,
    )
    historyRows.value = data.rows
  } finally {
    historyLoading.value = false
  }
}

async function refreshAll() {
  await Promise.all([loadRegisters(), loadHistory()])
}

async function openDisburse() {
  try {
    const { data } = await api.get<CashRegisterDetail>('/gestionnaire/cash/registers/comptabilite')
    disburseDetail.value = data
    showDisburseModal.value = true
  } catch (error) {
    await showApiErrorModal(error, 'Impossible de charger le détail de la caisse.')
  }
}

async function confirmDisburse(payload: { disbursementFcfa: number; comment: string }) {
  disburseSaving.value = true
  try {
    const { data } = await api.post<{ disbursedFcfa: number; label: string }>(
      '/gestionnaire/cash/disburse',
      {
        registerId: 'comptabilite',
        disbursementFcfa: payload.disbursementFcfa,
        comment: payload.comment || undefined,
      },
    )
    showDisburseModal.value = false
    disburseDetail.value = null
    await showSuccessModal(
      'Décaissement enregistré',
      `${formatFcfa(data.disbursedFcfa)} décaissés — ${data.label}`,
    )
    await refreshAll()
  } catch (error) {
    await showApiErrorModal(error, 'Le décaissement a échoué.')
  } finally {
    disburseSaving.value = false
  }
}

function exportCsv() {
  window.open('/api/gestionnaire/cash/history/export.csv?register=comptabilite', '_blank')
}

async function openHistoryView(row: HistoryRow) {
  historyTarget.value = row
  historyModalMode.value = 'view'
  historyDetail.value = null
  showHistoryModal.value = true
  historyDetailLoading.value = true
  try {
    const { data } = await api.get<DisburseHistoryDetail>(`/gestionnaire/cash/history/${row.id}`)
    historyDetail.value = data
  } catch (error) {
    historyDetail.value = row
    await showApiErrorModal(error, 'Détail indisponible, affichage des informations principales.')
  } finally {
    historyDetailLoading.value = false
  }
}

function openHistoryEdit(row: HistoryRow) {
  historyTarget.value = row
  historyModalMode.value = 'edit'
  historyDetail.value = null
  showHistoryModal.value = true
}

function closeHistoryModal() {
  showHistoryModal.value = false
  historyTarget.value = null
  historyDetail.value = null
}

function switchHistoryToEdit() {
  historyModalMode.value = 'edit'
}

async function saveHistoryComment(comment: string) {
  if (!historyTarget.value) return
  historySaving.value = true
  try {
    const { data } = await api.patch<DisburseHistoryDetail>(
      `/gestionnaire/cash/history/${historyTarget.value.id}`,
      { comment },
    )
    historyDetail.value = data
    historyModalMode.value = 'view'
    await loadHistory()
    await showSuccessModal('Commentaire enregistré', 'Le décaissement a été mis à jour.')
  } catch (error) {
    await showApiErrorModal(error, 'Enregistrement impossible.')
  } finally {
    historySaving.value = false
  }
}

const delayLabel = computed(() => {
  const r = comptableRegister.value
  if (!r) return ''
  return formatCashDelayLabel(r.hoursSinceLastDisbursement, r.lastDisbursementAt)
})

const historyTotalFcfa = computed(() =>
  historyRows.value.reduce((sum, row) => sum + row.amountFcfa, 0),
)

const registerStateClass = computed(() => {
  const r = comptableRegister.value
  if (!r) return ''
  if (r.overdue) return 'caisse-panel--overdue'
  if (r.disbursementPhase === 'during_day') return 'caisse-panel--during-day'
  if (r.balanceFcfa <= 0) return 'caisse-panel--empty'
  return 'caisse-panel--ready'
})

onMounted(refreshAll)
</script>

<template>
  <div class="caisse-page">
    <header class="caisse-hero">
      <div class="caisse-hero__main">
        <div class="caisse-hero__icon">
          <Wallet :size="26" />
        </div>
        <div>
          <p class="caisse-hero__eyebrow">Trésorerie gestionnaire</p>
          <h1 class="caisse-hero__title">Caisse comptable</h1>
          <p class="caisse-hero__subtitle">
            Collecte journalière de la tirelire — créneaux <strong>matin, soir et nuit</strong>
          </p>
        </div>
      </div>
      <UiButton
        size="sm"
        variant="ghost"
        class="caisse-hero__refresh"
        :icon="RefreshCw"
        :disabled="loading || historyLoading"
        @click="refreshAll"
      >
        Actualiser
      </UiButton>
    </header>

    <section class="workflow-strip" aria-label="Circuit de caisse">
      <article
        v-for="(item, index) in WORKFLOW_STEPS"
        :key="item.step"
        class="workflow-step"
        :class="{ 'workflow-step--active': item.step === '2' }"
      >
        <div class="workflow-step__icon">
          <component :is="item.icon" :size="18" />
        </div>
        <div class="workflow-step__body">
          <span class="workflow-step__num">{{ item.step }}</span>
          <strong class="workflow-step__title">{{ item.title }}</strong>
          <p class="workflow-step__text">{{ item.text }}</p>
        </div>
        <ArrowRight
          v-if="index < WORKFLOW_STEPS.length - 1"
          class="workflow-step__arrow"
          :size="18"
          aria-hidden="true"
        />
      </article>
    </section>

    <div v-if="loading" class="caisse-state">Chargement de la tirelire…</div>

    <section v-else-if="comptableRegister" class="caisse-main">
      <article class="caisse-panel" :class="registerStateClass">
        <div class="caisse-panel__glow" aria-hidden="true" />

        <div class="caisse-panel__top">
          <div>
            <p class="caisse-panel__label">{{ comptableRegister.label }}</p>
            <p class="caisse-panel__amount">{{ formatFcfa(comptableRegister.balanceFcfa) }}</p>
          </div>
          <span
            v-if="comptableScheduleBadgeLabel(comptableRegister.disbursementPhase)"
            class="caisse-panel__badge"
            :class="{
              'caisse-panel__badge--danger': comptableRegister.overdue,
              'caisse-panel__badge--info': comptableRegister.disbursementPhase === 'during_day',
            }"
          >
            <AlertTriangle v-if="comptableRegister.overdue" :size="12" />
            {{ comptableScheduleBadgeLabel(comptableRegister.disbursementPhase) }}
          </span>
        </div>

        <p v-if="comptableRegister.disbursementStatusLabel" class="caisse-panel__status">
          {{ comptableRegister.disbursementStatusLabel }}
        </p>

        <div class="caisse-panel__stats">
          <div class="caisse-stat">
            <ListOrdered :size="16" />
            <div>
              <span class="caisse-stat__value">{{ comptableRegister.transactionCount }}</span>
              <span class="caisse-stat__label">transaction(s) en attente</span>
            </div>
          </div>
          <div class="caisse-stat">
            <Clock :size="16" />
            <div>
              <span class="caisse-stat__value caisse-stat__value--text">{{ delayLabel }}</span>
            </div>
          </div>
        </div>

        <p v-if="comptableRegister.disbursementHint" class="caisse-panel__hint">
          {{ comptableRegister.disbursementHint }}
        </p>

        <UiButton
          class="caisse-panel__cta"
          variant="primary"
          :icon="Banknote"
          :disabled="comptableRegister.balanceFcfa <= 0"
          @click="openDisburse"
        >
          Récupérer la tirelire
        </UiButton>
      </article>

      <aside class="caisse-aside">
        <UiCard title="Rappel" description="Collecte de la tirelire comptable" :icon="UserCheck" icon-variant="amber">
          <ul class="caisse-tips">
            <li>Vous récupérez uniquement la <strong>tirelire comptable</strong>.</li>
            <li>Passage habituel : <strong>après la nuit (6h)</strong> ou <strong>le matin</strong>.</li>
            <li>Créneaux caisse : <strong>matin 7h–14h, soir 16h–21h, nuit 21h–6h</strong>.</li>
          </ul>
        </UiCard>

        <div v-if="historyRows.length" class="caisse-recent">
          <p class="caisse-recent__title">
            <History :size="15" />
            Dernier passage
          </p>
          <div class="caisse-recent__card">
            <strong>{{ formatFcfa(historyRows[0].amountFcfa) }}</strong>
            <span>{{ formatDateTimeFr(historyRows[0].settledAt) }}</span>
            <span class="caisse-recent__meta">
              {{ historyRows[0].cashierName }} → {{ historyRows[0].gestionnaireName }}
            </span>
          </div>
        </div>
      </aside>
    </section>

    <UiCard
      class="caisse-history"
      title="Historique des décaissements"
      description="Caisse comptable — passages gestionnaire"
      :icon="History"
      icon-variant="amber"
    >
      <div class="caisse-history__toolbar">
        <div class="caisse-history__filters">
          <UiInput v-model="historyFrom" label="Du" type="date" class="caisse-history__field" />
          <UiInput v-model="historyTo" label="Au" type="date" class="caisse-history__field" />
          <UiButton size="sm" variant="ghost" @click="loadHistory">Filtrer</UiButton>
        </div>
        <UiButton size="sm" variant="ghost" :icon="Download" @click="exportCsv">
          Export CSV
        </UiButton>
        <UiButton size="sm" :icon="Plus" @click="openDisburse">
          Nouveau décaissement
        </UiButton>
      </div>

      <div v-if="historyLoading" class="caisse-state caisse-state--compact">Chargement…</div>
      <div v-else-if="!historyRows.length" class="caisse-state caisse-state--empty">
        <History :size="28" />
        <p>Aucun décaissement enregistré</p>
      </div>
      <div v-else class="caisse-history__table-wrap">
        <table class="caisse-history__table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Caissier comptable</th>
              <th class="col-amount">Montant</th>
              <th class="col-center">Transactions</th>
              <th>Gestionnaire</th>
              <th class="col-actions"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in historyRows" :key="row.id">
              <td>
                <span class="caisse-history__date">
                  {{
                    new Date(row.settledAt).toLocaleDateString('fr-FR', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })
                  }}
                </span>
                <span class="caisse-history__time">{{ formatShortTimeFr(row.settledAt) }}</span>
              </td>
              <td>{{ row.cashierName }}</td>
              <td class="col-amount">
                <strong>{{ formatFcfa(row.amountFcfa) }}</strong>
              </td>
              <td class="col-center">
                <span class="tx-pill">{{ row.transactionCount }}</span>
              </td>
              <td>{{ row.gestionnaireName }}</td>
              <td class="actions">
                <GestionnaireRowActionGroup>
                  <GestionnaireRowAction
                    :icon="Eye"
                    label="Voir"
                    variant="neutral"
                    @click="openHistoryView(row)"
                  />
                  <GestionnaireRowAction
                    :icon="Pencil"
                    label="Modifier"
                    variant="edit"
                    @click="openHistoryEdit(row)"
                  />
                </GestionnaireRowActionGroup>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2"><strong>{{ historyRows.length }} passage(s)</strong></td>
              <td class="col-amount"><strong>{{ formatFcfa(historyTotalFcfa) }}</strong></td>
              <td colspan="3" />
            </tr>
          </tfoot>
        </table>
      </div>
    </UiCard>

    <GestionnaireDisburseModal
      :open="showDisburseModal"
      :detail="disburseDetail"
      :saving="disburseSaving"
      @close="showDisburseModal = false"
      @confirm="confirmDisburse"
    />

    <GestionnaireDisburseHistoryModal
      :open="showHistoryModal"
      :mode="historyModalMode"
      :row="historyTarget"
      :detail="historyDetail"
      :loading="historyDetailLoading"
      :saving="historySaving"
      @close="closeHistoryModal"
      @save="saveHistoryComment"
      @switch-to-edit="switchHistoryToEdit"
    />
  </div>
</template>

<style scoped>
.caisse-page {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  max-width: 1080px;
}

.caisse-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.15rem 1.35rem;
  border-radius: 16px;
  background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 48%, #fde68a 100%);
  border: 1px solid rgba(180, 83, 9, 0.18);
  box-shadow: 0 8px 24px rgba(180, 83, 9, 0.08);
}

.caisse-hero__main {
  display: flex;
  align-items: center;
  gap: 0.9rem;
}

.caisse-hero__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.1rem;
  height: 3.1rem;
  border-radius: 13px;
  background: linear-gradient(145deg, #b45309, #92400e);
  color: #fff;
  box-shadow: 0 6px 16px rgba(146, 64, 14, 0.28);
  flex-shrink: 0;
}

.caisse-hero__eyebrow {
  margin: 0 0 0.1rem;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #92400e;
}

.caisse-hero__title {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #78350f;
  line-height: 1.15;
}

.caisse-hero__subtitle {
  margin: 0.3rem 0 0;
  font-size: 0.875rem;
  color: #a16207;
}

.caisse-hero__subtitle strong {
  color: #92400e;
}

.caisse-hero__refresh {
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.55) !important;
}

.workflow-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
}

.workflow-step {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  padding: 0.85rem 0.9rem;
  border-radius: 12px;
  border: 1px solid rgba(180, 83, 9, 0.12);
  background: #fff;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.03);
}

.workflow-step--active {
  border-color: rgba(217, 119, 6, 0.35);
  background: linear-gradient(165deg, #fffbeb, #fff);
  box-shadow: 0 4px 14px rgba(217, 119, 6, 0.1);
}

.workflow-step__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.1rem;
  height: 2.1rem;
  border-radius: 9px;
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
  flex-shrink: 0;
}

.workflow-step--active .workflow-step__icon {
  background: linear-gradient(145deg, #f59e0b, #d97706);
  color: #fff;
}

.workflow-step__num {
  display: block;
  font-size: 0.625rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #d97706;
  margin-bottom: 0.1rem;
}

.workflow-step__title {
  display: block;
  font-size: 0.875rem;
  color: #78350f;
}

.workflow-step__text {
  margin: 0.2rem 0 0;
  font-size: 0.75rem;
  line-height: 1.4;
  color: #78716c;
}

.workflow-step__arrow {
  display: none;
}

.caisse-state {
  padding: 2.5rem 1rem;
  text-align: center;
  color: #94a3b8;
  font-size: 0.9375rem;
}

.caisse-state--compact {
  padding: 1.5rem;
}

.caisse-state--empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.caisse-main {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

.caisse-panel {
  position: relative;
  overflow: hidden;
  padding: 1.35rem 1.4rem;
  border-radius: 16px;
  border: 1px solid rgba(217, 119, 6, 0.22);
  background: linear-gradient(155deg, #fffbeb 0%, #fef3c7 42%, #fff 100%);
  box-shadow: 0 10px 28px rgba(217, 119, 6, 0.1);
}

.caisse-panel__glow {
  position: absolute;
  top: -3rem;
  right: -2rem;
  width: 10rem;
  height: 10rem;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(245, 158, 11, 0.22), transparent 70%);
  pointer-events: none;
}

.caisse-panel--overdue {
  border-color: #fca5a5;
  background: linear-gradient(155deg, #fff1f2 0%, #ffe4e6 35%, #fff 100%);
  box-shadow: 0 10px 28px rgba(220, 38, 38, 0.08);
}

.caisse-panel--during-day {
  border-color: #93c5fd;
  background: linear-gradient(155deg, #eff6ff 0%, #dbeafe 35%, #fff 100%);
}

.caisse-panel--empty {
  opacity: 0.92;
}

.caisse-panel__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.35rem;
}

.caisse-panel__label {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #92400e;
}

.caisse-panel--overdue .caisse-panel__label {
  color: #b91c1c;
}

.caisse-panel__amount {
  margin: 0.2rem 0 0;
  font-size: clamp(1.75rem, 4vw, 2.35rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #78350f;
  font-variant-numeric: tabular-nums;
}

.caisse-panel--overdue .caisse-panel__amount {
  color: #991b1b;
}

.caisse-panel__badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.55rem;
  border-radius: 999px;
  background: #dc2626;
  color: #fff;
  font-size: 0.6875rem;
  font-weight: 700;
  flex-shrink: 0;
}

.caisse-panel__badge--info {
  background: #2563eb;
}

.caisse-panel__badge--danger {
  background: #dc2626;
}

.caisse-panel__status {
  margin: 0 0 0.85rem;
  font-size: 0.9375rem;
  font-weight: 700;
  color: #44403c;
}

.caisse-panel__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
  margin-bottom: 0.85rem;
}

.caisse-stat {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(180, 83, 9, 0.1);
  color: #b45309;
}

.caisse-stat__value {
  display: block;
  font-size: 1.125rem;
  font-weight: 800;
  color: #78350f;
  line-height: 1.2;
}

.caisse-stat__value--text {
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.35;
  color: #57534e;
}

.caisse-stat__label {
  display: block;
  font-size: 0.6875rem;
  color: #78716c;
  margin-top: 0.1rem;
}

.caisse-panel__hint {
  margin: 0 0 1rem;
  padding: 0.65rem 0.75rem;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.65);
  border: 1px dashed rgba(180, 83, 9, 0.2);
  font-size: 0.8125rem;
  line-height: 1.45;
  color: #57534e;
}

.caisse-panel__cta {
  width: 100%;
  justify-content: center;
}

.caisse-aside {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.caisse-tips {
  margin: 0;
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: #57534e;
}

.caisse-recent__title {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0 0 0.45rem;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #92400e;
}

.caisse-recent__card {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  border: 1px solid rgba(180, 83, 9, 0.15);
  background: #fff;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
}

.caisse-recent__card strong {
  font-size: 1.125rem;
  color: #15803d;
}

.caisse-recent__card > span {
  font-size: 0.8125rem;
  color: #64748b;
}

.caisse-recent__meta {
  margin-top: 0.2rem;
  font-size: 0.75rem !important;
  color: #94a3b8 !important;
}

.caisse-history__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.caisse-history__filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.5rem;
}

.caisse-history__field {
  min-width: 9.5rem;
}

.caisse-history__table-wrap {
  border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  overflow: hidden;
}

.caisse-history__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.caisse-history__table th,
.caisse-history__table td {
  padding: 0.7rem 1rem;
  text-align: left;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
}

.caisse-history__table th {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
  background: #f8fafc;
}

.caisse-history__table tbody tr:hover {
  background: rgba(245, 158, 11, 0.05);
}

.caisse-history__table tbody tr:nth-child(even) {
  background: rgba(248, 250, 252, 0.85);
}

.caisse-history__table tfoot td {
  background: #fffbeb;
  border-bottom: none;
  font-size: 0.8125rem;
}

.caisse-history__date {
  display: block;
  font-weight: 600;
  color: #334155;
}

.caisse-history__time {
  display: block;
  font-size: 0.75rem;
  color: #94a3b8;
}

.col-amount {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.col-amount strong {
  color: #15803d;
}

.col-center {
  text-align: center;
}

.tx-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.75rem;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.12);
  color: #92400e;
  font-size: 0.75rem;
  font-weight: 700;
}

@media (min-width: 900px) {
  .workflow-step__arrow {
    display: block;
    position: absolute;
    right: -0.55rem;
    top: 50%;
    transform: translateY(-50%);
    color: #d6d3d1;
    z-index: 1;
  }
}

@media (max-width: 860px) {
  .caisse-main {
    grid-template-columns: 1fr;
  }

  .workflow-strip {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 600px) {
  .caisse-hero {
    flex-direction: column;
  }

  .caisse-panel__stats {
    grid-template-columns: 1fr;
  }

  .caisse-history__table-wrap {
    overflow-x: auto;
  }

  .caisse-history__table {
    min-width: 36rem;
  }
}
</style>
