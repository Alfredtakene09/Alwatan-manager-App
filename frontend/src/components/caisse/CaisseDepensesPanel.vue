<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Receipt, Plus, RefreshCw, Eye, Pencil, Save } from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal } from '@/lib/api-modal-helper'
import { formatFcfa } from '@/lib/roles'
import { DT_ICONS } from '@/lib/datatable-defaults'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

const props = withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    /** Incrémenté quand la liste des indices change (onglet gestion). */
    indicesVersion?: number
    showHeader?: boolean
    showDateFilter?: boolean
    businessDate?: string
  }>(),
  {
    showHeader: true,
    showDateFilter: true,
  },
)

const emit = defineEmits<{
  'update:businessDate': [value: string]
}>()

const todayIso = new Date().toISOString().slice(0, 10)

const internalBusinessDate = ref(todayIso)

const businessDate = computed({
  get: () => props.businessDate ?? internalBusinessDate.value,
  set: (value: string) => {
    if (props.businessDate !== undefined) {
      emit('update:businessDate', value)
    } else {
      internalBusinessDate.value = value
    }
  },
})
const loading = ref(false)
const submitting = ref(false)
const modalOpen = ref(false)
const viewModalOpen = ref(false)
const editingId = ref<string | null>(null)
const viewExpense = ref<ExpenseRow | null>(null)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')

type ExpenseRow = {
  id: string
  amountFcfa: number
  label: string
  comment: string | null
  createdAt: string
}

const totalFcfa = ref(0)
const rows = ref<ExpenseRow[]>([])

const indices = ref<Array<{ id: string; name: string; description: string | null }>>([])

const form = ref({
  indiceId: '',
  label: '',
  amountFcfa: '',
  comment: '',
})

const indiceOptions = computed(() => [
  { value: '', label: '— Choisir un indice (optionnel) —' },
  ...indices.value.map((item) => ({ value: item.id, label: item.name })),
])

const formattedBusinessDate = computed(() =>
  new Date(`${businessDate.value}T12:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }),
)

const expenseCountLabel = computed(() => {
  const n = rows.value.length
  return n === 0 ? 'Aucune dépense' : `${n} dépense${n > 1 ? 's' : ''}`
})

const isEditing = computed(() => editingId.value !== null)

const expenseFormTitle = computed(() =>
  isEditing.value ? 'Modifier la dépense' : 'Nouvelle dépense',
)

const expenseFormSubtitle = computed(() =>
  isEditing.value
    ? 'Corrigez le libellé, le montant ou le commentaire'
    : "Enregistrement d'une dépense clinique payée en caisse",
)

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

const viewExpenseTime = computed(() =>
  viewExpense.value ? formatTime(viewExpense.value.createdAt) : '',
)

const tableRows = computed(() =>
  rows.value.map((row) => ({
    id: row.id,
    time: formatTime(row.createdAt),
    timeSort: new Date(row.createdAt).getTime(),
    label: row.label,
    comment: row.comment?.trim() || '—',
    hasComment: Boolean(row.comment?.trim()),
    amountLabel: formatFcfa(row.amountFcfa),
    amountSort: row.amountFcfa,
  })),
)

const tableColumns = [
  {
    data: 'timeSort',
    title: 'Heure',
    responsivePriority: 2,
    className: 'dt-time-col',
    render: (_value: number, _type: string, row: { time: string }) =>
      `<span class="dt-time">${row.time}</span>`,
  },
  {
    data: 'label',
    title: 'Libellé',
    responsivePriority: 1,
    render: (label: string) => `<span class="dt-name">${label}</span>`,
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
    render: (_value: number, _type: string, row: { amountLabel: string }) =>
      `<strong class="dt-amount">${row.amountLabel}</strong>`,
  },
  {
    data: null,
    title: '',
    orderable: false,
    className: 'dt-actions-col all',
    responsivePriority: 1,
    render: (_data: unknown, _type: string, row: { id: string }) => `
      <div class="dt-row-actions" data-id="${row.id}">
        <button type="button" class="dt-btn dt-btn--icon dt-btn--icon-soft" data-action="view" title="Voir" aria-label="Voir">${DT_ICONS.view}</button>
        <button type="button" class="dt-btn dt-btn--icon dt-btn--catalog-edit" data-action="edit" title="Modifier" aria-label="Modifier">${DT_ICONS.edit}</button>
        <button type="button" class="dt-btn dt-btn--icon dt-btn--catalog-delete" data-action="delete" title="Supprimer" aria-label="Supprimer">${DT_ICONS.delete}</button>
      </div>
    `,
  },
]

const tableOptions = {
  ordering: true,
  order: [[0, 'desc']] as [number, 'asc' | 'desc'][],
}

async function loadIndices() {
  try {
    const { data } = await api.get<
      Array<{ id: string; name: string; description: string | null; active: boolean }>
    >('/cash-desk/expense-indices')
    indices.value = data.filter((item) => item.active)
  } catch {
    indices.value = []
  }
}

function applySelectedIndice() {
  if (!form.value.indiceId) return
  const selected = indices.value.find((item) => item.id === form.value.indiceId)
  if (!selected) return
  form.value.comment = selected.description ?? ''
}

async function load() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<{
      totalFcfa: number
      rows: typeof rows.value
    }>('/cash-desk/expenses', { params: { businessDate: businessDate.value } })
    rows.value = data.rows
    totalFcfa.value = data.totalFcfa
  } catch {
    message.value = 'Impossible de charger les dépenses.'
    messageType.value = 'error'
    rows.value = []
    totalFcfa.value = 0
  } finally {
    loading.value = false
  }
}

function resetForm() {
  form.value.indiceId = ''
  form.value.label = ''
  form.value.amountFcfa = ''
  form.value.comment = ''
}

function openCreateModal() {
  editingId.value = null
  resetForm()
  message.value = ''
  modalOpen.value = true
}

function openEditModal(id: string) {
  const row = rows.value.find((item) => item.id === id)
  if (!row) return
  editingId.value = id
  form.value = {
    indiceId: '',
    label: row.label,
    amountFcfa: String(row.amountFcfa),
    comment: row.comment ?? '',
  }
  message.value = ''
  modalOpen.value = true
}

function openViewModal(id: string) {
  viewExpense.value = rows.value.find((item) => item.id === id) ?? null
  if (!viewExpense.value) return
  viewModalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
  editingId.value = null
  resetForm()
}

function closeViewModal() {
  viewModalOpen.value = false
  viewExpense.value = null
}

async function submit() {
  const amount = Number(form.value.amountFcfa)
  if (!form.value.label.trim() || !amount || amount <= 0) {
    message.value = 'Renseignez le libellé et un montant valide.'
    messageType.value = 'error'
    return
  }

  submitting.value = true
  message.value = ''
  try {
    const payload = {
      label: form.value.label.trim(),
      amountFcfa: amount,
      comment: form.value.comment.trim() || undefined,
    }

    if (isEditing.value && editingId.value) {
      const { data } = await api.put(`/cash-desk/expenses/${editingId.value}`, payload)
      message.value = data.message ?? 'Dépense modifiée.'
    } else {
      const { data } = await api.post('/cash-desk/expenses', {
        businessDate: businessDate.value,
        ...payload,
      })
      message.value = data.message ?? 'Dépense enregistrée.'
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

async function removeRow(id: string) {
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer la dépense',
    message: 'Supprimer cette dépense ? Cette action est irréversible.',
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return
  try {
    await api.delete(`/cash-desk/expenses/${id}`)
    message.value = 'Dépense supprimée.'
    messageType.value = 'success'
    await load()
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: { error?: string } } }
    message.value = apiError.response?.data?.error ?? 'Suppression impossible.'
    messageType.value = 'error'
  }
}

function onTableAction({ action, id }: { action: string; id: string }) {
  if (action === 'view') openViewModal(id)
  if (action === 'edit') openEditModal(id)
  if (action === 'delete') removeRow(id)
}

watch(businessDate, () => load())
watch(() => props.indicesVersion, () => loadIndices())
watch(() => form.value.indiceId, applySelectedIndice)

onMounted(async () => {
  await loadIndices()
  await load()
})
</script>

<template>
  <div class="caisse-page">
    <UiPageHeader
      v-if="showHeader"
      :title="title ?? 'Dépenses'"
      :subtitle="subtitle ?? 'Dépenses de la clinique payées en caisse (réception ou comptabilité)'"
      :icon="Receipt"
    />

    <UiAlert v-if="message && !modalOpen && !viewModalOpen" :type="messageType" :message="message" />

    <div v-if="showDateFilter" class="caisse-filters">
      <UiInput v-model="businessDate" label="Date" type="date" />
    </div>

    <UiCard
      title="Dépenses du jour"
      :description="`Liste des dépenses enregistrées pour le ${formattedBusinessDate}`"
      class="ui-card--table-panel expense-table-card"
      :icon="Receipt"
      icon-variant="blue"
    >
      <template #actions>
        <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="load">
          Actualiser
        </UiButton>
        <UiButton variant="primary" size="sm" :icon="Plus" @click="openCreateModal">
          Nouvelle dépense
        </UiButton>
      </template>

      <p v-if="!rows.length && !loading" class="empty">
        Aucune dépense pour cette date. Cliquez sur « Nouvelle dépense » pour enregistrer une sortie de caisse.
      </p>

      <template v-else>
        <div class="expense-table-summary">
          <span>{{ expenseCountLabel }}</span>
          <strong>Total du jour : {{ formatFcfa(totalFcfa) }}</strong>
        </div>

        <UiDataTable
          fill
          compact
          table-key="caisse-depenses-jour"
          :data="tableRows"
          :columns="tableColumns"
          :options="tableOptions"
          :loading="loading"
          loading-label="Chargement des dépenses…"
          @action="onTableAction"
        />
      </template>
    </UiCard>

    <UiFormModal
      v-if="viewModalOpen && viewExpense"
      title-id="expense-view-modal-title"
      title="Détail de la dépense"
      :subtitle="viewExpense.label"
      :icon="Eye"
      @close="closeViewModal"
    >
      <dl class="expense-detail">
        <div class="expense-detail__row">
          <dt>Date</dt>
          <dd>{{ formattedBusinessDate }}</dd>
        </div>
        <div class="expense-detail__row">
          <dt>Heure</dt>
          <dd>{{ viewExpenseTime }}</dd>
        </div>
        <div class="expense-detail__row">
          <dt>Libellé</dt>
          <dd>{{ viewExpense.label }}</dd>
        </div>
        <div class="expense-detail__row">
          <dt>Montant</dt>
          <dd class="expense-detail__amount">{{ formatFcfa(viewExpense.amountFcfa) }}</dd>
        </div>
        <div class="expense-detail__row">
          <dt>Commentaire</dt>
          <dd>{{ viewExpense.comment?.trim() || '—' }}</dd>
        </div>
      </dl>
      <template #footer>
        <UiButton variant="ghost" @click="closeViewModal">Fermer</UiButton>
        <UiButton
          variant="primary"
          :icon="Pencil"
          @click="closeViewModal(); openEditModal(viewExpense.id)"
        >
          Modifier
        </UiButton>
      </template>
    </UiFormModal>

    <UiFormModal
      v-if="modalOpen"
      title-id="expense-modal-title"
      :title="expenseFormTitle"
      :subtitle="expenseFormSubtitle"
      :icon="isEditing ? Pencil : Plus"
      @close="closeModal"
    >
      <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />
      <form class="expense-form" @submit.prevent="submit">
        <UiSelect
          v-if="!isEditing"
          v-model="form.indiceId"
          label="Indice / motif"
          class="expense-form__full"
        >
          <option v-for="opt in indiceOptions" :key="opt.value || 'empty'" :value="opt.value">
            {{ opt.label }}
          </option>
        </UiSelect>
        <UiInput
          v-model="form.label"
          label="Libellé"
          placeholder="Ex. Achat produits d'entretien"
          required
          class="expense-form__full"
        />
        <UiInput
          v-model="form.amountFcfa"
          label="Montant (FCFA)"
          type="number"
          min="1"
          required
          class="expense-form__full"
        />
        <UiInput
          v-model="form.comment"
          label="Commentaire"
          placeholder="Détail optionnel…"
          class="expense-form__full"
        />
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="closeModal">Annuler</UiButton>
        <UiButton
          variant="primary"
          :icon="isEditing ? Save : Plus"
          :disabled="submitting"
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

.caisse-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
}

.expense-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.expense-form__full {
  grid-column: 1 / -1;
}

.expense-table-card {
  min-height: 0;
}

.expense-table-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: var(--radius-sm);
  background: linear-gradient(135deg, #fff8eb 0%, #fff3d6 100%);
  border: 1px solid rgba(245, 158, 11, 0.25);
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.expense-table-summary strong {
  font-size: 0.9375rem;
  color: #92400e;
}

.expense-detail {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0;
}

.expense-detail__row {
  display: grid;
  grid-template-columns: minmax(7rem, 9rem) 1fr;
  gap: 0.75rem;
  align-items: start;
}

.expense-detail__row dt {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.expense-detail__row dd {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--text);
  line-height: 1.45;
}

.expense-detail__amount {
  font-weight: 700;
  color: #92400e;
}

.empty {
  margin: 0;
  text-align: center;
  color: var(--text-muted);
  padding: 2rem 1rem;
  font-size: 0.875rem;
  line-height: 1.5;
}
</style>
