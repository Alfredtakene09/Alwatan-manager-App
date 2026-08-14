<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import axios from 'axios'
import { Plus, RefreshCw, Save, ArrowDownUp } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName, canManagePharmacyCatalog } from '@/lib/roles'
import { exportTableExcel, exportTablePdf, type ExportColumn } from '@/lib/table-export'
import type { PharmacyProductRecord } from '@/components/pharmacie/PharmacyProductsPanel.vue'
import type { PharmacySupplierRecord } from '@/components/pharmacie/PharmacySuppliersPanel.vue'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import { useAuthStore } from '@/stores/auth'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

type StockMovementType = 'ENTRY' | 'EXIT' | 'ADJUSTMENT' | 'DISPENSATION'

type StockMovementRecord = {
  id: string
  type: StockMovementType
  quantity: number
  unitCostFcfa: number | null
  reference: string | null
  notes: string | null
  stockAfter: number
  createdAt: string
  product: { id: string; name: string; sku: string }
  supplier: { id: string; name: string } | null
  user: { id: string; firstName: string; lastName: string }
}

const emit = defineEmits<{ changed: [] }>()

const { uiText, localeCode } = useAppI18n()
const auth = useAuthStore()
const canManageCatalog = computed(() =>
  auth.user ? canManagePharmacyCatalog(auth.user.role) : false,
)

const movements = ref<StockMovementRecord[]>([])
const products = ref<PharmacyProductRecord[]>([])
const suppliers = ref<PharmacySupplierRecord[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const modalOpen = ref(false)
const filterProductId = ref('')

const formType = ref<'ENTRY' | 'EXIT' | 'ADJUSTMENT'>('ENTRY')
const formProductId = ref('')
const formQuantity = ref('1')
const formTargetQuantity = ref('0')
const formUnitCost = ref('')
const formSupplierId = ref('')
const formReference = ref('')
const formNotes = ref('')

const movementTypeLabels: Record<StockMovementType, string> = {
  ENTRY: 'Entrée',
  EXIT: 'Sortie',
  ADJUSTMENT: 'Ajustement',
  DISPENSATION: 'Dispensation',
}

const movementTypeVariants: Record<StockMovementType, 'success' | 'danger' | 'warning' | 'info'> = {
  ENTRY: 'success',
  EXIT: 'danger',
  ADJUSTMENT: 'warning',
  DISPENSATION: 'info',
}

const activeProducts = computed(() => products.value.filter((p) => p.active))
const activeSuppliers = computed(() => suppliers.value.filter((s) => s.active))
const selectedProduct = computed(() => products.value.find((p) => p.id === formProductId.value))

const tableRows = computed(() => {
  void localeCode.value
  return movements.value.map((m) => ({
    id: m.id,
    date: new Date(m.createdAt).toLocaleString('fr-FR'),
    dateSort: new Date(m.createdAt).getTime(),
    productName: m.product.name,
    typeLabel: uiText(movementTypeLabels[m.type]),
    typeVariant: movementTypeVariants[m.type],
    quantity: m.quantity,
    stockAfter: m.stockAfter,
    supplierName: m.supplier?.name ?? '—',
    userName: fullName(m.user.firstName, m.user.lastName),
    reference: m.reference?.trim() || '—',
    unitCost: m.unitCostFcfa ? formatFcfa(m.unitCostFcfa) : '—',
  }))
})

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === 'string') {
    return error.response.data.error
  }
  return fallback
}

async function loadReferenceData() {
  const [productsRes, suppliersRes] = await Promise.all([
    api.get<PharmacyProductRecord[]>('/pharmacie/products'),
    api.get<PharmacySupplierRecord[]>('/pharmacie/suppliers'),
  ])
  products.value = productsRes.data
  suppliers.value = suppliersRes.data
}

async function loadMovements() {
  loading.value = true
  message.value = ''
  try {
    const params = filterProductId.value ? { productId: filterProductId.value } : undefined
    const { data } = await api.get<StockMovementRecord[]>('/pharmacie/stock-movements', { params })
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
  formProductId.value = ''
  formQuantity.value = '1'
  formTargetQuantity.value = '0'
  formUnitCost.value = ''
  formSupplierId.value = ''
  formReference.value = ''
  formNotes.value = ''
}

function openCreateModal() {
  if (!canManageCatalog.value) return
  resetForm()
  if (filterProductId.value) formProductId.value = filterProductId.value
  modalOpen.value = true
  message.value = ''
}

function closeModal() {
  modalOpen.value = false
  resetForm()
}

watch(formProductId, (id) => {
  const product = products.value.find((p) => p.id === id)
  if (product) formTargetQuantity.value = String(product.quantity)
})

async function saveMovement() {
  if (!canManageCatalog.value) return
  if (!formProductId.value) {
    message.value = 'Sélectionnez un produit.'
    messageType.value = 'error'
    return
  }

  saving.value = true
  message.value = ''

  const payload: Record<string, unknown> = {
    productId: formProductId.value,
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
    if (Number.isFinite(unitCost) && unitCost > 0) payload.unitCostFcfa = unitCost
  }

  try {
    await api.post('/pharmacie/stock-movements', payload)
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

const movementExportColumns = computed<ExportColumn<MovementExportRow>[]>(() => {
  void localeCode.value
  return [
    { header: uiText('Date'), value: (r) => r.date },
    { header: uiText('Produit'), value: (r) => r.productName },
    { header: uiText('Type'), value: (r) => r.typeLabel },
    { header: uiText('Qté'), value: (r) => r.quantity },
    { header: uiText('Stock après'), value: (r) => r.stockAfter },
    { header: uiText('Fournisseur'), value: (r) => r.supplierName },
    { header: uiText('Référence'), value: (r) => r.reference },
    { header: uiText('Par'), value: (r) => r.userName },
  ]
})

function exportPdf() {
  exportTablePdf(uiText('Mouvements de stock pharmacie'), movementExportColumns.value, tableRows.value)
}

function exportExcel() {
  exportTableExcel(uiText('Mouvements de stock pharmacie'), movementExportColumns.value, tableRows.value)
}

defineExpose({ reload })
</script>

<template>
  <PageTableSection embedded>
    <template #toolbar>
      <select v-model="filterProductId" class="filter-select" @change="loadMovements">
        <option value="">{{ uiText('Tous les produits') }}</option>
        <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <ExportButtons :disabled="loading || !tableRows.length" @pdf="exportPdf" @excel="exportExcel" />
      <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading || saving" @click="reload">
        {{ uiText('Actualiser') }}
      </UiButton>
      <UiButton
        v-if="canManageCatalog"
        variant="primary"
        size="sm"
        :icon="Plus"
        @click="openCreateModal"
      >
        {{ uiText('Nouveau mouvement') }}
      </UiButton>
    </template>

    <UiAlert v-if="message && !modalOpen" :type="messageType" :message="message" class="panel-alert" />

    <p v-if="!loading && !movements.length" class="empty">{{ uiText('Aucun mouvement enregistré') }}</p>
    <div v-else class="simple-table-shell" :class="{ 'simple-table-shell--fill': true }">
      <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
        <span class="simple-table-spinner" aria-hidden="true" />
        Chargement des mouvements…
      </div>
      <div class="simple-table-scroll">
        <div class="simple-table-wrap">
          <table class="simple-table">
            <thead>
              <tr>
                <th class="simple-table__num">#</th>
                <th>{{ uiText('Date') }}</th>
                <th>{{ uiText('Produit') }}</th>
                <th>{{ uiText('Type') }}</th>
                <th>{{ uiText('Qté') }}</th>
                <th>{{ uiText('Stock après') }}</th>
                <th>{{ uiText('Fournisseur') }}</th>
                <th>{{ uiText('Référence') }}</th>
                <th>{{ uiText('Par') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in tableRows" :key="row.id">
                <td class="simple-table__num">{{ index + 1 }}</td>
                <td><span class="st-date">{{ row.date }}</span></td>
                <td><span class="st-name">{{ row.productName }}</span></td>
                <td>
                  <span class="st-badge" :class="`st-badge--${row.typeVariant}`">{{ row.typeLabel }}</span>
                </td>
                <td>{{ row.quantity }}</td>
                <td>{{ row.stockAfter }}</td>
                <td>{{ row.supplierName }}</td>
                <td>{{ row.reference }}</td>
                <td>{{ row.userName }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </PageTableSection>

  <UiFormModal
    v-if="modalOpen"
    title-id="pharmacy-movement-modal-title"
    title="Nouveau mouvement de stock"
    subtitle="Entrée fournisseur, sortie manuelle ou ajustement d'inventaire"
    :icon="ArrowDownUp"
    @close="closeModal"
  >
    <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />
    <section class="form-panel">
      <UiSelect v-model="formType" label="Type de mouvement">
        <option value="ENTRY">{{ uiText('Entrée (réapprovisionnement)') }}</option>
        <option value="EXIT">{{ uiText('Sortie manuelle') }}</option>
        <option value="ADJUSTMENT">{{ uiText('Ajustement inventaire') }}</option>
      </UiSelect>

      <UiSelect v-model="formProductId" label="Produit" required>
        <option value="">{{ uiText('Sélectionner un produit') }}</option>
        <option v-for="p in activeProducts" :key="p.id" :value="p.id">
          {{ p.name }} (stock: {{ p.quantity }})
        </option>
      </UiSelect>

      <template v-if="formType === 'ENTRY'">
        <UiSelect v-model="formSupplierId" label="Fournisseur" required>
          <option value="">{{ uiText('Sélectionner un fournisseur') }}</option>
          <option v-for="s in activeSuppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
        </UiSelect>
        <div class="form-grid">
          <UiInput v-model="formQuantity" label="Quantité reçue" type="number" min="1" required />
          <UiInput v-model="formUnitCost" label="Coût unitaire (FCFA)" type="number" min="1" />
        </div>
        <UiInput v-model="formReference" label="N° bon / facture fournisseur" placeholder="Référence document…" />
      </template>

      <template v-else-if="formType === 'EXIT'">
        <UiInput
          v-model="formQuantity"
          label="Quantité sortie"
          type="number"
          min="1"
          :max="selectedProduct?.quantity"
          required
        />
        <UiInput v-model="formReference" label="Motif / référence" placeholder="Ex. périmé, casse…" />
      </template>

      <template v-else>
        <UiInput
          v-model="formTargetQuantity"
          label="Nouveau stock (inventaire)"
          type="number"
          min="0"
          required
        />
        <p v-if="selectedProduct" class="hint">
          {{
            translateTemplate('Stock actuel : {qty} — écart : {delta}', {
              qty: selectedProduct.quantity,
              delta: `${Number(formTargetQuantity) - selectedProduct.quantity >= 0 ? '+' : ''}${Number(formTargetQuantity) - selectedProduct.quantity}`,
            })
          }}
        </p>
      </template>

      <UiTextarea v-model="formNotes" :label="uiText('Notes')" :rows="2" :placeholder="uiText('Commentaire optionnel…')" />
    </section>
    <template #footer>
      <UiButton variant="ghost" @click="closeModal">{{ uiText('Annuler') }}</UiButton>
      <UiButton variant="primary" :icon="Save" :disabled="saving" @click="saveMovement">
        {{ saving ? uiText('Enregistrement…') : uiText('Valider le mouvement') }}
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
