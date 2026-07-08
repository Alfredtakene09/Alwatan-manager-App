<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import axios from 'axios'
import { Plus, RefreshCw, Save, ArrowDownUp } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import { statusBadge } from '@/lib/datatable-defaults'
import type { LogisticsItemRecord } from '@/components/logistique/LogisticsItemsPanel.vue'
import type { LogisticsSupplierRecord } from '@/components/logistique/LogisticsSuppliersPanel.vue'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

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
  supplier: { id: string; name: string } | null
  user: { id: string; firstName: string; lastName: string }
}

const emit = defineEmits<{ changed: [] }>()

const movements = ref<MovementRecord[]>([])
const items = ref<LogisticsItemRecord[]>([])
const suppliers = ref<LogisticsSupplierRecord[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const modalOpen = ref(false)
const filterItemId = ref('')

const formType = ref<'ENTRY' | 'EXIT' | 'ADJUSTMENT'>('ENTRY')
const formItemId = ref('')
const formQuantity = ref('1')
const formTargetQuantity = ref('0')
const formUnitCost = ref('')
const formSupplierId = ref('')
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
const activeSuppliers = computed(() => suppliers.value.filter((s) => s.active))
const selectedItem = computed(() => items.value.find((p) => p.id === formItemId.value))

const tableRows = computed(() =>
  movements.value.map((m) => ({
    id: m.id,
    date: new Date(m.createdAt).toLocaleString('fr-FR'),
    dateSort: new Date(m.createdAt).getTime(),
    itemName: m.item.name,
    typeLabel: movementTypeLabels[m.type],
    typeVariant: movementTypeVariants[m.type],
    quantity: m.quantity,
    stockAfter: m.stockAfter,
    supplierName: m.supplier?.name ?? '—',
    userName: fullName(m.user.firstName, m.user.lastName),
    reference: m.reference?.trim() || '—',
    unitCost: m.unitCostFcfa ? formatFcfa(m.unitCostFcfa) : '—',
  })),
)

const columns = [
  {
    data: 'dateSort',
    title: 'Date',
    responsivePriority: 1,
    render: (_d: number, _t: string, row: { date: string }) => `<span>${row.date}</span>`,
  },
  {
    data: 'itemName',
    title: 'Article',
    responsivePriority: 1,
    render: (name: string) => `<span class="dt-name">${name}</span>`,
  },
  {
    data: 'typeLabel',
    title: 'Type',
    responsivePriority: 2,
    render: (label: string, _t: string, row: { typeVariant: string }) =>
      statusBadge(label, row.typeVariant as 'success' | 'danger' | 'warning'),
  },
  { data: 'quantity', title: 'Qté', responsivePriority: 3 },
  { data: 'stockAfter', title: 'Stock après', responsivePriority: 3 },
  { data: 'supplierName', title: 'Fournisseur', responsivePriority: 4 },
  { data: 'reference', title: 'Référence', responsivePriority: 5 },
  { data: 'userName', title: 'Par', responsivePriority: 4 },
]

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === 'string') {
    return error.response.data.error
  }
  return fallback
}

async function loadReferenceData() {
  const [itemsRes, suppliersRes] = await Promise.all([
    api.get<LogisticsItemRecord[]>('/logistique/items'),
    api.get<LogisticsSupplierRecord[]>('/logistique/suppliers'),
  ])
  items.value = itemsRes.data
  suppliers.value = suppliersRes.data
}

async function loadMovements() {
  loading.value = true
  message.value = ''
  try {
    const params = filterItemId.value ? { itemId: filterItemId.value } : undefined
    const { data } = await api.get<MovementRecord[]>('/logistique/stock-movements', { params })
    movements.value = data
  } catch {
    message.value = 'Impossible de charger les mouvements.'
    messageType.value = 'error'
    movements.value = []
  } finally {
    loading.value = false
  }
}

async function reload() {
  await Promise.all([loadReferenceData(), loadMovements()])
}

function resetForm() {
  formType.value = 'ENTRY'
  formItemId.value = ''
  formQuantity.value = '1'
  formTargetQuantity.value = '0'
  formUnitCost.value = ''
  formSupplierId.value = ''
  formReference.value = ''
  formNotes.value = ''
}

function openCreateModal() {
  resetForm()
  if (filterItemId.value) formItemId.value = filterItemId.value
  modalOpen.value = true
  message.value = ''
}

function closeModal() {
  modalOpen.value = false
  resetForm()
}

watch(formItemId, (id) => {
  const item = items.value.find((p) => p.id === id)
  if (item) formTargetQuantity.value = String(item.quantity)
})

async function saveMovement() {
  if (!formItemId.value) {
    message.value = 'Sélectionnez un article.'
    messageType.value = 'error'
    return
  }

  saving.value = true
  message.value = ''

  const payload: Record<string, unknown> = {
    itemId: formItemId.value,
    type: formType.value,
    notes: formNotes.value.trim() || undefined,
    reference: formReference.value.trim() || undefined,
  }

  if (formType.value === 'ADJUSTMENT') {
    payload.targetQuantity = Number(formTargetQuantity.value)
  } else {
    payload.quantity = Number(formQuantity.value)
  }

  if (formType.value === 'ENTRY') {
    if (!formSupplierId.value) {
      message.value = 'Sélectionnez un fournisseur pour une entrée.'
      messageType.value = 'error'
      saving.value = false
      return
    }
    payload.supplierId = formSupplierId.value
    const unitCost = Number(formUnitCost.value)
    if (Number.isFinite(unitCost) && unitCost >= 0) payload.unitCostFcfa = unitCost
  }

  try {
    await api.post('/logistique/stock-movements', payload)
    message.value = 'Mouvement enregistré.'
    messageType.value = 'success'
    emit('changed')
    closeModal()
    await reload()
  } catch (error) {
    message.value = apiErrorMessage(error, 'Enregistrement impossible.')
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

onMounted(reload)

defineExpose({ reload })
</script>

<template>
  <PageTableSection embedded>
    <template #toolbar>
      <select v-model="filterItemId" class="filter-select" @change="loadMovements">
        <option value="">Tous les articles</option>
        <option v-for="p in items" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading || saving" @click="reload">
        Actualiser
      </UiButton>
      <UiButton variant="primary" size="sm" :icon="Plus" @click="openCreateModal">
        Nouveau mouvement
      </UiButton>
    </template>

    <UiAlert v-if="message && !modalOpen" :type="messageType" :message="message" class="panel-alert" />

    <p v-if="!loading && !movements.length" class="empty">Aucun mouvement enregistré</p>
    <UiDataTable
      v-else
      fill
      table-key="logistics-stock-movements"
      compact
      :data="tableRows"
      :columns="columns"
      :loading="loading"
      loading-label="Chargement des mouvements…"
    />
  </PageTableSection>

  <UiFormModal
    v-if="modalOpen"
    title-id="logistics-movement-modal-title"
    title="Nouveau mouvement de stock"
    subtitle="Entrée fournisseur, sortie manuelle ou ajustement d'inventaire"
    :icon="ArrowDownUp"
    @close="closeModal"
  >
    <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />
    <section class="form-panel">
      <UiSelect v-model="formType" label="Type de mouvement">
        <option value="ENTRY">Entrée (réapprovisionnement)</option>
        <option value="EXIT">Sortie manuelle</option>
        <option value="ADJUSTMENT">Ajustement inventaire</option>
      </UiSelect>

      <UiSelect v-model="formItemId" label="Article" required>
        <option value="">Sélectionner un article</option>
        <option v-for="p in activeItems" :key="p.id" :value="p.id">
          {{ p.name }} (stock: {{ p.quantity }} {{ p.unit }})
        </option>
      </UiSelect>

      <template v-if="formType === 'ENTRY'">
        <UiSelect v-model="formSupplierId" label="Fournisseur" required>
          <option value="">Sélectionner un fournisseur</option>
          <option v-for="s in activeSuppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
        </UiSelect>
        <div class="form-grid">
          <UiInput v-model="formQuantity" label="Quantité reçue" type="number" min="1" required />
          <UiInput v-model="formUnitCost" label="Coût unitaire (FCFA)" type="number" min="0" />
        </div>
        <UiInput v-model="formReference" label="N° bon / facture fournisseur" placeholder="Référence document…" />
      </template>

      <template v-else-if="formType === 'EXIT'">
        <UiInput
          v-model="formQuantity"
          label="Quantité sortie"
          type="number"
          min="1"
          :max="selectedItem?.quantity"
          required
        />
        <UiInput v-model="formReference" label="Motif / référence" placeholder="Ex. casse, périmé…" />
      </template>

      <template v-else>
        <UiInput
          v-model="formTargetQuantity"
          label="Nouveau stock (inventaire)"
          type="number"
          min="0"
          required
        />
        <p v-if="selectedItem" class="hint">
          Stock actuel : {{ selectedItem.quantity }} — écart :
          {{ Number(formTargetQuantity) - selectedItem.quantity >= 0 ? '+' : '' }}{{ Number(formTargetQuantity) - selectedItem.quantity }}
        </p>
      </template>

      <UiTextarea v-model="formNotes" label="Notes" :rows="2" placeholder="Commentaire optionnel…" />
    </section>
    <template #footer>
      <UiButton variant="ghost" @click="closeModal">Annuler</UiButton>
      <UiButton variant="primary" :icon="Save" :disabled="saving" @click="saveMovement">
        {{ saving ? 'Enregistrement…' : 'Valider le mouvement' }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.panel-alert {
  margin-bottom: 1rem;
}

.empty {
  text-align: center;
  color: var(--text-light);
  padding: 2rem 1rem;
  font-size: 0.875rem;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.filter-select {
  min-width: 180px;
  padding: 0.4rem 0.6rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #fff;
  font-family: inherit;
  font-size: 0.8125rem;
  color: var(--text);
}

.hint {
  font-size: 0.8125rem;
  color: var(--text-muted);
  margin: -0.25rem 0 0.5rem;
}

@media (max-width: 640px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
