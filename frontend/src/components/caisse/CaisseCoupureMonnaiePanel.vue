<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Coins, Plus, RefreshCw, Send, Inbox, UserRound, Pencil, Save } from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal } from '@/lib/api-modal-helper'
import { formatFcfa } from '@/lib/roles'
import { DT_ICONS } from '@/lib/datatable-defaults'
import { useAuthStore } from '@/stores/auth'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import CaisseToolbar from '@/components/caisse/CaisseToolbar.vue'
import CaisseCompactDateField from '@/components/caisse/CaisseCompactDateField.vue'

type ChangeRow = {
  id: string
  amountFcfa: number
  comment: string | null
  isRefunded: boolean
  refundedAt: string | null
  requester: { id: string; fullName: string }
  provider: { id: string; fullName: string }
  refundedBy: { id: string; fullName: string } | null
  createdAt: string
}

type MySummary = {
  receivedFcfa: number
  givenFcfa: number
  netFcfa: number
  pendingReceivedFcfa: number
  pendingGivenFcfa: number
  pendingNetFcfa: number
  sentCount: number
  receivedCount: number
}

const QUICK_AMOUNTS = [500, 1000, 2000, 5000, 10000]

const auth = useAuthStore()
const todayIso = new Date().toISOString().slice(0, 10)

const businessDate = ref(todayIso)
const loading = ref(false)
const submitting = ref(false)
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')

const mySummary = ref<MySummary | null>(null)
const mySent = ref<ChangeRow[]>([])
const myReceived = ref<ChangeRow[]>([])
const cashiers = ref<Array<{ id: string; fullName: string }>>([])

const form = ref({
  colleagueId: '',
  amountFcfa: '',
  comment: '',
})

const isEditing = computed(() => editingId.value !== null)
const isToday = computed(() => businessDate.value === todayIso)

const colleagueOptions = computed(() =>
  cashiers.value
    .filter((c) => c.id !== auth.user?.id)
    .map((c) => ({ value: c.id, label: c.fullName })),
)

const formattedBusinessDate = computed(() =>
  new Date(`${businessDate.value}T12:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }),
)

const formTitle = computed(() =>
  isEditing.value ? 'Modifier l\'envoi' : 'Envoyer de la monnaie',
)

const formSubtitle = computed(() =>
  isEditing.value
    ? 'Corrigez le collègue, le montant ou le commentaire'
    : 'Patient sans monnaie — enregistrez l\'envoi chez un collègue',
)

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function mapTableRows(rows: ChangeRow[], kind: 'sent' | 'received') {
  return rows.map((row) => ({
    id: row.id,
    kind,
    isRefunded: row.isRefunded,
    time: formatTime(row.createdAt),
    timeSort: new Date(row.createdAt).getTime(),
    counterpart:
      kind === 'sent' ? row.provider.fullName : row.requester.fullName,
    comment: row.comment?.trim() || '—',
    hasComment: Boolean(row.comment?.trim()),
    amountLabel: formatFcfa(row.amountFcfa),
    amountSort: row.amountFcfa,
    statusLabel: row.isRefunded ? 'Remboursé' : 'En attente',
  }))
}

const sentTableRows = computed(() => mapTableRows(mySent.value, 'sent'))
const receivedTableRows = computed(() => mapTableRows(myReceived.value, 'received'))

function rowActionsHtml(
  id: string,
  actions: Array<'refund' | 'edit' | 'delete'>,
  isRefunded: boolean,
) {
  if (isRefunded) {
    return `<div class="dt-row-actions" data-id="${id}"><span class="dt-badge dt-badge--success">Remboursé</span></div>`
  }

  const buttons = actions
    .map((action) => {
      if (action === 'refund') {
        return `<button type="button" class="dt-btn dt-btn--icon dt-btn--catalog-on" data-action="refund" title="Rembourser" aria-label="Rembourser">${DT_ICONS.undo}</button>`
      }
      if (action === 'edit') {
        return `<button type="button" class="dt-btn dt-btn--icon dt-btn--catalog-edit" data-action="edit" title="Modifier" aria-label="Modifier">${DT_ICONS.edit}</button>`
      }
      return `<button type="button" class="dt-btn dt-btn--icon dt-btn--catalog-delete" data-action="delete" title="Supprimer" aria-label="Supprimer">${DT_ICONS.delete}</button>`
    })
    .join('')

  return `<div class="dt-row-actions" data-id="${id}">${buttons}</div>`
}

const counterpartColumn = (title: string, responsivePriority: number) => ({
  data: 'counterpart',
  title,
  responsivePriority,
  render: (name: string) => `<span class="dt-name">${name}</span>`,
})

const baseColumns = [
  {
    data: 'timeSort',
    title: 'Heure',
    responsivePriority: 2,
    className: 'dt-time-col',
    render: (_value: number, _type: string, row: { time: string }) =>
      `<span class="dt-time">${row.time}</span>`,
  },
  {
    data: 'comment',
    title: 'Commentaire',
    responsivePriority: 4,
    render: (comment: string, _type: string, row: { hasComment: boolean }) =>
      row.hasComment
        ? `<span class="dt-comment">${comment}</span>`
        : `<span class="dt-muted">${comment}</span>`,
  },
  {
    data: 'amountSort',
    title: 'Montant',
    responsivePriority: 3,
    className: 'dt-amount-col',
    render: (_value: number, _type: string, row: { amountLabel: string; isRefunded: boolean }) =>
      row.isRefunded
        ? `<span class="dt-amount dt-muted">${row.amountLabel}</span>`
        : `<strong class="dt-amount">${row.amountLabel}</strong>`,
  },
  {
    data: 'isRefunded',
    title: 'Statut',
    responsivePriority: 5,
    render: (_value: boolean, _type: string, row: { statusLabel: string; isRefunded: boolean }) =>
      row.isRefunded
        ? `<span class="dt-badge dt-badge--success">${row.statusLabel}</span>`
        : `<span class="dt-badge dt-badge--warning">${row.statusLabel}</span>`,
  },
]

const sentTableColumns = [
  baseColumns[0],
  counterpartColumn('Envoyé chez', 1),
  baseColumns[1],
  baseColumns[2],
  {
    data: null,
    title: '',
    orderable: false,
    className: 'dt-actions-col all',
    responsivePriority: 1,
    render: (_data: unknown, _type: string, row: { id: string; isRefunded: boolean }) =>
      rowActionsHtml(row.id, ['refund', 'edit', 'delete'], row.isRefunded),
  },
]

const receivedTableColumns = [
  baseColumns[0],
  counterpartColumn('Reçu de', 1),
  baseColumns[1],
  baseColumns[2],
  {
    data: null,
    title: '',
    orderable: false,
    className: 'dt-actions-col all',
    responsivePriority: 1,
    render: (_data: unknown, _type: string, row: { id: string; isRefunded: boolean }) =>
      rowActionsHtml(row.id, ['refund'], row.isRefunded),
  },
]

const tableOptions = {
  ordering: true,
  order: [[0, 'desc']] as [number, 'asc' | 'desc'][],
}

function setToday() {
  businessDate.value = todayIso
}

function setQuickAmount(amount: number) {
  form.value.amountFcfa = String(amount)
}

function resetForm() {
  form.value = { colleagueId: '', amountFcfa: '', comment: '' }
}

function openCreateModal() {
  editingId.value = null
  resetForm()
  message.value = ''
  modalOpen.value = true
}

function openEditModal(id: string) {
  const row = mySent.value.find((item) => item.id === id)
  if (!row) return
  editingId.value = id
  form.value = {
    colleagueId: row.provider.id,
    amountFcfa: String(row.amountFcfa),
    comment: row.comment ?? '',
  }
  message.value = ''
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
  editingId.value = null
  resetForm()
}

async function loadCashiers() {
  const { data } = await api.get<typeof cashiers.value>('/cash-desk/cashiers')
  cashiers.value = data
}

async function load() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<{
      mySummary: MySummary
      mySent: ChangeRow[]
      myReceived: ChangeRow[]
    }>('/cash-desk/change-transfers', { params: { businessDate: businessDate.value } })
    mySummary.value = data.mySummary
    mySent.value = data.mySent
    myReceived.value = data.myReceived
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: { error?: string } } }
    message.value =
      apiError.response?.data?.error ??
      'Impossible de charger les mouvements. Vérifiez que la base de données est à jour (npm run db:push).'
    messageType.value = 'error'
    mySummary.value = null
    mySent.value = []
    myReceived.value = []
  } finally {
    loading.value = false
  }
}

async function submit() {
  const amount = Number(form.value.amountFcfa)
  if (!form.value.colleagueId) {
    message.value = 'Sélectionnez un collègue.'
    messageType.value = 'error'
    return
  }
  if (!amount || amount <= 0) {
    message.value = 'Montant invalide.'
    messageType.value = 'error'
    return
  }

  submitting.value = true
  message.value = ''
  try {
    const payload = {
      colleagueId: form.value.colleagueId,
      amountFcfa: amount,
      comment: form.value.comment.trim() || undefined,
    }

    if (isEditing.value && editingId.value) {
      const { data } = await api.put(`/cash-desk/change-transfers/${editingId.value}`, payload)
      message.value = data.message ?? 'Mouvement modifié.'
    } else {
      const { data } = await api.post('/cash-desk/change-transfers', {
        businessDate: businessDate.value,
        ...payload,
      })
      message.value = data.message ?? 'Envoi enregistré.'
    }
    messageType.value = 'success'
    closeModal()
    await load()
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: { error?: string } } }
    message.value = apiError.response?.data?.error ?? 'Enregistrement impossible.'
    messageType.value = 'error'
  } finally {
    submitting.value = false
  }
}

async function refundRow(id: string) {
  const sent = mySent.value.find((row) => row.id === id)
  const received = myReceived.value.find((row) => row.id === id)
  const row = sent ?? received
  if (!row || row.isRefunded) return

  const label = sent
    ? `Confirmer le remboursement de ${formatFcfa(row.amountFcfa)} à ${row.provider.fullName} ?`
    : `Confirmer la réception du remboursement de ${formatFcfa(row.amountFcfa)} de ${row.requester.fullName} ?`
  const confirmed = await confirmAppModal({
    type: 'CONFIRM',
    title: 'Confirmer le remboursement',
    message: label,
    confirmLabel: 'Confirmer',
  })
  if (!confirmed) return

  try {
    const { data } = await api.post(`/cash-desk/change-transfers/${id}/refund`)
    message.value = data.message ?? 'Remboursement enregistré.'
    messageType.value = 'success'
    await load()
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: { error?: string } } }
    message.value = apiError.response?.data?.error ?? 'Remboursement impossible.'
    messageType.value = 'error'
  }
}

async function removeRow(id: string) {
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer l\'envoi',
    message: 'Supprimer cet envoi de coupure de monnaie ?',
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return
  try {
    await api.delete(`/cash-desk/change-transfers/${id}`)
    message.value = 'Mouvement supprimé.'
    messageType.value = 'success'
    await load()
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: { error?: string } } }
    message.value = apiError.response?.data?.error ?? 'Suppression impossible.'
    messageType.value = 'error'
  }
}

function onSentTableAction({ action, id }: { action: string; id: string }) {
  if (action === 'refund') refundRow(id)
  if (action === 'edit') openEditModal(id)
  if (action === 'delete') removeRow(id)
}

function onReceivedTableAction({ action, id }: { action: string; id: string }) {
  if (action === 'refund') refundRow(id)
}

watch(businessDate, () => load())

onMounted(async () => {
  await loadCashiers()
  await load()
})
</script>

<template>
  <div class="caisse-page">
    <UiPageHeader
      title="Coupure de monnaie"
      subtitle="Enregistrez vos envois de monnaie et consultez ce que vos collègues vous ont transmis"
      :icon="Coins"
    >
      <template #actions>
        <UiButton variant="primary" :icon="Plus" @click="openCreateModal">
          Envoyer de la monnaie
        </UiButton>
      </template>
    </UiPageHeader>

    <UiAlert v-if="message && !modalOpen" :type="messageType" :message="message" />

    <CaisseToolbar>
      <CaisseCompactDateField v-model="businessDate" />
      <button
        type="button"
        class="change-toolbar__chip"
        :class="{ 'change-toolbar__chip--active': isToday }"
        @click="setToday"
      >
        Aujourd'hui
      </button>
      <UiButton
        variant="ghost"
        size="sm"
        class="caisse-toolbar__refresh"
        :icon="RefreshCw"
        :disabled="loading"
        @click="load"
      >
        Actualiser
      </UiButton>
    </CaisseToolbar>

    <div v-if="mySummary" class="stats-grid">
      <UiStatCard
        label="J'ai envoyé"
        :value="formatFcfa(mySummary.givenFcfa)"
        :icon="Send"
        variant="amber"
        :trend="`${mySummary.sentCount} envoi(s)`"
      />
      <UiStatCard
        label="On m'a envoyé"
        :value="formatFcfa(mySummary.receivedFcfa)"
        :icon="Inbox"
        variant="teal"
        :trend="`${mySummary.receivedCount} réception(s)`"
      />
      <UiStatCard
        label="Solde net"
        :value="formatFcfa(mySummary.pendingNetFcfa)"
        :icon="UserRound"
        :variant="mySummary.pendingNetFcfa >= 0 ? 'green' : 'amber'"
        trend="En attente de remboursement"
      />
    </div>

    <div class="lists-grid">
      <UiCard
        title="J'ai envoyé"
        :description="`Vos envois du ${formattedBusinessDate}`"
        class="ui-card--table-panel change-table-card"
        :icon="Send"
        icon-variant="amber"
      >
        <p v-if="!mySent.length && !loading" class="empty">
          Aucun envoi pour cette date. Cliquez sur « Envoyer de la monnaie ».
        </p>
        <UiDataTable
          v-else
          fill
          compact
          table-key="caisse-change-sent"
          :data="sentTableRows"
          :columns="sentTableColumns"
          :options="tableOptions"
          :loading="loading"
          loading-label="Chargement des envois…"
          @action="onSentTableAction"
        />
      </UiCard>

      <UiCard
        title="On m'a envoyé"
        :description="`Réceptions du ${formattedBusinessDate}`"
        class="ui-card--table-panel change-table-card change-table-card--in"
        :icon="Inbox"
        icon-variant="teal"
      >
        <p v-if="!myReceived.length && !loading" class="empty">
          Aucun collègue ne vous a encore envoyé de monnaie pour cette date.
        </p>
        <UiDataTable
          v-else
          fill
          compact
          table-key="caisse-change-received"
          :data="receivedTableRows"
          :columns="receivedTableColumns"
          :options="tableOptions"
          :loading="loading"
          loading-label="Chargement des réceptions…"
          @action="onReceivedTableAction"
        />
      </UiCard>
    </div>

    <UiFormModal
      v-if="modalOpen"
      title-id="change-modal-title"
      :title="formTitle"
      :subtitle="formSubtitle"
      :icon="isEditing ? Pencil : Send"
      @close="closeModal"
    >
      <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />
      <form class="modal-form" @submit.prevent="submit">
        <UiSelect v-model="form.colleagueId" label="Envoyé chez" required>
          <option value="" disabled>Choisir un collègue…</option>
          <option v-for="opt in colleagueOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </UiSelect>
        <UiInput
          v-model="form.amountFcfa"
          label="Montant de monnaie (FCFA)"
          type="number"
          min="1"
          required
        />
        <div class="quick-amounts">
          <span class="quick-amounts__label">Montants rapides</span>
          <div class="quick-amounts__chips">
            <button
              v-for="amount in QUICK_AMOUNTS"
              :key="amount"
              type="button"
              class="quick-amounts__chip"
              :class="{ 'quick-amounts__chip--active': Number(form.amountFcfa) === amount }"
              @click="setQuickAmount(amount)"
            >
              {{ formatFcfa(amount) }}
            </button>
          </div>
        </div>
        <UiInput
          v-model="form.comment"
          label="Commentaire (optionnel)"
          placeholder="Ex. billet 10 000, monnaie 3 000"
        />
      </form>

      <template #footer>
        <UiButton variant="ghost" @click="closeModal">Annuler</UiButton>
        <UiButton
          variant="primary"
          :icon="isEditing ? Save : Send"
          :disabled="submitting || !colleagueOptions.length"
          @click="submit"
        >
          {{ submitting ? 'Enregistrement…' : 'Enregistrer' }}
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.caisse-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.caisse-toolbar__refresh {
  min-height: 2.25rem;
  align-self: center;
}

.change-toolbar__chip {
  min-height: 2.25rem;
  padding: 0 0.75rem;
  border-radius: 8px;
  border: 1px solid transparent;
  background: #fff;
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.change-toolbar__chip:hover {
  border-color: var(--border);
  color: var(--text);
}

.change-toolbar__chip--active {
  background: #ecfdf5;
  border-color: #6ee7b7;
  color: #047857;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
}

.lists-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}

.change-table-card {
  min-height: 0;
}

.change-table-card--in :deep(.ui-card__header) {
  border-bottom-color: #99f6e4;
}

.modal-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.quick-amounts {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.quick-amounts__label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-muted);
}

.quick-amounts__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.quick-amounts__chip {
  padding: 0.35rem 0.65rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: #fff;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
}

.quick-amounts__chip:hover {
  border-color: #f59e0b;
  color: #92400e;
}

.quick-amounts__chip--active {
  background: #fff8eb;
  border-color: #f59e0b;
  color: #92400e;
}

.empty {
  margin: 0;
  text-align: center;
  color: var(--text-muted);
  padding: 1.25rem;
  font-size: 0.875rem;
  line-height: 1.5;
}

@media (max-width: 900px) {
  .stats-grid,
  .lists-grid {
    grid-template-columns: 1fr;
  }
}
</style>
