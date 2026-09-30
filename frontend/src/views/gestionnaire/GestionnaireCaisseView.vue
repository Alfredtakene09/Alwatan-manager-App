<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Wallet,
  RefreshCw,
  ArrowRight,
  UserCheck,
  History,
  Banknote,
  Eye,
  FileCheck,
  Users,
  CheckCircle2,
} from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { showSuccessModal, showApiErrorModal, confirmAppModal } from '@/lib/api-modal-helper'
import {
  formatDateTimeFr,
} from '@/lib/gestionnaire-dashboard'
import GestionnaireDisburseHistoryModal, {
  type DisburseHistoryDetail,
  type DisburseHistoryRow,
} from '@/components/gestionnaire/GestionnaireDisburseHistoryModal.vue'
import GestionnaireRowAction from '@/components/gestionnaire/GestionnaireRowAction.vue'
import GestionnaireRowActionGroup from '@/components/gestionnaire/GestionnaireRowActionGroup.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { exportTableExcel, exportTablePdf, exportTableWord, type ExportColumn } from '@/lib/table-export'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import '@/assets/gestionnaire-page.css'

type DayClosureRow = {
  id: string
  receptionistId: string
  receptionistName: string
  businessDate: string
  shiftSlot: string | null
  collectedFcfa: number
  expensesFcfa: number
  netFcfa: number
  visitsToday: number
  registeredToday: number
  comment: string | null
  closedAt: string
  validatedAt: string | null
  validatedById: string | null
  validatedByName: string | null
  validationComment: string | null
  status: 'pending' | 'validated'
}

type DayClosureReceptionist = { id: string; name: string }

type HistoryRow = DisburseHistoryRow

const { uiText, dateText, timeText } = useAppI18n()

const WORKFLOW_STEPS = [
  {
    step: '1',
    title: 'Réception',
    text: 'Clôture de journée — recettes du jour',
    icon: FileCheck,
  },
  {
    step: '2',
    title: 'Gestionnaire',
    text: 'Valide → décaissement auto (historique)',
    icon: UserCheck,
  },
] as const

const historyRows = ref<HistoryRow[]>([])
const historyLoading = ref(false)

const showHistoryModal = ref(false)
const historyTarget = ref<HistoryRow | null>(null)
const historyDetail = ref<DisburseHistoryDetail | null>(null)
const historyDetailLoading = ref(false)

const historyFrom = ref('')
const historyTo = ref('')

// ─── Clôtures de journée ────────────────────────
const dayClosures = ref<DayClosureRow[]>([])
const dayClosureReceptionists = ref<DayClosureReceptionist[]>([])
const dayClosureLoading = ref(false)
const dayClosureFilterUser = ref('')
const dayClosureFrom = ref('')
const dayClosureTo = ref('')
const dayClosureStatus = ref<'all' | 'pending' | 'validated'>('pending')
const dayClosurePendingCount = ref(0)
const validatingClosureId = ref<string | null>(null)

async function loadHistory() {
  historyLoading.value = true
  try {
    const params = new URLSearchParams()
    if (historyFrom.value) params.set('from', historyFrom.value)
    if (historyTo.value) params.set('to', historyTo.value)
    const qs = params.toString()
    const { data } = await api.get<{ rows: HistoryRow[] }>(
      `/gestionnaire/cash/history${qs ? `?${qs}` : ''}`,
    )
    historyRows.value = data.rows
  } finally {
    historyLoading.value = false
  }
}

async function loadDayClosures() {
  dayClosureLoading.value = true
  try {
    const params = new URLSearchParams()
    if (dayClosureFilterUser.value) params.set('userId', dayClosureFilterUser.value)
    if (dayClosureFrom.value) params.set('from', dayClosureFrom.value)
    if (dayClosureTo.value) params.set('to', dayClosureTo.value)
    if (dayClosureStatus.value !== 'all') params.set('status', dayClosureStatus.value)
    const { data } = await api.get<{
      closures: DayClosureRow[]
      receptionists: DayClosureReceptionist[]
      pendingCount: number
    }>(`/gestionnaire/day-closures?${params.toString()}`)
    dayClosures.value = data.closures ?? []
    dayClosureReceptionists.value = data.receptionists ?? []
    dayClosurePendingCount.value = data.pendingCount ?? 0
  } finally {
    dayClosureLoading.value = false
  }
}

const dayClosureTotalNet = computed(() =>
  dayClosures.value.reduce((sum, c) => sum + c.netFcfa, 0),
)

const dayClosureTotalCollected = computed(() =>
  dayClosures.value.reduce((sum, c) => sum + c.collectedFcfa, 0),
)

async function validateDayClosure(row: DayClosureRow) {
  const confirmed = await confirmAppModal({
    type: 'CONFIRM',
    title: 'Valider la clôture',
    message: translateTemplate(
      'Confirmer la validation ? Réceptionniste : {name} Date : {date} Recettes : {collected} Dépenses : {expenses} Net à décaisser : {net} Le décaissement sera enregistré automatiquement dans l’historique.',
      {
        name: row.receptionistName,
        date: row.businessDate,
        collected: formatFcfa(row.collectedFcfa),
        expenses: formatFcfa(row.expensesFcfa),
        net: formatFcfa(row.netFcfa),
      },
    ),
    confirmLabel: 'Valider et décaisser',
    cancelLabel: 'Annuler',
  })
  if (!confirmed) return

  validatingClosureId.value = row.id
  try {
    const { data } = await api.post<{ message: string; closure: DayClosureRow; disbursedFcfa?: number }>(
      `/gestionnaire/day-closures/${row.id}/validate`,
    )
    await showSuccessModal(
      'Clôture validée',
      translateTemplate('Décaissement automatique de {amount} enregistré — {name}', {
        amount: formatFcfa(data.disbursedFcfa ?? row.netFcfa),
        name: row.receptionistName,
      }),
    )
    await Promise.all([loadDayClosures(), loadHistory()])
  } catch (error) {
    await showApiErrorModal(error, 'Impossible de valider la clôture.')
  } finally {
    validatingClosureId.value = null
  }
}

async function refreshAll() {
  await Promise.all([loadHistory(), loadDayClosures()])
}

const historyExportColumns: ExportColumn<HistoryRow>[] = [
  { header: 'Date', value: (r) => formatDateTimeFr(r.settledAt) },
  { header: 'Réceptionniste', value: (r) => r.cashierName },
  { header: 'Montant', value: (r) => formatFcfa(r.amountFcfa) },
  { header: 'Transactions', value: (r) => r.transactionCount },
  { header: 'Gestionnaire', value: (r) => r.gestionnaireName },
  { header: 'Créneau', value: (r) => r.shiftLabel ?? '—' },
  { header: 'Commentaire', value: (r) => r.comment ?? '—' },
]

const dayClosureExportColumns: ExportColumn<DayClosureRow>[] = [
  { header: 'Date', value: (r) => r.businessDate },
  { header: 'Réceptionniste', value: (r) => r.receptionistName },
  {
    header: 'Statut',
    value: (r) => uiText(r.status === 'validated' ? 'Validée' : 'En attente'),
  },
  { header: 'Recettes', value: (r) => formatFcfa(r.collectedFcfa) },
  { header: 'Dépenses', value: (r) => formatFcfa(r.expensesFcfa) },
  { header: 'Net', value: (r) => formatFcfa(r.netFcfa) },
  { header: 'Visites', value: (r) => r.visitsToday },
  { header: 'Inscrits', value: (r) => r.registeredToday },
  { header: 'Validé par', value: (r) => r.validatedByName ?? '—' },
  { header: 'Commentaire', value: (r) => r.comment ?? '—' },
]

function localizedExportColumns<T>(columns: ExportColumn<T>[]): ExportColumn<T>[] {
  return columns.map((col) => ({ ...col, header: uiText(col.header) }))
}

function exportDayClosuresPdf() {
  if (!dayClosures.value.length) return
  exportTablePdf(
    uiText('Clôtures de journée — Réception'),
    localizedExportColumns(dayClosureExportColumns),
    dayClosures.value,
  )
}

function exportDayClosuresExcel() {
  if (!dayClosures.value.length) return
  exportTableExcel(
    uiText('Clôtures de journée — Réception'),
    localizedExportColumns(dayClosureExportColumns),
    dayClosures.value,
  )
}

function exportDayClosuresWord() {
  if (!dayClosures.value.length) return
  void exportTableWord(
    uiText('Clôtures de journée — Réception'),
    localizedExportColumns(dayClosureExportColumns),
    dayClosures.value,
  )
}

function exportHistoryPdf() {
  if (!historyRows.value.length) return
  exportTablePdf(
    uiText('Historique des décaissements'),
    localizedExportColumns(historyExportColumns),
    historyRows.value,
  )
}

function exportHistoryExcel() {
  if (!historyRows.value.length) return
  exportTableExcel(
    uiText('Historique des décaissements'),
    localizedExportColumns(historyExportColumns),
    historyRows.value,
  )
}

function exportHistoryWord() {
  if (!historyRows.value.length) return
  void exportTableWord(
    uiText('Historique des décaissements'),
    localizedExportColumns(historyExportColumns),
    historyRows.value,
  )
}

async function openHistoryView(row: HistoryRow) {
  historyTarget.value = row
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

function closeHistoryModal() {
  showHistoryModal.value = false
  historyTarget.value = null
  historyDetail.value = null
}

const historyTotalFcfa = computed(() =>
  historyRows.value.reduce((sum, row) => sum + row.amountFcfa, 0),
)

onMounted(refreshAll)
</script>

<template>
  <div class="admin-page caisse-page">
    <UiPageHeader
      title="Caisse & décaissement"
      subtitle="Validez une clôture de journée : le décaissement est créé automatiquement dans l’historique"
      :icon="Wallet"
    >
      <template #actions>
        <UiButton
          size="sm"
          variant="ghost"
          :icon="RefreshCw"
          :disabled="historyLoading || dayClosureLoading"
          @click="refreshAll"
        >
          Actualiser
        </UiButton>
      </template>
    </UiPageHeader>

    <section class="workflow-strip" :aria-label="uiText('Circuit de caisse')">
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
          <strong class="workflow-step__title">{{ uiText(item.title) }}</strong>
          <p class="workflow-step__text">{{ uiText(item.text) }}</p>
        </div>
        <ArrowRight
          v-if="index < WORKFLOW_STEPS.length - 1"
          class="workflow-step__arrow"
          :size="18"
          aria-hidden="true"
        />
      </article>
    </section>

    <div v-if="dayClosureLoading && !dayClosures.length && !historyRows.length" class="caisse-state">
      {{ uiText('Chargement…') }}
    </div>

    <template v-else>
      <section class="caisse-summary" :aria-label="uiText('Résumé')">
        <article class="summary-card summary-card--pending">
          <div class="summary-card__top">
            <span class="summary-card__label">{{ uiText('Clôtures à valider') }}</span>
            <span
              class="summary-card__badge"
              :class="dayClosurePendingCount > 0 ? 'summary-card__badge--info' : 'summary-card__badge--ok'"
            >
              {{ uiText(dayClosurePendingCount > 0 ? 'À faire' : 'À jour') }}
            </span>
          </div>
          <p class="summary-card__value">{{ dayClosurePendingCount }}</p>
          <p class="summary-card__hint">
            {{
              uiText(
                dayClosurePendingCount > 0
                  ? 'Validation = décaissement automatique'
                  : 'Aucune clôture en attente',
              )
            }}
          </p>
        </article>

        <article class="summary-card summary-card--users">
          <div class="summary-card__top">
            <span class="summary-card__label">{{ uiText('Réceptionnistes') }}</span>
            <Users :size="16" class="summary-card__icon" />
          </div>
          <p class="summary-card__value">{{ dayClosureReceptionists.length }}</p>
          <p class="summary-card__hint">{{ uiText('Filtrez par utilisateur pour voir les recettes') }}</p>
        </article>

        <article class="summary-card summary-card--history">
          <div class="summary-card__top">
            <span class="summary-card__label">{{ uiText('Décaissements') }}</span>
            <Banknote :size="16" class="summary-card__icon" />
          </div>
          <p class="summary-card__value summary-card__value--money">
            {{ formatFcfa(historyTotalFcfa) }}
          </p>
          <p class="summary-card__hint">
            {{ translateTemplate('{n} passage(s) dans l’historique filtré', { n: historyRows.length }) }}
          </p>
        </article>

        <article v-if="historyRows[0]" class="summary-card summary-card--last">
          <div class="summary-card__top">
            <span class="summary-card__label">{{ uiText('Dernier passage') }}</span>
            <History :size="16" class="summary-card__icon" />
          </div>
          <p class="summary-card__value summary-card__value--money">
            {{ formatFcfa(historyRows[0].amountFcfa) }}
          </p>
          <p class="summary-card__hint">
            {{ historyRows[0].cashierName }} → {{ historyRows[0].gestionnaireName }}
          </p>
        </article>
        <article v-else class="summary-card summary-card--last">
          <div class="summary-card__top">
            <span class="summary-card__label">{{ uiText('Dernier passage') }}</span>
            <History :size="16" class="summary-card__icon" />
          </div>
          <p class="summary-card__value summary-card__value--muted">—</p>
          <p class="summary-card__hint">{{ uiText('Validez une clôture pour créer le premier décaissement') }}</p>
        </article>
      </section>

      <section class="caisse-boards">
        <!-- ─── Clôtures de journée ─── -->
        <UiCard
          class="caisse-history caisse-board"
          title="Clôtures de journée"
          description="Validez → décaissement auto · filtre par utilisateur"
          :icon="FileCheck"
          icon-variant="green"
        >
          <div class="caisse-history__toolbar">
            <div class="caisse-history__filters">
              <UiSelect v-model="dayClosureFilterUser" label="Réceptionniste" class="caisse-history__field">
                <option value="">{{ uiText('Tous') }}</option>
                <option v-for="r in dayClosureReceptionists" :key="r.id" :value="r.id">{{ r.name }}</option>
              </UiSelect>
              <UiSelect v-model="dayClosureStatus" label="Statut" class="caisse-history__field">
                <option value="pending">{{ uiText('En attente') }}</option>
                <option value="validated">{{ uiText('Validées') }}</option>
                <option value="all">{{ uiText('Toutes') }}</option>
              </UiSelect>
              <UiInput v-model="dayClosureFrom" label="Du" type="date" class="caisse-history__field" />
              <UiInput v-model="dayClosureTo" label="Au" type="date" class="caisse-history__field" />
              <UiButton size="sm" variant="ghost" @click="loadDayClosures">Filtrer</UiButton>
            </div>
            <ExportButtons
              :disabled="dayClosureLoading || !dayClosures.length"
              @pdf="exportDayClosuresPdf"
              @excel="exportDayClosuresExcel"
              @word="exportDayClosuresWord"
            />
          </div>

          <div v-if="dayClosureLoading" class="caisse-state caisse-state--compact">{{ uiText('Chargement…') }}</div>
          <div v-else-if="!dayClosures.length" class="caisse-state caisse-state--empty">
            <FileCheck :size="28" />
            <p>{{ uiText('Aucune clôture trouvée') }}</p>
          </div>
          <div v-else class="caisse-history__table-wrap">
            <table class="caisse-history__table">
              <thead>
                <tr>
                  <th>{{ uiText('Date') }}</th>
                  <th>{{ uiText('Réceptionniste') }}</th>
                  <th>{{ uiText('Statut') }}</th>
                  <th class="col-amount">{{ uiText('Recettes') }}</th>
                  <th class="col-amount">{{ uiText('Net') }}</th>
                  <th class="col-actions"><span class="sr-only">{{ uiText('Actions') }}</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in dayClosures" :key="row.id">
                  <td>
                    <span class="caisse-history__date">{{ row.businessDate }}</span>
                    <span class="caisse-history__time">{{ timeText(row.closedAt) }}</span>
                  </td>
                  <td>{{ row.receptionistName }}</td>
                  <td>
                    <span
                      class="status-pill"
                      :class="row.status === 'validated' ? 'status-pill--ok' : 'status-pill--pending'"
                    >
                      {{ uiText(row.status === 'validated' ? 'Validée' : 'En attente') }}
                    </span>
                    <span v-if="row.validatedByName" class="caisse-history__time">
                      {{ row.validatedByName }}
                    </span>
                  </td>
                  <td class="col-amount">{{ formatFcfa(row.collectedFcfa) }}</td>
                  <td class="col-amount"><strong>{{ formatFcfa(row.netFcfa) }}</strong></td>
                  <td class="col-actions actions">
                    <GestionnaireRowActionGroup v-if="row.status === 'pending'">
                      <GestionnaireRowAction
                        :icon="CheckCircle2"
                        label="Valider"
                        variant="success"
                        show-label
                        :disabled="validatingClosureId === row.id"
                        @click="validateDayClosure(row)"
                      />
                    </GestionnaireRowActionGroup>
                    <span v-else class="validated-check" :title="uiText('Déjà validée')">
                      <CheckCircle2 :size="16" />
                    </span>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="3">
                    <strong>{{ translateTemplate('{n} clôture(s)', { n: dayClosures.length }) }}</strong>
                  </td>
                  <td class="col-amount"><strong>{{ formatFcfa(dayClosureTotalCollected) }}</strong></td>
                  <td class="col-amount"><strong>{{ formatFcfa(dayClosureTotalNet) }}</strong></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </UiCard>

        <UiCard
          class="caisse-history caisse-board"
          title="Historique des décaissements"
          description="Créés auto à la validation — réceptionniste + gestionnaire"
          :icon="History"
          icon-variant="amber"
        >
          <div class="caisse-history__toolbar">
            <div class="caisse-history__filters">
              <UiInput v-model="historyFrom" label="Du" type="date" class="caisse-history__field" />
              <UiInput v-model="historyTo" label="Au" type="date" class="caisse-history__field" />
              <UiButton size="sm" variant="ghost" @click="loadHistory">Filtrer</UiButton>
            </div>
            <div class="caisse-history__exports">
              <ExportButtons
                :disabled="historyLoading || !historyRows.length"
                @pdf="exportHistoryPdf"
                @excel="exportHistoryExcel"
                @word="exportHistoryWord"
              />
            </div>
          </div>

          <div v-if="historyLoading" class="caisse-state caisse-state--compact">{{ uiText('Chargement…') }}</div>
          <div v-else-if="!historyRows.length" class="caisse-state caisse-state--empty">
            <History :size="28" />
            <p>{{ uiText('Aucun décaissement — validez une clôture') }}</p>
          </div>
          <div v-else class="caisse-history__table-wrap">
            <table class="caisse-history__table">
              <thead>
                <tr>
                  <th>{{ uiText('Date') }}</th>
                  <th>{{ uiText('Réceptionniste') }}</th>
                  <th class="col-amount">{{ uiText('Montant') }}</th>
                  <th>{{ uiText('Gestionnaire') }}</th>
                  <th class="col-actions"><span class="sr-only">{{ uiText('Actions') }}</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in historyRows" :key="row.id">
                  <td>
                    <span class="caisse-history__date">
                      {{
                        dateText(row.settledAt, {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                        })
                      }}
                    </span>
                    <span class="caisse-history__time">{{ timeText(row.settledAt) }}</span>
                  </td>
                  <td>{{ row.cashierName }}</td>
                  <td class="col-amount">
                    <strong>{{ formatFcfa(row.amountFcfa) }}</strong>
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
                    </GestionnaireRowActionGroup>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="2">
                    <strong>{{ translateTemplate('{n} passage(s)', { n: historyRows.length }) }}</strong>
                  </td>
                  <td class="col-amount"><strong>{{ formatFcfa(historyTotalFcfa) }}</strong></td>
                  <td colspan="2" />
                </tr>
              </tfoot>
            </table>
          </div>
        </UiCard>
      </section>
    </template>

    <GestionnaireDisburseHistoryModal
      :open="showHistoryModal"
      :row="historyTarget"
      :detail="historyDetail"
      :loading="historyDetailLoading"
      @close="closeHistoryModal"
    />
  </div>
</template>

<style scoped>
.caisse-page {
  display: flex;
  flex-direction: column;
  gap: 1.15rem;
  max-width: none;
  width: 100%;
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

.caisse-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.85rem;
}

.summary-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 1rem 1.1rem;
  border-radius: 14px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #fff;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04);
  min-height: 7.5rem;
}

.summary-card--pending {
  border-color: rgba(37, 99, 235, 0.2);
  background: linear-gradient(160deg, #eff6ff, #fff);
}

.summary-card--users {
  border-color: rgba(22, 163, 74, 0.18);
  background: linear-gradient(160deg, #f0fdf4, #fff);
}

.summary-card--history {
  border-color: rgba(217, 119, 6, 0.2);
  background: linear-gradient(160deg, #fffbeb, #fff);
}

.summary-card--last {
  border-color: rgba(100, 116, 139, 0.18);
  background: linear-gradient(160deg, #f8fafc, #fff);
}

.summary-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.summary-card__label {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #64748b;
}

.summary-card__icon {
  color: #94a3b8;
  flex-shrink: 0;
}

.summary-card__badge {
  display: inline-flex;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  font-size: 0.625rem;
  font-weight: 700;
  color: #fff;
}

.summary-card__badge--info {
  background: #2563eb;
}

.summary-card__badge--ok {
  background: #16a34a;
}

.summary-card__value {
  margin: 0.15rem 0 0;
  font-size: 1.75rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #0f172a;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.summary-card__value--money {
  font-size: 1.25rem;
  color: #15803d;
}

.summary-card__value--muted {
  font-size: 1.5rem;
  color: #cbd5e1;
}

.summary-card__hint {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.4;
  color: #64748b;
}

.caisse-boards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  align-items: start;
}

.caisse-board {
  min-width: 0;
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

.caisse-history__exports {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.caisse-history__field {
  min-width: 8.5rem;
}

.caisse-history__field :deep(.ui-field) {
  margin-bottom: 0;
}

.caisse-history__table-wrap {
  border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.caisse-history__table {
  width: 100%;
  min-width: 40rem;
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
  white-space: nowrap;
}

.col-amount strong {
  color: #15803d;
}

.col-actions,
.caisse-history__table .actions {
  width: 1%;
  text-align: right;
  white-space: nowrap;
  vertical-align: middle;
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

.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
}

.status-pill--pending {
  background: rgba(37, 99, 235, 0.12);
  color: #1d4ed8;
}

.status-pill--ok {
  background: rgba(22, 163, 74, 0.12);
  color: #15803d;
}

.validated-check {
  display: inline-flex;
  color: #16a34a;
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

@media (max-width: 1280px) {
  .caisse-boards {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 1200px) {
  .caisse-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 1100px) {
  .caisse-boards {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 860px) {
  .workflow-strip {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 600px) {
  .caisse-summary {
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
