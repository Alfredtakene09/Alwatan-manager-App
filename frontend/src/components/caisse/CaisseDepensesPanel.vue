<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Receipt, Plus, RefreshCw, Eye, Pencil, Save } from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal } from '@/lib/api-modal-helper'
import { formatFcfa } from '@/lib/roles'
import { DT_ICONS } from '@/lib/datatable-defaults'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import { exportTableExcel, exportTablePdf, type ExportColumn } from '@/lib/table-export'
import type { ExpenseIndiceOption } from '@/lib/expense-indices'
import { fetchExpenseIndices, toActiveIndiceOptions } from '@/lib/expense-indices'

const props = withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    /** Indices actifs partagés depuis la page parente. */
    activeIndices?: ExpenseIndiceOption[]
    listFilter?: 'all' | 'month' | 'range'
    showHeader?: boolean
    showDateFilter?: boolean
    /** Réception : masquer la dépense au lieu de la supprimer définitivement. */
    deactivateMode?: boolean
    /** La synthèse est affichée par la page parente (barre d'outils). */
    externalSummary?: boolean
    businessDateFrom?: string
    businessDateTo?: string
  }>(),
  {
    showHeader: true,
    showDateFilter: true,
    listFilter: 'all',
    deactivateMode: false,
    externalSummary: false,
  },
)

type ExpenseSummaryPayload = {
  countLabel: string
  totalLabel: string
  totalFcfa: number
  show: boolean
}

const emit = defineEmits<{
  'update:businessDateFrom': [value: string]
  'update:businessDateTo': [value: string]
  'summary-update': [payload: ExpenseSummaryPayload]
}>()

const { uiText, t, localeCode, isArabic } = useAppI18n()
const dateLocale = computed(() => (isArabic.value ? 'ar-TD' : 'fr-FR'))

const todayIso = new Date().toISOString().slice(0, 10)

const internalBusinessDateFrom = ref(todayIso)
const internalBusinessDateTo = ref(todayIso)

const dateFrom = computed({
  get: () => props.businessDateFrom ?? internalBusinessDateFrom.value,
  set: (value: string) => {
    if (props.businessDateFrom !== undefined) {
      emit('update:businessDateFrom', value)
    } else {
      internalBusinessDateFrom.value = value
    }
  },
})

const dateTo = computed({
  get: () => props.businessDateTo ?? internalBusinessDateTo.value,
  set: (value: string) => {
    if (props.businessDateTo !== undefined) {
      emit('update:businessDateTo', value)
    } else {
      internalBusinessDateTo.value = value
    }
  },
})

const expenseBusinessDate = computed(() => dateTo.value)
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

const internalIndices = ref<ExpenseIndiceOption[]>([])

const indices = computed(() => props.activeIndices ?? internalIndices.value)

const form = ref({
  indiceId: '',
  label: '',
  amountFcfa: '',
  comment: '',
})

const indiceOptions = computed(() => [
  { value: '', label: uiText('— Sélectionner un indice —') },
  ...indices.value.map((item) => ({ value: item.id, label: item.name })),
])

function formatDisplayDate(iso: string) {
  void localeCode.value
  return new Date(`${iso}T12:00:00`).toLocaleDateString(dateLocale.value, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

const formattedBusinessDate = computed(() => {
  void localeCode.value
  if (dateFrom.value === dateTo.value) return formatDisplayDate(dateFrom.value)
  const fromLabel = new Date(`${dateFrom.value}T12:00:00`).toLocaleDateString(dateLocale.value)
  const toLabel = new Date(`${dateTo.value}T12:00:00`).toLocaleDateString(dateLocale.value)
  return translateTemplate('du {from} au {to}', { from: fromLabel, to: toLabel })
})

const expenseListTitle = computed(() => {
  void localeCode.value
  if (props.listFilter === 'all') return uiText('Toutes les dépenses')
  if (props.listFilter === 'month') return uiText('Dépenses du mois')
  return dateFrom.value === dateTo.value
    ? uiText('Dépenses du jour')
    : uiText('Dépenses de la période')
})

const formattedPeriodLabel = computed(() => {
  void localeCode.value
  if (props.listFilter === 'all') return uiText('toutes les périodes')
  if (props.listFilter === 'month') {
    const now = new Date()
    return now.toLocaleDateString(dateLocale.value, { month: 'long', year: 'numeric' })
  }
  return formattedBusinessDate.value
})

const expenseListDescription = computed(() =>
  translateTemplate('Liste des dépenses enregistrées pour {period}', {
    period: formattedPeriodLabel.value,
  }),
)

const expenseCountLabel = computed(() => {
  void localeCode.value
  const n = rows.value.length
  if (n === 0) return uiText('Aucune dépense')
  return n === 1
    ? translateTemplate('{n} dépense', { n })
    : translateTemplate('{n} dépenses', { n })
})

const totalLabel = computed(() => {
  void localeCode.value
  if (props.listFilter === 'all') return uiText('Total')
  if (props.listFilter === 'month') return uiText('Total du mois')
  if (dateFrom.value !== dateTo.value) return uiText('Total de la période')
  return uiText('Total du jour')
})

const removeActionLabel = computed(() =>
  props.deactivateMode ? uiText('Désactiver') : uiText('Supprimer'),
)

const removeActionIcon = computed(() => (props.deactivateMode ? DT_ICONS.ban : DT_ICONS.delete))

const removeActionClass = computed(() =>
  props.deactivateMode ? 'dt-btn--catalog-off' : 'dt-btn--catalog-delete',
)

function emitSummary() {
  if (!props.externalSummary) return
  emit('summary-update', {
    countLabel: expenseCountLabel.value,
    totalLabel: totalLabel.value,
    totalFcfa: totalFcfa.value,
    show: rows.value.length > 0 || loading.value,
  })
}

const isEditing = computed(() => editingId.value !== null)

const expenseFormTitle = computed(() =>
  isEditing.value ? uiText('Modifier la dépense') : uiText('Nouvelle dépense'),
)

const expenseFormSubtitle = computed(() =>
  isEditing.value
    ? uiText('Corrigez le libellé, le montant ou le commentaire')
    : uiText("Enregistrement d'une dépense clinique payée en caisse"),
)

function formatTime(iso: string) {
  void localeCode.value
  return new Date(iso).toLocaleTimeString(dateLocale.value, { hour: '2-digit', minute: '2-digit' })
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

const tableColumns = computed(() => {
  void localeCode.value
  const viewLabel = uiText('Voir')
  const editLabel = uiText('Modifier')
  const removeLabel = removeActionLabel.value
  return [
  {
    data: 'timeSort',
    title: uiText('Heure'),
    responsivePriority: 2,
    className: 'dt-time-col',
    render: (_value: number, _type: string, row: { time: string }) =>
      `<span class="dt-time">${row.time}</span>`,
  },
  {
    data: 'label',
    title: uiText('Libellé'),
    responsivePriority: 1,
    render: (label: string) => `<span class="dt-name">${label}</span>`,
  },
  {
    data: 'comment',
    title: uiText('Commentaire'),
    responsivePriority: 4,
    render: (comment: string, _type: string, row: { hasComment: boolean }) =>
      row.hasComment
        ? `<span class="dt-comment">${comment}</span>`
        : `<span class="dt-muted">${comment}</span>`,
  },
  {
    data: 'amountSort',
    title: uiText('Montant'),
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
        <button type="button" class="dt-btn dt-btn--icon dt-btn--icon-soft" data-action="view" title="${viewLabel}" aria-label="${viewLabel}">${DT_ICONS.view}</button>
        <button type="button" class="dt-btn dt-btn--icon dt-btn--catalog-edit" data-action="edit" title="${editLabel}" aria-label="${editLabel}">${DT_ICONS.edit}</button>
        <button type="button" class="dt-btn dt-btn--icon ${removeActionClass.value}" data-action="delete" title="${removeLabel}" aria-label="${removeLabel}">${removeActionIcon.value}</button>
      </div>
    `,
  },
]
})

const tableOptions = {
  ordering: true,
  order: [[0, 'desc']] as [number, 'asc' | 'desc'][],
}

type ExpenseExportRow = (typeof tableRows.value)[number]

const expenseExportColumns = computed<ExportColumn<ExpenseExportRow>[]>(() => {
  void localeCode.value
  return [
    { header: uiText('Heure'), value: (r) => r.time },
    { header: uiText('Libellé'), value: (r) => r.label },
    { header: uiText('Commentaire'), value: (r) => r.comment },
    { header: uiText('Montant'), value: (r) => r.amountLabel },
  ]
})

function exportPdf() {
  exportTablePdf(expenseListTitle.value, expenseExportColumns.value, tableRows.value, {
    captionRows: [
      { label: uiText('Période'), value: formattedPeriodLabel.value },
      { label: totalLabel.value, value: formatFcfa(totalFcfa.value) },
    ],
  })
}

function exportExcel() {
  exportTableExcel(expenseListTitle.value, expenseExportColumns.value, tableRows.value)
}

async function loadIndices() {
  if (props.activeIndices) return
  try {
    const data = await fetchExpenseIndices()
    internalIndices.value = toActiveIndiceOptions(data)
  } catch {
    internalIndices.value = []
  }
}

function applySelectedIndice() {
  if (!form.value.indiceId) return
  const selected = indices.value.find((item) => item.id === form.value.indiceId)
  if (!selected) return
  form.value.label = selected.name
  if (!form.value.comment.trim()) {
    form.value.comment = selected.description ?? ''
  }
}

async function load() {
  loading.value = true
  message.value = ''
  try {
    const params =
      props.listFilter === 'all'
        ? { filter: 'all' }
        : props.listFilter === 'month'
          ? { filter: 'month' }
          : { from: dateFrom.value, to: dateTo.value }
    const { data } = await api.get<{
      totalFcfa: number
      rows: typeof rows.value
    }>('/cash-desk/expenses', { params })
    rows.value = data.rows
    totalFcfa.value = data.totalFcfa
  } catch {
    message.value = uiText('Impossible de charger les dépenses.')
    messageType.value = 'error'
    rows.value = []
    totalFcfa.value = 0
  } finally {
    loading.value = false
    emitSummary()
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
  const selected = indices.value.find((item) => item.id === form.value.indiceId)
  const label = isEditing.value
    ? form.value.label.trim()
    : (selected?.name ?? form.value.label.trim())
  if ((!isEditing.value && !form.value.indiceId) || !label || !amount || amount <= 0) {
    message.value = uiText('Sélectionnez un indice et renseignez un montant valide.')
    messageType.value = 'error'
    return
  }

  submitting.value = true
  message.value = ''
  try {
    const payload = {
      label,
      amountFcfa: amount,
      comment: form.value.comment.trim() || undefined,
    }

    if (isEditing.value && editingId.value) {
      const { data } = await api.put(`/cash-desk/expenses/${editingId.value}`, payload)
      message.value = data.message ?? uiText('Dépense modifiée.')
    } else {
      const { data } = await api.post('/cash-desk/expenses', {
        businessDate: expenseBusinessDate.value,
        ...payload,
      })
      message.value = data.message ?? uiText('Dépense enregistrée.')
    }
    messageType.value = 'success'
    closeModal()
    await load()
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: { error?: string } } }
    message.value = apiError.response?.data?.error ?? uiText('Enregistrement impossible.')
    messageType.value = 'error'
  } finally {
    submitting.value = false
  }
}

async function removeRow(id: string) {
  const confirmed = await confirmAppModal({
    type: props.deactivateMode ? 'CONFIRM' : 'DELETE',
    title: props.deactivateMode
      ? uiText('Désactiver la dépense')
      : uiText('Supprimer la dépense'),
    message: props.deactivateMode
      ? uiText('Désactiver cette dépense ? Elle ne sera plus visible dans la liste du jour.')
      : uiText('Supprimer cette dépense ? Cette action est irréversible.'),
    confirmLabel: props.deactivateMode ? uiText('Désactiver') : uiText('Supprimer'),
  })
  if (!confirmed) return
  try {
    if (props.deactivateMode) {
      await api.patch(`/cash-desk/expenses/${id}/deactivate`)
      message.value = uiText('Dépense désactivée.')
    } else {
      await api.delete(`/cash-desk/expenses/${id}`)
      message.value = uiText('Dépense supprimée.')
    }
    messageType.value = 'success'
    await load()
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: { error?: string } } }
    message.value =
      apiError.response?.data?.error ??
      (props.deactivateMode
        ? uiText('Désactivation impossible.')
        : uiText('Suppression impossible.'))
    messageType.value = 'error'
  }
}

function onTableAction({ action, id }: { action: string; id: string }) {
  if (action === 'view') openViewModal(id)
  if (action === 'edit') openEditModal(id)
  if (action === 'delete') removeRow(id)
}

watch([dateFrom, dateTo], () => {
  if (props.listFilter !== 'range') return
  if (dateFrom.value > dateTo.value) {
    dateTo.value = dateFrom.value
  }
  load()
})

watch(() => props.listFilter, () => {
  load()
})
watch(() => props.activeIndices, () => {
  if (!isEditing.value && form.value.indiceId) {
    applySelectedIndice()
  }
})
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
      <UiInput v-model="dateFrom" :label="uiText('Du')" type="date" />
      <UiInput v-model="dateTo" :label="uiText('Au')" type="date" />
    </div>

    <UiCard
      v-if="!externalSummary && (rows.length || loading)"
      class="expense-summary-card"
      :title="uiText('Synthèse')"
      :description="formattedPeriodLabel"
      :icon="Receipt"
      icon-variant="amber"
    >
      <div class="expense-summary-card__body">
        <span class="expense-summary-card__count">{{ expenseCountLabel }}</span>
        <strong class="expense-summary-card__total">{{ totalLabel }} : {{ formatFcfa(totalFcfa) }}</strong>
      </div>
    </UiCard>

    <UiCard
      :title="expenseListTitle"
      :description="expenseListDescription"
      class="ui-card--table-panel expense-table-card"
      :icon="Receipt"
      icon-variant="blue"
    >
      <template #actions>
        <ExportButtons :disabled="loading || !tableRows.length" @pdf="exportPdf" @excel="exportExcel" />
        <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="load">
          {{ t('common.refresh') }}
        </UiButton>
        <UiButton variant="primary" size="sm" :icon="Plus" @click="openCreateModal">
          {{ uiText('Nouvelle dépense') }}
        </UiButton>
      </template>

      <p v-if="!rows.length && !loading" class="empty">
        {{ uiText('Aucune dépense pour cette date. Cliquez sur « Nouvelle dépense » pour enregistrer une sortie de caisse.') }}
      </p>

      <template v-else>
        <UiDataTable
          fill
          compact
          table-key="caisse-depenses-jour"
          :data="tableRows"
          :columns="tableColumns"
          :options="tableOptions"
          :loading="loading"
          :loading-label="uiText('Chargement des dépenses…')"
          @action="onTableAction"
        />
      </template>
    </UiCard>

    <UiFormModal
      v-if="viewModalOpen && viewExpense"
      title-id="expense-view-modal-title"
      :title="uiText('Détail de la dépense')"
      :subtitle="viewExpense.label"
      :icon="Eye"
      @close="closeViewModal"
    >
      <dl class="expense-detail">
        <div class="expense-detail__row">
          <dt>{{ uiText('Date') }}</dt>
          <dd>{{ formattedBusinessDate }}</dd>
        </div>
        <div class="expense-detail__row">
          <dt>{{ uiText('Heure') }}</dt>
          <dd>{{ viewExpenseTime }}</dd>
        </div>
        <div class="expense-detail__row">
          <dt>{{ uiText('Libellé') }}</dt>
          <dd>{{ viewExpense.label }}</dd>
        </div>
        <div class="expense-detail__row">
          <dt>{{ uiText('Montant') }}</dt>
          <dd class="expense-detail__amount">{{ formatFcfa(viewExpense.amountFcfa) }}</dd>
        </div>
        <div class="expense-detail__row">
          <dt>{{ uiText('Commentaire') }}</dt>
          <dd>{{ viewExpense.comment?.trim() || '—' }}</dd>
        </div>
      </dl>
      <template #footer>
        <UiButton variant="ghost" @click="closeViewModal">{{ t('common.Fermer') }}</UiButton>
        <UiButton
          variant="primary"
          :icon="Pencil"
          @click="closeViewModal(); openEditModal(viewExpense.id)"
        >
          {{ t('common.Modifier') }}
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
          :label="uiText('Indice / motif')"
          required
          class="expense-form__full"
        >
          <option v-for="opt in indiceOptions" :key="opt.value || 'empty'" :value="opt.value">
            {{ opt.label }}
          </option>
        </UiSelect>
        <UiInput
          v-else
          v-model="form.label"
          :label="uiText('Libellé')"
          :placeholder="uiText('Ex. Achat produits d\'entretien')"
          required
          class="expense-form__full"
        />
        <UiInput
          v-model="form.amountFcfa"
          :label="uiText('Montant (FCFA)')"
          type="number"
          min="1"
          required
          class="expense-form__full"
        />
        <UiInput
          v-model="form.comment"
          :label="uiText('Commentaire')"
          :placeholder="uiText('Détail optionnel…')"
          class="expense-form__full"
        />
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="closeModal">{{ t('common.Annuler') }}</UiButton>
        <UiButton
          variant="primary"
          :icon="isEditing ? Save : Plus"
          :disabled="submitting"
          @click="submit"
        >
          {{ submitting ? t('common.Enregistrement…') : t('common.Enregistrer') }}
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

.expense-summary-card__body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.expense-summary-card__count {
  font-size: 0.875rem;
  color: var(--text-muted);
  font-weight: 600;
}

.expense-summary-card__total {
  font-size: 1.05rem;
  color: #92400e;
}

.expense-table-card {
  min-height: 0;
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
