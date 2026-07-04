<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Banknote,
  CheckCircle2,
  RefreshCw,
  Sun,
  Sunset,
  Moon,
  UserRound,
  Clock,
  Wallet,
  HandCoins,
  Stethoscope,
  FlaskConical,
  Scan,
  Activity,
  Building2,
  Scissors,
  AlertTriangle,
  Info,
} from '@lucide/vue'
import { confirmAppModal } from '@/lib/api-modal-helper'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import '@/assets/comptabilite-section.css'
import {
  shiftCardLabel,
  shiftHoursLabel as formatShiftHours,
  type ShiftSlot,
} from '@/lib/cash-shift'

type CashierPerson = {
  id: string
  firstName: string
  lastName: string
  role?: string
}

type TypeBreakdownLine = {
  label: string
  count: number
  totalFcfa: number
}

type CashierPending = {
  cashier: CashierPerson
  roleLabel: string
  systemTotalFcfa: number
  expensesTotalFcfa?: number
  netTotalFcfa?: number
  expenses?: Array<{ id: string; label: string; amountFcfa: number; createdAt: string }>
  transactionCount: number
  typeBreakdown: TypeBreakdownLine[]
}

type ExistingSettlement = {
  id: string
  cashier: CashierPerson
  roleLabel: string
  accountant: { id: string; firstName: string; lastName: string }
  disbursementFcfa: number
  comment: string | null
  settledAt: string
}

type PendingSummary = {
  cashierCount: number
  settledCount: number
  pendingCashierCount: number
  pendingTotalFcfa: number
  settledTotalFcfa: number
  transactionCount: number
}

type RoleTotals = {
  receptionFcfa: number
  comptabiliteFcfa: number
  totalFcfa: number
}

type RoleGroup = {
  id: 'reception' | 'comptabilite'
  label: string
  dayTotalFcfa: number
  shiftPendingFcfa: number
  shiftSettledFcfa: number
  shiftTotalFcfa: number
  cashierCount: number
  pendingCashierCount: number
  settledCount: number
  transactionCount: number
}

type ShiftTotals = {
  pendingFcfa: number
  pendingGrossFcfa?: number
  pendingExpensesFcfa?: number
  settledFcfa: number
  totalFcfa: number
}

type DayTotals = {
  totalFcfa: number
  receptionFcfa: number
  comptabiliteFcfa: number
}

type OffShiftBucket = {
  id: string
  label: string
  totalFcfa: number
  count: number
}

type OffShiftCashierRow = {
  cashier: CashierPerson & { role?: string }
  roleLabel: string
  totalFcfa: number
  transactionCount: number
  buckets: OffShiftBucket[]
  typeBreakdown: TypeBreakdownLine[]
}

type OffShiftPanel = {
  id: string
  cashier: CashierPerson
  roleLabel: string
  isMe: boolean
  totalFcfa: number
  transactionCount: number
  buckets: OffShiftBucket[]
  typeBreakdown: TypeBreakdownLine[]
}

type DayReconciliation = {
  timezoneNote: string
  dayWindowLabel: string
  dayTotalFcfa: number
  morningWindow: { label: string; hoursLabel: string; totalFcfa: number; transactionCount: number }
  eveningWindow: { label: string; hoursLabel: string; totalFcfa: number; transactionCount: number }
  nightWindow: { label: string; hoursLabel: string; totalFcfa: number; transactionCount: number }
  offShift: {
    totalFcfa: number
    transactionCount: number
    buckets: OffShiftBucket[]
    byCashier: OffShiftCashierRow[]
    warning: string
  }
  shiftSlots: {
    morning: { pendingFcfa: number; settledFcfa: number; totalFcfa: number }
    evening: { pendingFcfa: number; settledFcfa: number; totalFcfa: number }
    night: { pendingFcfa: number; settledFcfa: number; totalFcfa: number }
  }
  formula: { description: string; partsSumFcfa: number; isBalanced: boolean }
}

type RoleSection = {
  group: RoleGroup
  panels: CashierPanel[]
  offShiftPanels: OffShiftPanel[]
}

type CashierPanel = {
  id: string
  cashier: CashierPerson
  roleLabel: string
  systemTotalFcfa: number
  expensesTotalFcfa: number
  netTotalFcfa: number
  expenses: Array<{ id: string; label: string; amountFcfa: number; createdAt: string }>
  transactionCount: number
  typeBreakdown: TypeBreakdownLine[]
  isSettled: boolean
  needsSupplement: boolean
  isMe: boolean
  pending: CashierPending | null
  settlement: ExistingSettlement | null
}

const BREAKDOWN_ICONS: Record<string, typeof Banknote> = {
  Consultations: Stethoscope,
  Laboratoire: FlaskConical,
  Radiologie: Scan,
  Échographie: Activity,
  Odontologie: UserRound,
  Opérations: Scissors,
  Hospitalisation: Building2,
}

const todayIso = new Date().toISOString().slice(0, 10)

const businessDate = ref(todayIso)
const shiftSlot = ref<ShiftSlot>('MORNING')
const loading = ref(false)
const submittingCashierId = ref<string | null>(null)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')

const cashiers = ref<CashierPending[]>([])
const settlements = ref<ExistingSettlement[]>([])
const summary = ref<PendingSummary | null>(null)
const dayTotals = ref<DayTotals | null>(null)
const shiftRoleTotals = ref<RoleTotals | null>(null)
const shiftSettledRoleTotals = ref<RoleTotals | null>(null)
const shiftTotals = ref<ShiftTotals | null>(null)
const roleGroups = ref<RoleGroup[]>([])
const dayReconciliation = ref<DayReconciliation | null>(null)
const shiftLabel = ref('')
const windowLabel = ref('')
const currentUserId = ref('')
const commentsByCashier = ref<Record<string, string>>({})

const cashierPanels = computed<CashierPanel[]>(() => {
  const panels = new Map<string, CashierPanel>()

  for (const row of cashiers.value) {
    panels.set(row.cashier.id, {
      id: row.cashier.id,
      cashier: row.cashier,
      roleLabel: row.roleLabel,
      systemTotalFcfa: row.systemTotalFcfa,
      expensesTotalFcfa: row.expensesTotalFcfa ?? 0,
      netTotalFcfa: row.netTotalFcfa ?? row.systemTotalFcfa,
      expenses: row.expenses ?? [],
      transactionCount: row.transactionCount,
      typeBreakdown: row.typeBreakdown,
      isSettled: false,
      needsSupplement: false,
      isMe: row.cashier.id === currentUserId.value,
      pending: row,
      settlement: null,
    })
  }

  for (const row of settlements.value) {
    const existing = panels.get(row.cashier.id)
    if (existing) {
      existing.isSettled = true
      existing.needsSupplement = true
      existing.settlement = row
      continue
    }
    panels.set(row.cashier.id, {
      id: row.cashier.id,
      cashier: row.cashier,
      roleLabel: row.roleLabel,
      systemTotalFcfa: row.disbursementFcfa,
      expensesTotalFcfa: 0,
      netTotalFcfa: row.disbursementFcfa,
      expenses: [],
      transactionCount: 0,
      typeBreakdown: [],
      isSettled: true,
      needsSupplement: false,
      isMe: row.cashier.id === currentUserId.value,
      pending: null,
      settlement: row,
    })
  }

  return [...panels.values()].sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? -1 : 1
    if (a.isSettled !== b.isSettled) return a.isSettled ? 1 : -1
    return `${a.cashier.lastName} ${a.cashier.firstName}`.localeCompare(
      `${b.cashier.lastName} ${b.cashier.firstName}`,
      'fr',
    )
  })
})

function isReceptionPanel(panel: CashierPanel) {
  return panel.cashier.role === 'RECEPTIONNISTE' || panel.roleLabel === 'Réception'
}

function sortPanels(panels: CashierPanel[]) {
  return [...panels].sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? -1 : 1
    if (a.isSettled !== b.isSettled) return a.isSettled ? 1 : -1
    return `${a.cashier.lastName} ${a.cashier.firstName}`.localeCompare(
      `${b.cashier.lastName} ${b.cashier.firstName}`,
      'fr',
    )
  })
}

function isReceptionOffShift(row: OffShiftCashierRow) {
  return row.cashier.role === 'RECEPTIONNISTE' || row.roleLabel === 'Réception'
}

function mapOffShiftPanels(rows: OffShiftCashierRow[]): OffShiftPanel[] {
  return rows
    .map((row) => ({
      id: `off-${row.cashier.id}`,
      cashier: row.cashier,
      roleLabel: row.roleLabel,
      isMe: row.cashier.id === currentUserId.value,
      totalFcfa: row.totalFcfa,
      transactionCount: row.transactionCount,
      buckets: row.buckets,
      typeBreakdown: row.typeBreakdown,
    }))
    .sort((a, b) => {
      if (a.isMe !== b.isMe) return a.isMe ? -1 : 1
      return `${a.cashier.lastName} ${a.cashier.firstName}`.localeCompare(
        `${b.cashier.lastName} ${b.cashier.firstName}`,
        'fr',
      )
    })
}

const roleSections = computed<RoleSection[]>(() => {
  const receptionPanels = sortPanels(cashierPanels.value.filter(isReceptionPanel))
  const offShiftRows = dayReconciliation.value?.offShift.byCashier ?? []
  const receptionOffShift = mapOffShiftPanels(offShiftRows.filter(isReceptionOffShift))

  const receptionGroup =
    roleGroups.value.find((group) => group.id === 'reception') ??
    ({
      id: 'reception' as const,
      label: 'Réception',
      dayTotalFcfa: dayTotals.value?.receptionFcfa ?? 0,
      shiftPendingFcfa: shiftRoleTotals.value?.receptionFcfa ?? 0,
      shiftSettledFcfa: shiftSettledRoleTotals.value?.receptionFcfa ?? 0,
      shiftTotalFcfa:
        (shiftRoleTotals.value?.receptionFcfa ?? 0) +
        (shiftSettledRoleTotals.value?.receptionFcfa ?? 0),
      cashierCount: receptionPanels.length,
      pendingCashierCount: receptionPanels.filter((p) => p.pending).length,
      settledCount: receptionPanels.filter((p) => p.isSettled && !p.pending).length,
      transactionCount: receptionPanels.reduce((s, p) => s + p.transactionCount, 0),
    } satisfies RoleGroup)

  return [
    {
      group: receptionGroup,
      panels: receptionPanels,
      offShiftPanels: receptionOffShift,
    },
  ]
})

function panelDisburseAmount(panel: CashierPanel) {
  return panel.pending?.netTotalFcfa ?? panel.netTotalFcfa ?? panel.systemTotalFcfa
}

function offShiftDisplayName(panel: OffShiftPanel) {
  if (panel.isMe) return 'Moi'
  return fullName(panel.cashier.firstName, panel.cashier.lastName)
}

const shiftHoursLabel = computed(() => formatShiftHours(shiftSlot.value))

function shiftLabelFor(slot: ShiftSlot) {
  return shiftCardLabel(slot)
}

const shiftSlotLabelShort = computed(() => {
  if (shiftSlot.value === 'MORNING') return 'matin'
  if (shiftSlot.value === 'EVENING') return 'soir'
  return 'nuit'
})

const currentWindowDayTotalFcfa = computed(() => {
  if (!dayReconciliation.value) return 0
  if (shiftSlot.value === 'MORNING') return dayReconciliation.value.morningWindow.totalFcfa
  if (shiftSlot.value === 'EVENING') return dayReconciliation.value.eveningWindow.totalFcfa
  return dayReconciliation.value.nightWindow?.totalFcfa ?? 0
})

function breakdownIcon(label: string) {
  return BREAKDOWN_ICONS[label] ?? Banknote
}

function cashierDisplayName(panel: CashierPanel) {
  if (panel.isMe) return 'Moi'
  return fullName(panel.cashier.firstName, panel.cashier.lastName)
}

function getComment(cashierId: string) {
  return commentsByCashier.value[cashierId] ?? ''
}

function setComment(cashierId: string, value: string) {
  commentsByCashier.value[cashierId] = value
}

function pruneComments() {
  const validIds = new Set(cashierPanels.value.filter((p) => p.pending).map((p) => p.id))
  for (const id of Object.keys(commentsByCashier.value)) {
    if (!validIds.has(id)) delete commentsByCashier.value[id]
  }
}

async function load() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<{
      cashiers: CashierPending[]
      settlements: ExistingSettlement[]
      shiftLabel: string
      windowLabel: string
      currentUserId: string
      summary: PendingSummary
      dayTotals: DayTotals
      shiftRoleTotals: RoleTotals
      shiftSettledRoleTotals: RoleTotals
      shiftTotals: ShiftTotals
      roleGroups: RoleGroup[]
      dayReconciliation: DayReconciliation
    }>('/cash-settlements/pending', {
      params: { businessDate: businessDate.value, shiftSlot: shiftSlot.value },
    })

    cashiers.value = data.cashiers
    settlements.value = data.settlements
    shiftLabel.value = data.shiftLabel
    windowLabel.value = data.windowLabel
    currentUserId.value = data.currentUserId
    summary.value = data.summary
    dayTotals.value = data.dayTotals
    shiftRoleTotals.value = data.shiftRoleTotals
    shiftSettledRoleTotals.value = data.shiftSettledRoleTotals
    shiftTotals.value = data.shiftTotals
    roleGroups.value = data.roleGroups
    dayReconciliation.value = data.dayReconciliation
    pruneComments()
  } catch {
    message.value = 'Impossible de charger les comptes caisse.'
    messageType.value = 'error'
    cashiers.value = []
    settlements.value = []
    summary.value = null
    dayTotals.value = null
    shiftRoleTotals.value = null
    shiftSettledRoleTotals.value = null
    shiftTotals.value = null
    roleGroups.value = []
    dayReconciliation.value = null
  } finally {
    loading.value = false
  }
}

async function submitDisbursement(panel: CashierPanel) {
  if (!panel.pending) return

  const ok = await confirmAppModal({
    title: 'Valider le décaissement',
    message: `Confirmer le décaissement pour ${fullName(panel.cashier.firstName, panel.cashier.lastName)} ?`,
    confirmLabel: 'Valider',
    variant: 'primary',
  })
  if (!ok) return

  submittingCashierId.value = panel.id
  message.value = ''
  try {
    const { data } = await api.post('/cash-settlements/disburse', {
      cashierId: panel.cashier.id,
      businessDate: businessDate.value,
      shiftSlot: shiftSlot.value,
      comment: getComment(panel.id).trim() || undefined,
    })
    message.value = data.message ?? 'Décaissement validé.'
    messageType.value = 'success'
    delete commentsByCashier.value[panel.id]
    await load()
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: { error?: string } } }
    message.value = apiError.response?.data?.error ?? 'Décaissement impossible.'
    messageType.value = 'error'
  } finally {
    submittingCashierId.value = null
  }
}

watch([businessDate, shiftSlot], () => {
  load()
})

load()
</script>

<template>
  <div class="cash-settlement-page">
    <section v-if="dayTotals" class="stats-grid cash-settlement-stats">
      <UiStatCard
        mini
        label="Recettes du jour"
        :value="formatFcfa(dayTotals.totalFcfa)"
        :icon="Wallet"
        variant="teal"
      />
      <UiStatCard
        mini
        :label="`Créneau ${shiftSlotLabelShort}`"
        :value="formatFcfa(shiftTotals?.totalFcfa ?? 0)"
        :icon="Clock"
        variant="blue"
      />
      <UiStatCard
        mini
        label="À décaisser"
        :value="formatFcfa(shiftTotals?.pendingFcfa ?? 0)"
        :icon="HandCoins"
        variant="amber"
      />
    </section>

    <section class="cash-settlement-page__head">
      <UiPageHeader
        title="Compte rendu caisse"
        subtitle="Décaissement des réceptionnistes par créneau"
        :icon="Banknote"
      />

      <UiAlert v-if="message" :type="messageType" :message="message" class="cash-settlement-page__alert" />

      <div class="cash-settlement-toolbar">
        <div class="toolbar-field toolbar-field--date">
          <label for="cash-business-date">Date</label>
          <input
            id="cash-business-date"
            v-model="businessDate"
            type="date"
            class="toolbar-date-input"
          />
        </div>

        <div class="toolbar-field toolbar-field--shifts">
          <span class="toolbar-field__label">Créneau</span>
          <div class="cash-settlement-shifts" role="tablist" aria-label="Créneau">
            <button
              type="button"
              role="tab"
              :aria-selected="shiftSlot === 'MORNING'"
              class="cash-shift-card"
              :class="{ 'cash-shift-card--active': shiftSlot === 'MORNING' }"
              :title="shiftSlot === 'MORNING' ? windowLabel : undefined"
              @click="shiftSlot = 'MORNING'"
            >
              <Sun :size="16" />
              <span>{{ shiftLabelFor('MORNING') }}</span>
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="shiftSlot === 'EVENING'"
              class="cash-shift-card"
              :class="{ 'cash-shift-card--active': shiftSlot === 'EVENING' }"
              :title="shiftSlot === 'EVENING' ? windowLabel : undefined"
              @click="shiftSlot = 'EVENING'"
            >
              <Sunset :size="16" />
              <span>{{ shiftLabelFor('EVENING') }}</span>
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="shiftSlot === 'NIGHT'"
              class="cash-shift-card"
              :class="{ 'cash-shift-card--active': shiftSlot === 'NIGHT' }"
              :title="shiftSlot === 'NIGHT' ? windowLabel : undefined"
              @click="shiftSlot = 'NIGHT'"
            >
              <Moon :size="16" />
              <span>{{ shiftLabelFor('NIGHT') }}</span>
            </button>
          </div>
        </div>

        <UiButton
          class="toolbar-refresh"
          variant="ghost"
          size="sm"
          :icon="RefreshCw"
          :disabled="loading"
          @click="load"
        >
          Actualiser
        </UiButton>
      </div>

      <div v-if="dayReconciliation" class="reconciliation-panel reconciliation-panel--compact">
        <header class="reconciliation-panel__head">
          <Info :size="18" />
          <div>
            <strong>Réconciliation journalière</strong>
            <p>{{ dayReconciliation.timezoneNote }}</p>
          </div>
        </header>

        <div class="reconciliation-panel__grid">
          <div class="reconciliation-line">
            <span>Matin ({{ formatShiftHours('MORNING') }})</span>
            <strong>{{ formatFcfa(dayReconciliation.morningWindow.totalFcfa) }}</strong>
            <em>{{ dayReconciliation.morningWindow.transactionCount }} enc.</em>
          </div>
          <div class="reconciliation-line">
            <span>Soir ({{ formatShiftHours('EVENING') }})</span>
            <strong>{{ formatFcfa(dayReconciliation.eveningWindow.totalFcfa) }}</strong>
            <em>{{ dayReconciliation.eveningWindow.transactionCount }} enc.</em>
          </div>
          <div class="reconciliation-line">
            <span>Nuit ({{ formatShiftHours('NIGHT') }})</span>
            <strong>{{ formatFcfa(dayReconciliation.nightWindow?.totalFcfa ?? 0) }}</strong>
            <em>{{ dayReconciliation.nightWindow?.transactionCount ?? 0 }} enc.</em>
          </div>
          <div class="reconciliation-line reconciliation-line--warn">
            <span>Hors créneau</span>
            <strong>{{ formatFcfa(dayReconciliation.offShift.totalFcfa) }}</strong>
            <em>{{ dayReconciliation.offShift.transactionCount }} enc.</em>
          </div>
          <div class="reconciliation-line reconciliation-line--total">
            <span>= Recettes du jour</span>
            <strong>{{ formatFcfa(dayReconciliation.dayTotalFcfa) }}</strong>
          </div>
        </div>

        <ul v-if="dayReconciliation.offShift.byCashier.length" class="reconciliation-cashiers">
          <li
            v-for="row in dayReconciliation.offShift.byCashier"
            :key="row.cashier.id"
            :class="{ 'reconciliation-cashiers__row--me': row.cashier.id === currentUserId }"
          >
            <div class="reconciliation-cashiers__identity">
              <strong>
                {{
                  row.cashier.id === currentUserId
                    ? 'Votre compte'
                    : fullName(row.cashier.firstName, row.cashier.lastName)
                }}
              </strong>
              <span>{{ row.roleLabel }}</span>
            </div>
            <strong class="reconciliation-cashiers__amount">{{ formatFcfa(row.totalFcfa) }}</strong>
            <div class="reconciliation-cashiers__hours">
              <span
                v-for="bucket in row.buckets"
                :key="bucket.id"
                class="reconciliation-hour-tag"
              >
                {{ bucket.label }} · {{ formatFcfa(bucket.totalFcfa) }} ({{ bucket.count }})
              </span>
            </div>
          </li>
        </ul>

        <ul v-else-if="dayReconciliation.offShift.buckets.length" class="reconciliation-buckets">
          <li v-for="bucket in dayReconciliation.offShift.buckets" :key="bucket.id">
            <span>{{ bucket.label }}</span>
            <strong>{{ formatFcfa(bucket.totalFcfa) }}</strong>
            <em>({{ bucket.count }})</em>
          </li>
        </ul>

        <p v-if="dayReconciliation.offShift.totalFcfa > 0" class="reconciliation-panel__warning">
          <AlertTriangle :size="16" />
          {{ dayReconciliation.offShift.warning }}
        </p>
      </div>
    </section>

    <section
      v-for="section in roleSections"
      :key="section.group.id"
      class="role-section"
      :class="`role-section--${section.group.id}`"
    >
      <header class="role-section__head">
        <div class="role-section__title">
          <component
            :is="section.group.id === 'reception' ? UserRound : Banknote"
            :size="22"
          />
          <div>
            <h2>{{ section.group.label }}</h2>
            <p>
              {{ section.group.cashierCount }} caissier(s) ·
              {{ section.group.transactionCount }} encaissement(s) sur le créneau
            </p>
          </div>
        </div>

        <div class="role-section__stats role-section__stats--compact">
          <div class="role-stat role-stat--pending">
            <span>À décaisser</span>
            <strong>{{ formatFcfa(section.group.shiftPendingFcfa) }}</strong>
            <em>{{ section.group.pendingCashierCount }} caissier(s)</em>
          </div>
          <div class="role-stat role-stat--settled">
            <span>Décaissé</span>
            <strong>{{ formatFcfa(section.group.shiftSettledFcfa) }}</strong>
            <em>{{ section.group.settledCount }} soldé(s)</em>
          </div>
        </div>

        <div
          v-if="section.group.cashierCount > 0"
          class="role-section__progress"
          role="progressbar"
          :aria-valuenow="section.group.settledCount"
          :aria-valuemin="0"
          :aria-valuemax="section.group.cashierCount"
        >
          <div
            class="role-section__progress-bar"
            :style="{
              width:
                section.group.cashierCount > 0
                  ? `${Math.round((section.group.settledCount / section.group.cashierCount) * 100)}%`
                  : '0%',
            }"
          />
        </div>
      </header>

      <div v-if="section.panels.length" class="cashier-panels">
        <article
          v-for="panel in section.panels"
          :key="panel.id"
          class="cashier-panel"
          :class="{ 'cashier-panel--settled': panel.isSettled && !panel.pending }"
        >
          <header class="cashier-panel__head">
            <div class="cashier-panel__identity">
              <div class="cashier-panel__avatar">
                <UserRound :size="20" />
              </div>
              <div>
                <strong>{{ cashierDisplayName(panel) }}</strong>
                <span class="cashier-panel__role">{{ panel.roleLabel }}</span>
              </div>
            </div>
            <div class="cashier-panel__total">
              <span>{{ panel.pending ? 'Net à décaisser' : 'Décaissé' }}</span>
              <strong>{{ formatFcfa(panel.pending ? panelDisburseAmount(panel) : panel.systemTotalFcfa) }}</strong>
              <em v-if="panel.pending && panel.expensesTotalFcfa">
                Brut {{ formatFcfa(panel.systemTotalFcfa) }} − dép. {{ formatFcfa(panel.expensesTotalFcfa) }}
              </em>
              <em v-else-if="panel.transactionCount">{{ panel.transactionCount }} encaissement(s)</em>
            </div>
            <CheckCircle2
              v-if="panel.isSettled && !panel.pending"
              :size="22"
              class="cashier-panel__done"
            />
          </header>

          <p v-if="panel.needsSupplement && panel.settlement" class="cashier-panel__supplement-note">
            Décaissement initial de {{ formatFcfa(panel.settlement.disbursementFcfa) }} déjà validé.
            Encaissements complémentaires du créneau (ex. après extension horaire ou encaissements tardifs).
          </p>

          <div v-if="panel.pending && panel.expenses.length" class="cashier-expenses">
            <p class="cashier-expenses__title">Dépenses du créneau</p>
            <ul>
              <li v-for="exp in panel.expenses" :key="exp.id">
                <span>{{ exp.label }}</span>
                <strong>{{ formatFcfa(exp.amountFcfa) }}</strong>
              </li>
            </ul>
          </div>

          <div v-if="panel.typeBreakdown.length" class="type-breakdown">
            <div
              v-for="line in panel.typeBreakdown"
              :key="line.label"
              class="type-breakdown__row"
            >
              <div class="type-breakdown__label">
                <component :is="breakdownIcon(line.label)" :size="16" />
                <span>{{ line.label }}</span>
                <em>{{ line.count }}</em>
              </div>
              <strong>{{ formatFcfa(line.totalFcfa) }}</strong>
            </div>
          </div>

          <p v-else-if="panel.pending" class="type-breakdown-empty">
            Aucun détail par type pour ce créneau.
          </p>

          <div v-if="panel.pending" class="cashier-panel__disburse">
            <UiInput
              :model-value="getComment(panel.id)"
              label="Commentaire"
              :placeholder="`Commentaire pour ${cashierDisplayName(panel)}…`"
              @update:model-value="setComment(panel.id, $event)"
            />
            <UiButton
              variant="primary"
              :icon="HandCoins"
              :disabled="submittingCashierId === panel.id"
              @click="submitDisbursement(panel)"
            >
              {{
                submittingCashierId === panel.id
                  ? 'Décaissement…'
                  : panel.needsSupplement
                    ? `Complément — ${formatFcfa(panelDisburseAmount(panel))}`
                    : `Décaissement — ${formatFcfa(panelDisburseAmount(panel))}`
              }}
            </UiButton>
          </div>

          <div v-else-if="panel.settlement" class="cashier-panel__settled">
            <p class="settled-summary">
              Décaissement validé le
              {{ new Date(panel.settlement.settledAt).toLocaleString('fr-FR') }}
            </p>
            <p v-if="panel.settlement.comment" class="settled-comment">{{ panel.settlement.comment }}</p>
            <p class="settled-meta">
              Par {{ fullName(panel.settlement.accountant.firstName, panel.settlement.accountant.lastName) }}
            </p>
          </div>
        </article>
      </div>

      <div v-if="section.offShiftPanels.length" class="off-shift-group">
        <header class="off-shift-group__head">
          <AlertTriangle :size="18" />
          <div>
            <h3>Hors créneau — imputé au caissier</h3>
            <p>
              Encaissements hors matin ({{ formatShiftHours('MORNING') }}), soir ({{ formatShiftHours('EVENING') }}) et nuit ({{ formatShiftHours('NIGHT') }}), rattachés à la personne qui a encaissé.
            </p>
          </div>
        </header>

        <article
          v-for="panel in section.offShiftPanels"
          :key="panel.id"
          class="cashier-panel cashier-panel--off-shift"
          :class="{ 'cashier-panel--me': panel.isMe }"
        >
          <header class="cashier-panel__head">
            <div class="cashier-panel__identity">
              <div class="cashier-panel__avatar cashier-panel__avatar--off">
                <UserRound :size="20" />
              </div>
              <div>
                <strong>{{ offShiftDisplayName(panel) }}</strong>
                <span class="cashier-panel__role">{{ panel.roleLabel }} · hors créneau</span>
              </div>
            </div>
            <div class="cashier-panel__total">
              <span>Imputé au compte</span>
              <strong>{{ formatFcfa(panel.totalFcfa) }}</strong>
              <em>{{ panel.transactionCount }} encaissement(s)</em>
            </div>
          </header>

          <div class="off-shift-hours">
            <span
              v-for="bucket in panel.buckets"
              :key="bucket.id"
              class="off-shift-hour-tag"
            >
              <Clock :size="14" />
              {{ bucket.label }}
              <strong>{{ formatFcfa(bucket.totalFcfa) }}</strong>
              <em>({{ bucket.count }})</em>
            </span>
          </div>

          <div v-if="panel.typeBreakdown.length" class="type-breakdown">
            <div
              v-for="line in panel.typeBreakdown"
              :key="line.label"
              class="type-breakdown__row"
            >
              <div class="type-breakdown__label">
                <component :is="breakdownIcon(line.label)" :size="16" />
                <span>{{ line.label }}</span>
                <em>{{ line.count }}</em>
              </div>
              <strong>{{ formatFcfa(line.totalFcfa) }}</strong>
            </div>
          </div>
        </article>
      </div>

      <p
        v-if="!section.panels.length && !section.offShiftPanels.length"
        class="role-section__empty"
      >
        Aucun encaissement {{ section.group.id === 'reception' ? 'réception' : 'comptabilité' }} pour ce créneau.
      </p>
    </section>
  </div>
</template>

<style scoped>
.cash-settlement-page {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.cash-settlement-page__alert {
  margin-bottom: 0;
}

.cash-settlement-toolbar {
  display: flex;
  align-items: flex-end;
  flex-wrap: nowrap;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: #fff;
  box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
}

.toolbar-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex-shrink: 0;
}

.toolbar-field label,
.toolbar-field__label {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  line-height: 1;
}

.toolbar-field--date {
  width: 10.5rem;
}

.toolbar-date-input {
  height: 2.375rem;
  padding: 0 0.65rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
  font-family: inherit;
  color: var(--text);
  background: #fff;
}

.toolbar-date-input:focus {
  outline: 2px solid var(--primary-200);
  border-color: var(--primary-400);
}

.toolbar-field--shifts {
  flex: 1;
  min-width: 0;
}

.cash-settlement-shifts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.cash-shift-card {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  height: 2.375rem;
  padding: 0 0.85rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--primary-200);
  background: #fff;
  color: var(--primary-700);
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.cash-shift-card:hover {
  background: var(--primary-50);
  border-color: var(--primary-300);
}

.cash-shift-card--active {
  border-color: var(--primary-200);
  background: var(--primary-50);
  color: var(--primary-800);
  box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.12);
}

.toolbar-refresh {
  flex-shrink: 0;
  margin-left: auto;
}

.reconciliation-panel--compact {
  margin-top: 0.25rem;
}

.reconciliation-panel {
  padding: 1rem 1.1rem;
  border-radius: var(--radius-md);
  border: 1px solid #fcd34d;
  background: linear-gradient(180deg, #fffbeb 0%, #fff 100%);
}

.reconciliation-panel__head {
  display: flex;
  gap: 0.65rem;
  align-items: flex-start;
  margin-bottom: 0.85rem;
  color: #92400e;
}

.reconciliation-panel__head strong {
  display: block;
  font-size: 0.9375rem;
}

.reconciliation-panel__head p {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  color: #78716c;
  line-height: 1.45;
}

.reconciliation-panel__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.reconciliation-line {
  padding: 0.6rem 0.7rem;
  border-radius: var(--radius-sm);
  background: #fff;
  border: 1px solid #e7e5e4;
}

.reconciliation-line span {
  display: block;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
}

.reconciliation-line strong {
  display: block;
  margin-top: 0.15rem;
  font-size: 0.9375rem;
}

.reconciliation-line em {
  display: block;
  margin-top: 0.1rem;
  font-style: normal;
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.reconciliation-line--warn {
  border-color: #fecaca;
  background: #fef2f2;
}

.reconciliation-line--total {
  border-color: #99f6e4;
  background: #f0fdfa;
}

.reconciliation-buckets {
  list-style: none;
  margin: 0 0 0.65rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.reconciliation-buckets li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  font-size: 0.8125rem;
  padding: 0.45rem 0.6rem;
  border-radius: var(--radius-sm);
  background: #fff;
  border: 1px dashed #fca5a5;
}

.reconciliation-buckets li strong {
  margin-left: auto;
}

.reconciliation-buckets li em {
  font-style: normal;
  color: var(--text-muted);
  font-size: 0.75rem;
}

.reconciliation-panel__warning {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  margin: 0;
  font-size: 0.8125rem;
  color: #b45309;
  line-height: 1.45;
}

.reconciliation-cashiers {
  list-style: none;
  margin: 0 0 0.65rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.reconciliation-cashiers li {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.35rem 1rem;
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-sm);
  background: #fff;
  border: 1px solid #fecaca;
}

.reconciliation-cashiers__row--me {
  border-color: #f87171;
  background: #fff1f2;
}

.reconciliation-cashiers__identity strong {
  display: block;
  font-size: 0.875rem;
}

.reconciliation-cashiers__identity span {
  font-size: 0.6875rem;
  color: var(--text-muted);
  text-transform: uppercase;
  font-weight: 700;
}

.reconciliation-cashiers__amount {
  font-size: 0.9375rem;
  color: #b91c1c;
  align-self: center;
}

.reconciliation-cashiers__hours {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.reconciliation-hour-tag {
  font-size: 0.75rem;
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

.off-shift-group {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px dashed #fca5a5;
}

.off-shift-group__head {
  display: flex;
  gap: 0.65rem;
  align-items: flex-start;
  margin-bottom: 0.85rem;
  color: #b91c1c;
}

.off-shift-group__head h3 {
  margin: 0;
  font-size: 0.9375rem;
}

.off-shift-group__head p {
  margin: 0.2rem 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
  line-height: 1.4;
}

.cashier-panel--off-shift {
  border-color: #fecaca;
  background: linear-gradient(180deg, #fff5f5 0%, #fff 100%);
  margin-bottom: 0.75rem;
}

.cashier-panel--off-shift.cashier-panel--me {
  border-color: #f87171;
  box-shadow: 0 0 0 1px #fecaca;
}

.cashier-panel__avatar--off {
  background: #fef2f2;
  color: #dc2626;
}

.off-shift-hours {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-bottom: 0.85rem;
}

.off-shift-hour-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.55rem;
  border-radius: var(--radius-sm);
  background: #fff;
  border: 1px solid #fecaca;
  font-size: 0.75rem;
  color: #7f1d1d;
}

.off-shift-hour-tag strong {
  font-size: 0.8125rem;
}

.off-shift-hour-tag em {
  font-style: normal;
  color: var(--text-muted);
}

.role-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.15rem 1.2rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: #fff;
  box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
}

.role-section--reception {
  border-top: 3px solid #3b82f6;
}

.role-section--comptabilite {
  border-top: 3px solid #d97706;
}

.role-section__head {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.role-section__title {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  color: var(--text);
}

.role-section__title h2 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
}

.role-section__title p {
  margin: 0.2rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.role-section__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.65rem;
}

.role-section__stats--compact {
  grid-template-columns: repeat(2, minmax(8rem, 12rem));
}

.role-stat {
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-sm);
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}

.role-stat span {
  display: block;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.role-stat strong {
  display: block;
  margin-top: 0.2rem;
  font-size: 1rem;
  color: var(--primary-800);
}

.role-stat em {
  display: block;
  margin-top: 0.15rem;
  font-style: normal;
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.role-stat--pending {
  background: #fffbeb;
  border-color: #fde68a;
}

.role-stat--settled {
  background: #f0fdf4;
  border-color: #bbf7d0;
}

.role-section__progress {
  height: 0.35rem;
  border-radius: 999px;
  background: #e2e8f0;
  overflow: hidden;
}

.role-section__progress-bar {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #22c55e, #16a34a);
  transition: width 0.3s ease;
}

.role-section--reception .role-section__progress-bar {
  background: linear-gradient(90deg, #60a5fa, #2563eb);
}

.role-section--comptabilite .role-section__progress-bar {
  background: linear-gradient(90deg, #fbbf24, #d97706);
}

.role-section__empty {
  margin: 0;
  padding: 1.25rem;
  text-align: center;
  font-size: 0.875rem;
  color: var(--text-muted);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  background: #f8fafc;
}

.cashier-panels {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.cashier-panel {
  padding: 1.1rem 1.15rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: #fff;
  box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
}

.cashier-panel--settled {
  border-color: #86efac;
  background: linear-gradient(180deg, #f0fdf4 0%, #fff 100%);
}

.cashier-panel__head {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.cashier-panel__identity {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex: 1;
  min-width: 12rem;
}

.cashier-panel__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 999px;
  background: var(--primary-50);
  color: var(--primary-700);
}

.cashier-panel__identity strong {
  display: block;
  font-size: 1rem;
}

.cashier-panel__role {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.cashier-panel__total {
  text-align: right;
}

.cashier-panel__total span {
  display: block;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.cashier-panel__total strong {
  display: block;
  font-size: 1.25rem;
  color: var(--primary-800);
}

.cashier-panel__total em {
  display: block;
  font-style: normal;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.cashier-expenses {
  margin-bottom: 0.85rem;
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-sm);
  background: #fff7ed;
  border: 1px solid #fed7aa;
}

.cashier-expenses__title {
  margin: 0 0 0.4rem;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #9a3412;
}

.cashier-expenses ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.cashier-expenses li {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.8125rem;
}

.cashier-expenses li strong {
  white-space: nowrap;
  color: #c2410c;
}

.cashier-panel__done {
  color: #16a34a;
  flex-shrink: 0;
}

.type-breakdown {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-bottom: 1rem;
  padding: 0.85rem;
  border-radius: var(--radius-sm);
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}

.type-breakdown__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.4rem 0;
  border-bottom: 1px dashed #e2e8f0;
}

.type-breakdown__row:last-child {
  border-bottom: none;
}

.type-breakdown__label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--text);
}

.type-breakdown__label em {
  font-style: normal;
  font-size: 0.6875rem;
  font-weight: 700;
  padding: 0.1rem 0.35rem;
  border-radius: 999px;
  background: #e2e8f0;
  color: #475569;
}

.type-breakdown__row strong {
  font-size: 0.9375rem;
  white-space: nowrap;
}

.type-breakdown-empty {
  margin: 0 0 1rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.cashier-panel__disburse {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--border);
}

.cashier-panel__supplement-note {
  margin: 0 0 0.75rem;
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-sm);
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
  font-size: 0.8125rem;
  line-height: 1.45;
}

.cashier-panel__settled {
  padding-top: 0.65rem;
  border-top: 1px dashed #bbf7d0;
}

.settled-summary {
  margin: 0 0 0.35rem;
  font-size: 0.875rem;
}

.settled-comment {
  margin: 0 0 0.35rem;
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-sm);
  background: #fff;
  border: 1px solid #bbf7d0;
  font-size: 0.875rem;
}

.settled-meta {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.empty {
  text-align: center;
  color: var(--text-light);
  padding: 2rem;
}

@media (max-width: 1024px) {
  .role-section__stats,
  .reconciliation-panel__grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .cash-settlement-toolbar {
    flex-wrap: wrap;
  }

  .toolbar-refresh {
    margin-left: 0;
  }
}

@media (max-width: 768px) {
  .role-section__stats,
  .reconciliation-panel__grid {
    grid-template-columns: 1fr;
  }

  .cash-settlement-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar-field--date {
    width: 100%;
  }

  .cash-settlement-shifts {
    flex-direction: column;
  }

  .cash-shift-card {
    width: 100%;
    justify-content: center;
  }

  .cashier-panel__total {
    width: 100%;
    text-align: left;
  }
}
</style>
