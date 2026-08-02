<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { ArrowDownUp, Plus, RefreshCw, Save } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import { statusBadge } from '@/lib/datatable-defaults'
import { exportTableExcel, exportTablePdf, type ExportColumn } from '@/lib/table-export'
import type { LabStockItemRecord } from '@/components/laboratoire/LabStockItemsPanel.vue'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

type MovementType = 'ENTRY' | 'EXIT' | 'ADJUSTMENT'

type MovementRecord = {
  id: string
  type: MovementType
  quantity: number
  unitCostFcfa: number | null
  reference: string | null
  notes: string | null
  stockAfter: number
  createdAt: string
  item: { id: string; name: string; sku: string; unit: string }
  user: { id: string; firstName: string; lastName: string }
}

const emit = defineEmits<{ changed: [] }>()

const { uiText, dateTimeText, numberText, localeCode } = useAppI18n()

const movements = ref<MovementRecord[]>([])
const items = ref<LabStockItemRecord[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const modalOpen = ref(false)
const filterItemId = ref('')

const formType = ref<MovementType>('ENTRY')
const formItemId = ref('')
const formQuantity = ref('1')
const formTargetQuantity = ref('0')
const formUnitCost = ref('')
const formReference = ref('')
const formNotes = ref('')

const movementTypeLabels: Record<MovementType, string> = {
  ENTRY: 'Entrée',
  EXIT: 'Sortie',
  ADJUSTMENT: 'Ajustement',
}

const movementTypeVariants: Record<MovementType, 'success' | 'danger' | 'warning'> = {
  ENTRY: 'success',
  EXIT: 'danger',
  ADJUSTMENT: 'warning',
}

const activeItems = computed(() => items.value.filter((p) => p.active))
const selectedItem = computed(() => items.value.find((p) => p.id === formItemId.value))

const targetStockLabel = computed(() => {
  void localeCode.value
  if (selectedItem.value) {
    return translateTemplate('Nouveau stock ({unit})', { unit: uiText(selectedItem.value.unit) })
  }
  return uiText('Nouveau stock')
})

const filteredMovements = computed(() =>
  filterItemId.value ? movements.value.filter((m) => m.item.id === filterItemId.value) : movements.value,
)

const tableRows = computed(() => {
  void localeCode.value
  return filteredMovements.value.map((m) => ({
    id: m.id,
    date: dateTimeText(m.createdAt),
    dateSort: m.createdAt,
    item: m.item.name,
    typeLabel: uiText(movementTypeLabels[m.type]),
    typeVariant: movementTypeVariants[m.type],
    quantity: m.quantity,
    quantityLabel: `${m.type === 'EXIT' ? '−' : m.type === 'ENTRY' ? '+' : '±'}${numberText(m.quantity)} ${uiText(m.item.unit)}`,
    stockAfter: m.stockAfter,
    cost: m.unitCostFcfa != null ? formatFcfa(m.unitCostFcfa) : '—',
    user: fullName(m.user.firstName, m.user.lastName),
    reference: m.reference || '—',
  }))
})

const columns = [
  {
    data: 'dateSort',
    title: 'Date',
    responsivePriority: 1,
    render: (_d: string, _t: string, row: { date: string }) => row.date,
  },
  { data: 'item', title: 'Article', responsivePriority: 1 },
  {
    data: 'typeLabel',
    title: 'Type',
    responsivePriority: 2,
    render: (label: string, _t: string, row: { typeVariant: string }) =>
      statusBadge(label, row.typeVariant as 'success' | 'danger' | 'warning'),
  },
  { data: 'quantityLabel', title: 'Quantité', responsivePriority: 2 },
  { data: 'stockAfter', title: 'Stock après', responsivePriority: 3 },
  { data: 'cost', title: 'Coût', responsivePriority: 4 },
  { data: 'user', title: 'Par', responsivePriority: 4 },
  { data: 'reference', title: 'Réf.', responsivePriority: 4 },
]

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === 'string') {
    return error.response.data.error
  }
  return fallback
}

async function loadItems() {
  try {
    const { data } = await api.get<LabStockItemRecord[]>('/lab-stock/items')
    items.value = data
  } catch {
    items.value = []
  }
}

async function loadMovements() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<MovementRecord[]>('/lab-stock/stock-movements')
    movements.value = data
  } catch {
    message.value = 'Impossible de charger les mouvements.'
    messageType.value = 'error'
    movements.value = []
  } finally {
    loading.value = false
  }
}

function resetForm() {
  formType.value = 'ENTRY'
  formItemId.value = ''
  formQuantity.value = '1'
  formTargetQuantity.value = '0'
  formUnitCost.value = ''
  formReference.value = ''
  formNotes.value = ''
}

function openCreateModal() {
  resetForm()
  modalOpen.value = true
  message.value = ''
}

function closeModal() {
  modalOpen.value = false
  resetForm()
}

async function saveMovement() {
  if (!formItemId.value) {
    message.value = 'Sélectionnez un article.'
    messageType.value = 'error'
    return
  }

  const payload: Record<string, unknown> = {
    itemId: formItemId.value,
    type: formType.value,
    reference: formReference.value.trim() || undefined,
    notes: formNotes.value.trim() || undefined,
  }

  if (formType.value === 'ADJUSTMENT') {
    payload.targetQuantity = Math.max(0, Math.trunc(Number(formTargetQuantity.value) || 0))
  } else {
    const quantity = Math.trunc(Number(formQuantity.value) || 0)
    if (quantity <= 0) {
      message.value = 'Quantité invalide.'
      messageType.value = 'error'
      return
    }
    payload.quantity = quantity
  }

  if (formType.value === 'ENTRY' && formUnitCost.value !== '') {
    payload.unitCostFcfa = Math.max(0, Math.trunc(Number(formUnitCost.value) || 0))
  }

  saving.value = true
  message.value = ''
  try {
    await api.post('/lab-stock/stock-movements', payload)
    message.value = 'Mouvement enregistré.'
    messageType.value = 'success'
    emit('changed')
    closeModal()
    await Promise.all([loadMovements(), loadItems()])
  } catch (error) {
    message.value = apiErrorMessage(error, 'Enregistrement impossible.')
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

type ExportRow = (typeof tableRows.value)[number]
const exportColumns = computed<ExportColumn<ExportRow>[]>(() => {
  void localeCode.value
  return [
    { header: uiText('Date'), value: (r) => r.date },
    { header: uiText('Article'), value: (r) => r.item },
    { header: uiText('Type'), value: (r) => r.typeLabel },
    { header: uiText('Quantité'), value: (r) => r.quantityLabel },
    { header: uiText('Stock après'), value: (r) => r.stockAfter },
    { header: uiText('Coût'), value: (r) => r.cost },
    { header: uiText('Par'), value: (r) => r.user },
    { header: uiText('Référence'), value: (r) => r.reference },
  ]
})

function exportPdf() {
  exportTablePdf(uiText('Mouvements stock labo'), exportColumns.value, tableRows.value)
}

function exportExcel() {
  exportTableExcel(uiText('Mouvements stock labo'), exportColumns.value, tableRows.value)
}

onMounted(async () => {
  await Promise.all([loadMovements(), loadItems()])
})

defineExpose({ reload: loadMovements })
</script>

<template>
  <PageTableSection embedded>
    <template #toolbar>
      <select v-model="filterItemId" class="filter-select" :aria-label="uiText('Filtrer par article')">
        <option value="">{{ uiText('Tous les articles') }}</option>
        <option v-for="item in items" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
      <ExportButtons :disabled="loading || !tableRows.length" @pdf="exportPdf" @excel="exportExcel" />
      <UiButton
        variant="ghost"
        size="sm"
        :icon="RefreshCw"
        :disabled="loading || saving"
        @click="loadMovements"
      >
        Actualiser
      </UiButton>
      <UiButton variant="primary" size="sm" :icon="Plus" @click="openCreateModal">
        Nouveau mouvement
      </UiButton>
    </template>

    <UiAlert v-if="message && !modalOpen" :type="messageType" :message="message" class="panel-alert" />

    <p v-if="!loading && !tableRows.length" class="empty">{{ uiText('Aucun mouvement enregistré.') }}</p>
    <UiDataTable
      v-else
      fill
      table-key="lab-stock-movements"
      compact
      :data="tableRows"
      :columns="columns"
      :loading="loading"
      loading-label="Chargement des mouvements…"
    />
  </PageTableSection>

  <UiFormModal
    v-if="modalOpen"
    title-id="lab-stock-movement-modal-title"
    title="Nouveau mouvement"
    subtitle="Entrée, sortie ou inventaire du stock laboratoire"
    :icon="ArrowDownUp"
    @close="closeModal"
  >
    <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />

    <section class="movement-form">
      <UiSelect v-model="formType" label="Type de mouvement">
        <option value="ENTRY">{{ uiText('Entrée') }}</option>
        <option value="EXIT">{{ uiText('Sortie') }}</option>
        <option value="ADJUSTMENT">{{ uiText('Ajustement (inventaire)') }}</option>
      </UiSelect>

      <UiSelect v-model="formItemId" label="Article" required>
        <option value="">{{ uiText('Sélectionner…') }}</option>
        <option v-for="item in activeItems" :key="item.id" :value="item.id">
          {{ item.name }} ({{ numberText(item.quantity) }} {{ uiText(item.unit) }})
        </option>
      </UiSelect>

      <UiInput
        v-if="formType !== 'ADJUSTMENT'"
        v-model="formQuantity"
        label="Quantité"
        type="number"
        min="1"
        required
      />
      <UiInput
        v-else
        v-model="formTargetQuantity"
        :label="targetStockLabel"
        type="number"
        min="0"
        required
      />

      <UiInput
        v-if="formType === 'ENTRY'"
        v-model="formUnitCost"
        label="Coût unitaire (FCFA)"
        type="number"
        min="0"
      />

      <UiInput v-model="formReference" label="Référence" placeholder="N° bon, facture…" />
      <UiTextarea v-model="formNotes" :label="uiText('Notes')" :rows="2" />
    </section>

    <template #footer>
      <UiButton variant="ghost" @click="closeModal">Annuler</UiButton>
      <UiButton variant="primary" :icon="Save" :disabled="saving" @click="saveMovement">
        {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.panel-alert {
  margin-bottom: 1rem;
}
.empty {
  margin: 1.5rem 0;
  color: var(--text-muted, #64748b);
}
.filter-select {
  min-width: 12rem;
  height: 2rem;
  padding: 0 0.6rem;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 0.4rem;
  background: var(--surface, #fff);
  font-size: 0.875rem;
}
.movement-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
</style>
