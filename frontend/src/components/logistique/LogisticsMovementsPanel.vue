<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import axios from 'axios'
import { Plus, RefreshCw, Save, ArrowDownUp } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import {
  formatPackagingConfig,
  formatPackagingStock,
  packagingToUnits,
  unitsToPackaging,
} from '@/lib/logistics-packaging'
import { resolvePackagingMode } from '@/lib/logistics-units'
import { exportTableExcel, exportTablePdf, type ExportColumn } from '@/lib/table-export'
import type { LogisticsItemRecord } from '@/components/logistique/LogisticsItemsPanel.vue'
import type { LogisticsSupplierRecord } from '@/components/logistique/LogisticsSuppliersPanel.vue'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import '@/assets/simple-table.css'

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
  item: {
    id: string
    name: string
    sku: string
    unit: string
    unitsPerPackage?: number
    packagesPerCarton?: number
  }
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
const formCartons = ref('0')
const formPackages = ref('0')
const formUnits = ref('1')
const formTargetQuantity = ref('0')
const formTargetCartons = ref('0')
const formTargetPackages = ref('0')
const formTargetUnits = ref('0')
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

const selectedPackaging = computed(() => ({
  unitsPerPackage: selectedItem.value?.unitsPerPackage ?? 1,
  packagesPerCarton: selectedItem.value?.packagesPerCarton ?? 1,
}))

const selectedMode = computed(() => resolvePackagingMode(selectedItem.value?.unit))
const showPackageFields = computed(() => selectedMode.value === 'paquet' || selectedMode.value === 'carton')
const showCartonFields = computed(() => selectedMode.value === 'carton')

const movementTotalUnits = computed(() =>
  packagingToUnits(
    {
      cartons: showCartonFields.value ? Number(formCartons.value) || 0 : 0,
      packages: showPackageFields.value ? Number(formPackages.value) || 0 : 0,
      units: showPackageFields.value ? 0 : Number(formUnits.value) || 0,
    },
    selectedPackaging.value,
  ),
)

const targetTotalUnits = computed(() =>
  packagingToUnits(
    {
      cartons: showCartonFields.value ? Number(formTargetCartons.value) || 0 : 0,
      packages: showPackageFields.value ? Number(formTargetPackages.value) || 0 : 0,
      units: showPackageFields.value ? 0 : Number(formTargetUnits.value) || 0,
    },
    selectedPackaging.value,
  ),
)

watch(
  [formCartons, formPackages, showPackageFields, showCartonFields, selectedPackaging],
  () => {
    if (!showPackageFields.value) return
    formUnits.value = String(movementTotalUnits.value)
  },
)

watch(
  [formTargetCartons, formTargetPackages, showPackageFields, showCartonFields, selectedPackaging],
  () => {
    if (!showPackageFields.value) return
    formTargetUnits.value = String(targetTotalUnits.value)
  },
)

function itemStockLabel(item: LogisticsItemRecord) {
  const mode = resolvePackagingMode(item.unit)
  const upp = Math.max(1, item.unitsPerPackage ?? 1)
  const packaging = {
    unitsPerPackage: item.unitsPerPackage ?? 1,
    packagesPerCarton: item.packagesPerCarton ?? 1,
  }
  if (mode === 'unité') return `${item.quantity} unité${item.quantity > 1 ? 's' : ''}`
  if (mode === 'paquet') {
    const packages = Math.floor(item.quantity / upp)
    const units = item.quantity % upp
    const chunks: string[] = []
    if (packages > 0) chunks.push(`${packages} pqt`)
    if (units > 0) chunks.push(`${units} u`)
    return chunks.length ? chunks.join(' · ') : '0 u'
  }
  return formatPackagingStock(item.quantity, packaging, { unitLabel: 'unité', short: true })
}

const tableRows = computed(() =>
  movements.value.map((m) => {
    const packaging = {
      unitsPerPackage: m.item.unitsPerPackage ?? 1,
      packagesPerCarton: m.item.packagesPerCarton ?? 1,
    }
    return {
      id: m.id,
      date: new Date(m.createdAt).toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
      dateSort: new Date(m.createdAt).getTime(),
      itemName: m.item.name,
      typeLabel: movementTypeLabels[m.type],
      typeVariant: movementTypeVariants[m.type],
      quantity: formatPackagingStock(m.quantity, packaging, {
        unitLabel: m.item.unit,
        short: true,
      }),
      quantitySort: m.quantity,
      stockAfter: formatPackagingStock(m.stockAfter, packaging, {
        unitLabel: m.item.unit,
        short: true,
      }),
      supplierName: m.supplier?.name ?? '—',
      userName: fullName(m.user.firstName, m.user.lastName),
      reference: m.reference?.trim() || '—',
      unitCost: m.unitCostFcfa ? formatFcfa(m.unitCostFcfa) : '—',
    }
  }),
)

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
  formCartons.value = '0'
  formPackages.value = '0'
  formUnits.value = '1'
  formTargetQuantity.value = '0'
  formTargetCartons.value = '0'
  formTargetPackages.value = '0'
  formTargetUnits.value = '0'
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

function syncTargetFromItem(item: LogisticsItemRecord) {
  const mode = resolvePackagingMode(item.unit)
  const upp = Math.max(1, item.unitsPerPackage ?? 1)
  const packaging = {
    unitsPerPackage: item.unitsPerPackage ?? 1,
    packagesPerCarton: item.packagesPerCarton ?? 1,
  }
  formTargetQuantity.value = String(item.quantity)
  if (mode === 'unité') {
    formTargetCartons.value = '0'
    formTargetPackages.value = '0'
    formTargetUnits.value = String(item.quantity)
  } else if (mode === 'paquet') {
    const packages = Math.floor(item.quantity / upp)
    formTargetCartons.value = '0'
    formTargetPackages.value = String(packages)
    formTargetUnits.value = String(packages * upp)
  } else {
    const parts = unitsToPackaging(item.quantity, packaging)
    formTargetCartons.value = String(parts.cartons)
    formTargetPackages.value = String(parts.packages)
    formTargetUnits.value = String(
      packagingToUnits(
        { cartons: parts.cartons, packages: parts.packages, units: 0 },
        packaging,
      ),
    )
  }
}

watch(formItemId, (id) => {
  const item = items.value.find((p) => p.id === id)
  if (!item) return
  syncTargetFromItem(item)
  formCartons.value = '0'
  formPackages.value = '0'
  formUnits.value = '1'
  formQuantity.value = '1'
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
    payload.targetCartons = showCartonFields.value
      ? Math.max(0, Math.trunc(Number(formTargetCartons.value) || 0))
      : 0
    payload.targetPackages = showPackageFields.value
      ? Math.max(0, Math.trunc(Number(formTargetPackages.value) || 0))
      : 0
    payload.targetUnits = showPackageFields.value
      ? 0
      : Math.max(0, Math.trunc(Number(formTargetUnits.value) || 0))
  } else {
    const total = movementTotalUnits.value
    if (total <= 0) {
      message.value = 'Indiquez une quantité supérieure à 0.'
      messageType.value = 'error'
      saving.value = false
      return
    }
    payload.cartons = showCartonFields.value
      ? Math.max(0, Math.trunc(Number(formCartons.value) || 0))
      : 0
    payload.packages = showPackageFields.value
      ? Math.max(0, Math.trunc(Number(formPackages.value) || 0))
      : 0
    payload.units = showPackageFields.value
      ? 0
      : Math.max(0, Math.trunc(Number(formUnits.value) || 0))
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

type MovementExportRow = (typeof tableRows.value)[number]

const movementExportColumns: ExportColumn<MovementExportRow>[] = [
  { header: 'Date', value: (r) => r.date },
  { header: 'Article', value: (r) => r.itemName },
  { header: 'Type', value: (r) => r.typeLabel },
  { header: 'Quantité', value: (r) => r.quantity },
  { header: 'Stock après', value: (r) => r.stockAfter },
  { header: 'Fournisseur', value: (r) => r.supplierName },
  { header: 'Référence', value: (r) => r.reference },
  { header: 'Par', value: (r) => r.userName },
]

function exportPdf() {
  exportTablePdf('Mouvements de stock logistique', movementExportColumns, tableRows.value)
}

function exportExcel() {
  exportTableExcel('Mouvements de stock logistique', movementExportColumns, tableRows.value)
}

defineExpose({ reload })
</script>

<template>
  <PageTableSection embedded>
    <template #toolbar>
      <select v-model="filterItemId" class="filter-select" @change="loadMovements">
        <option value="">Tous les articles</option>
        <option v-for="p in items" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <ExportButtons :disabled="loading || !tableRows.length" @pdf="exportPdf" @excel="exportExcel" />
      <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading || saving" @click="reload">
        Actualiser
      </UiButton>
      <UiButton variant="primary" size="sm" :icon="Plus" @click="openCreateModal">
        Nouveau mouvement
      </UiButton>
    </template>

    <UiAlert v-if="message && !modalOpen" :type="messageType" :message="message" class="panel-alert" />

    <div class="simple-table-shell simple-table-shell--fill">
      <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
        <span class="simple-table-spinner" aria-hidden="true" />
        Chargement des mouvements…
      </div>
      <div class="simple-table-scroll">
        <p v-if="!loading && !tableRows.length" class="simple-table__empty">Aucun mouvement enregistré</p>
        <div v-else class="simple-table-wrap">
          <table class="simple-table">
            <thead>
              <tr>
                <th class="simple-table__num">#</th>
                <th>Date</th>
                <th>Article</th>
                <th>Type</th>
                <th>Qté</th>
                <th>Stock</th>
                <th>Fourn.</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in tableRows" :key="row.id">
                <td class="simple-table__num">{{ index + 1 }}</td>
                <td><span class="st-date">{{ row.date }}</span></td>
                <td><span class="st-name">{{ row.itemName }}</span></td>
                <td>
                  <span class="st-badge" :class="`st-badge--${row.typeVariant}`">{{ row.typeLabel }}</span>
                </td>
                <td><span class="st-muted">{{ row.quantity }}</span></td>
                <td><span class="st-muted">{{ row.stockAfter }}</span></td>
                <td><span class="st-muted">{{ row.supplierName }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
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
          {{ p.name }} (stock: {{ itemStockLabel(p) }})
        </option>
      </UiSelect>

      <p v-if="selectedItem && showPackageFields" class="packaging-hint">
        {{ formatPackagingConfig(selectedPackaging) }}
      </p>

      <template v-if="formType === 'ENTRY'">
        <UiSelect v-model="formSupplierId" label="Fournisseur" required>
          <option value="">Sélectionner un fournisseur</option>
          <option v-for="s in activeSuppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
        </UiSelect>

        <div
          class="form-grid"
          :class="showCartonFields ? 'form-grid--3' : showPackageFields ? 'form-grid--2' : ''"
        >
          <UiInput
            v-if="showCartonFields"
            v-model="formCartons"
            label="Nombre de cartons"
            type="number"
            min="0"
          />
          <UiInput
            v-if="showPackageFields"
            v-model="formPackages"
            label="Nombre de paquets"
            type="number"
            min="0"
          />
          <UiInput
            v-model="formUnits"
            :label="showPackageFields ? 'Nombre d\'unités' : (selectedItem ? `Quantité (${selectedItem.unit})` : 'Quantité')"
            type="number"
            min="0"
            :readonly="showPackageFields"
          />
        </div>
        <p v-if="selectedItem" class="hint">
          Total :
          <strong>{{ movementTotalUnits }}</strong>
          {{ showPackageFields ? `unité${movementTotalUnits > 1 ? 's' : ''}` : selectedItem.unit }}
          <template v-if="showPackageFields"> (calculé automatiquement)</template>
        </p>
        <UiInput v-model="formUnitCost" label="Prix par unité (FCFA)" type="number" min="0" />
        <UiInput v-model="formReference" label="N° bon / facture fournisseur" placeholder="Référence document…" />
      </template>

      <template v-else-if="formType === 'EXIT'">
        <div
          class="form-grid"
          :class="showCartonFields ? 'form-grid--3' : showPackageFields ? 'form-grid--2' : ''"
        >
          <UiInput
            v-if="showCartonFields"
            v-model="formCartons"
            label="Nombre de cartons"
            type="number"
            min="0"
          />
          <UiInput
            v-if="showPackageFields"
            v-model="formPackages"
            label="Nombre de paquets"
            type="number"
            min="0"
          />
          <UiInput
            v-model="formUnits"
            :label="showPackageFields ? 'Nombre d\'unités' : (selectedItem ? `Quantité (${selectedItem.unit})` : 'Quantité')"
            type="number"
            min="0"
            :readonly="showPackageFields"
          />
        </div>
        <p v-if="selectedItem" class="hint">
          Total :
          <strong>{{ movementTotalUnits }}</strong>
          {{ showPackageFields ? `unité${movementTotalUnits > 1 ? 's' : ''}` : selectedItem.unit }}
          <template v-if="showPackageFields"> (calculé automatiquement)</template>
          — stock actuel : {{ itemStockLabel(selectedItem) }}
        </p>
        <UiInput v-model="formReference" label="Motif / référence" placeholder="Ex. casse, périmé…" />
      </template>

      <template v-else>
        <div
          class="form-grid"
          :class="showCartonFields ? 'form-grid--3' : showPackageFields ? 'form-grid--2' : ''"
        >
          <UiInput
            v-if="showCartonFields"
            v-model="formTargetCartons"
            label="Nombre de cartons"
            type="number"
            min="0"
          />
          <UiInput
            v-if="showPackageFields"
            v-model="formTargetPackages"
            label="Nombre de paquets"
            type="number"
            min="0"
          />
          <UiInput
            v-model="formTargetUnits"
            :label="showPackageFields ? 'Nombre d\'unités' : (selectedItem ? `Quantité (${selectedItem.unit})` : 'Quantité')"
            type="number"
            min="0"
            :readonly="showPackageFields"
          />
        </div>
        <p v-if="selectedItem" class="hint">
          Stock actuel : {{ itemStockLabel(selectedItem) }}
          — nouvel inventaire :
          <strong>
            {{ targetTotalUnits }}
            {{ showPackageFields ? `unité${targetTotalUnits > 1 ? 's' : ''}` : selectedItem.unit }}
          </strong>
          <template v-if="showPackageFields"> (calculé automatiquement)</template>
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

.form-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
}

.form-grid--2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-grid--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.packaging-hint {
  margin: 0;
  padding: 0.55rem 0.75rem;
  border-radius: 8px;
  background: #e8f1fb;
  color: #1b4f9c;
  font-size: 0.8125rem;
  font-weight: 600;
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
  .form-grid--2,
  .form-grid--3 {
    grid-template-columns: 1fr;
  }
}
</style>
