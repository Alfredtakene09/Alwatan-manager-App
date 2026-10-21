<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  PackageX,
  AlertTriangle,
  PackageMinus,
  Clock,
  CalendarX,
  Trash2,
  Plus,
  Minus,
  Save,
  ArrowDownUp,
} from '@lucide/vue'
import api from '@/api/client'
import { canWritePharmacyCatalog } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth'
import type { PharmacySupplierRecord } from '@/components/pharmacie/PharmacySuppliersPanel.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import {
  buildClinicPrintHeader,
  openPrintDocument,
} from '@/lib/print-document'
import {
  exportBasename,
  exportWorkbook,
  exportWorkbookWord,
  rowsToHtmlTable,
  type ExportColumn,
} from '@/lib/table-export'
import { confirmAppModal, showSuccessModal } from '@/lib/api-modal-helper'
import { translateTemplate } from '@/lib/dashboard-i18n'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiButton from '@/components/ui/UiButton.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import UiAlert from '@/components/ui/UiAlert.vue'

type StockAlertItem = {
  productId: string
  name: string
  sku: string
  quantity: number
  minStock: number
  unitPriceFcfa: number
  categoryName: string | null
  level: 'out' | 'critical' | 'low'
  kind: 'stock'
}

type ExpiryAlertItem = {
  productId: string
  name: string
  sku: string
  expiryDate: string
  daysLeft: number
  level: 'expired' | 'soon'
  kind: 'expiry'
}

type AlertsResponse = {
  count: number
  outOfStock: number
  critical: number
  low: number
  expirySoon: number
  expired: number
  stockItems: StockAlertItem[]
  expiryItems: ExpiryAlertItem[]
}

type AlertFilter = 'out' | 'critical' | 'low' | 'soon' | 'expired'

type AlertCard = {
  id: string
  productId: string
  name: string
  detail: string
  meta: string
  levelLabel: string
  variant: 'danger' | 'warning' | 'muted'
  quantity: number | null
}

const data = ref<AlertsResponse | null>(null)
const loading = ref(false)
const removing = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('error')
const activeFilter = ref<AlertFilter>('out')

const { uiText, localeCode } = useAppI18n()

const filterButtons = computed(() => {
  void localeCode.value
  const d = data.value
  return [
    {
      key: 'out' as const,
      count: d?.outOfStock ?? 0,
      label: uiText('rupture(s)'),
      variant: 'danger' as const,
      icon: PackageX,
    },
    {
      key: 'critical' as const,
      count: d?.critical ?? 0,
      label: uiText('critique(s)'),
      variant: 'warning' as const,
      icon: AlertTriangle,
    },
    {
      key: 'low' as const,
      count: d?.low ?? 0,
      label: uiText('stock bas'),
      variant: 'muted' as const,
      icon: PackageMinus,
    },
    {
      key: 'soon' as const,
      count: d?.expirySoon ?? 0,
      label: uiText('expiration proche'),
      variant: 'warning' as const,
      icon: Clock,
    },
    {
      key: 'expired' as const,
      count: d?.expired ?? 0,
      label: uiText('expiré(s)'),
      variant: 'danger' as const,
      icon: CalendarX,
    },
  ]
})

const activeFilterMeta = computed(
  () => filterButtons.value.find((b) => b.key === activeFilter.value) ?? filterButtons.value[0]!,
)

const filteredCards = computed((): AlertCard[] => {
  void localeCode.value
  const d = data.value
  if (!d) return []

  if (activeFilter.value === 'out' || activeFilter.value === 'critical' || activeFilter.value === 'low') {
    const level = activeFilter.value
    return d.stockItems
      .filter((item) => item.level === level)
      .map((item) => ({
        id: `stock-${item.productId}`,
        productId: item.productId,
        name: item.name,
        detail: translateTemplate('Stock {qty} · min {min}', {
          qty: item.quantity,
          min: item.minStock,
        }),
        meta: level === 'out' ? uiText('Rupture') : level === 'critical' ? uiText('Critique') : uiText('Stock bas'),
        levelLabel: level === 'out' ? uiText('Rupture') : level === 'critical' ? uiText('Critique') : uiText('Bas'),
        variant: (level === 'low' ? 'warning' : 'danger') as 'danger' | 'warning',
        quantity: item.quantity,
      }))
  }

  const level = activeFilter.value
  return d.expiryItems
    .filter((item) => item.level === level)
    .map((item) => ({
      id: `expiry-${item.productId}`,
      productId: item.productId,
      name: item.name,
      detail:
        item.daysLeft < 0
          ? translateTemplate('Expiré depuis {n} j', { n: Math.abs(item.daysLeft) })
          : translateTemplate('Dans {n} jour(s)', { n: item.daysLeft }),
      meta: new Date(`${item.expiryDate}T12:00:00`).toLocaleDateString('fr-FR'),
      levelLabel: level === 'expired' ? uiText('Expiré') : uiText('Expire bientôt'),
      variant: (level === 'expired' ? 'danger' : 'warning') as 'danger' | 'warning',
      quantity: d.stockItems.find((s) => s.productId === item.productId)?.quantity ?? null,
    }))
})

const expiredCount = computed(() => data.value?.expired ?? 0)
const showRemoveExpired = computed(() => activeFilter.value === 'expired' && expiredCount.value > 0)

const hasAlertRows = computed(
  () => (data.value?.stockItems.length ?? 0) + (data.value?.expiryItems.length ?? 0) > 0,
)

function selectFilter(key: AlertFilter) {
  activeFilter.value = key
}

function pickDefaultFilter(response: AlertsResponse) {
  const order: AlertFilter[] = ['out', 'critical', 'low', 'soon', 'expired']
  const counts: Record<AlertFilter, number> = {
    out: response.outOfStock,
    critical: response.critical,
    low: response.low,
    soon: response.expirySoon,
    expired: response.expired,
  }
  const firstWithItems = order.find((key) => counts[key] > 0)
  activeFilter.value = firstWithItems ?? 'out'
}

async function loadAlerts(options: { keepFilter?: boolean; keepMessage?: boolean } = {}) {
  loading.value = true
  if (!options.keepMessage) message.value = ''
  try {
    const { data: response } = await api.get<AlertsResponse>('/pharmacie/alerts')
    data.value = response
    if (!options.keepFilter) pickDefaultFilter(response)
  } catch {
    message.value = 'Impossible de charger les alertes.'
    messageType.value = 'error'
    data.value = null
  } finally {
    loading.value = false
  }
}

async function removeAllExpired() {
  if (!expiredCount.value || removing.value) return
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Retirer les produits expirés',
    message: translateTemplate(
      'Désactiver {n} produit(s) expiré(s) et remettre le stock à 0 ? Cette action est irréversible.',
      { n: expiredCount.value },
    ),
    confirmLabel: 'Retirer',
    cancelLabel: 'Annuler',
  })
  if (!confirmed) return

  removing.value = true
  message.value = ''
  try {
    const { data: result } = await api.post<{ removedCount: number; message?: string }>(
      '/pharmacie/products/remove-expired',
    )
    await showSuccessModal(
      'Produits retirés',
      result.message ?? `${result.removedCount} produit(s) expiré(s) retiré(s).`,
    )
    await loadAlerts()
  } catch (error: unknown) {
    const apiMessage =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
    message.value = apiMessage ?? 'Impossible de retirer les produits expirés.'
    messageType.value = 'error'
  } finally {
    removing.value = false
  }
}

async function removeOneExpired(card: AlertCard) {
  if (removing.value) return
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Retirer ce produit',
    message: translateTemplate(
      'Retirer « {name} » du catalogue (expiré) et remettre le stock à 0 ?',
      { name: card.name },
    ),
    confirmLabel: 'Retirer',
    cancelLabel: 'Annuler',
  })
  if (!confirmed) return

  removing.value = true
  message.value = ''
  try {
    const { data: result } = await api.post<{ message?: string }>(
      `/pharmacie/products/${card.productId}/retire-expired`,
    )
    message.value = result.message ?? 'Produit retiré.'
    messageType.value = 'success'
    await loadAlerts({ keepFilter: true, keepMessage: true })
  } catch (error: unknown) {
    const apiMessage =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
    message.value = apiMessage ?? 'Impossible de retirer ce produit.'
    messageType.value = 'error'
  } finally {
    removing.value = false
  }
}

const auth = useAuthStore()
const canManageStock = computed(() => canWritePharmacyCatalog(auth.user))

const stockModalCard = ref<AlertCard | null>(null)
const stockModalType = ref<'ENTRY' | 'EXIT'>('ENTRY')
const stockQuantity = ref('1')
const stockSupplierId = ref('')
const stockUnitCost = ref('')
const stockReference = ref('')
const stockSaving = ref(false)
const stockError = ref('')
const suppliers = ref<PharmacySupplierRecord[]>([])
const suppliersLoaded = ref(false)

const activeSuppliers = computed(() => suppliers.value.filter((s) => s.active))

async function ensureSuppliers() {
  if (suppliersLoaded.value) return
  try {
    const { data: list } = await api.get<PharmacySupplierRecord[]>('/pharmacie/suppliers')
    suppliers.value = list
    suppliersLoaded.value = true
  } catch {
    stockError.value = 'Impossible de charger les fournisseurs.'
  }
}

function openStockModal(card: AlertCard, type: 'ENTRY' | 'EXIT') {
  stockModalCard.value = card
  stockModalType.value = type
  stockQuantity.value = '1'
  stockSupplierId.value = ''
  stockUnitCost.value = ''
  stockReference.value = ''
  stockError.value = ''
  if (type === 'ENTRY') void ensureSuppliers()
}

function closeStockModal() {
  if (stockSaving.value) return
  stockModalCard.value = null
}

async function saveStockMovement() {
  const card = stockModalCard.value
  if (!card || stockSaving.value) return
  const qty = Number(stockQuantity.value)
  if (!Number.isInteger(qty) || qty <= 0) {
    stockError.value = 'Quantité invalide.'
    return
  }
  if (stockModalType.value === 'EXIT' && card.quantity !== null && qty > card.quantity) {
    stockError.value = translateTemplate('Stock insuffisant (disponible : {qty}).', { qty: card.quantity })
    return
  }
  if (stockModalType.value === 'ENTRY' && !stockSupplierId.value) {
    stockError.value = 'Sélectionnez un fournisseur pour une entrée.'
    return
  }

  const payload: Record<string, unknown> = {
    productId: card.productId,
    type: stockModalType.value,
    quantity: qty,
    reference: stockReference.value.trim() || undefined,
  }
  if (stockModalType.value === 'ENTRY') {
    payload.supplierId = stockSupplierId.value
    const unitCost = Number(stockUnitCost.value)
    if (Number.isFinite(unitCost) && unitCost > 0) payload.unitCostFcfa = Math.round(unitCost)
  }

  stockSaving.value = true
  stockError.value = ''
  try {
    await api.post('/pharmacie/stock-movements', payload)
    stockSaving.value = false
    stockModalCard.value = null
    message.value = translateTemplate(
      stockModalType.value === 'ENTRY' ? '{qty} unité(s) ajoutée(s) à « {name} ».' : '{qty} unité(s) retirée(s) de « {name} ».',
      { qty, name: card.name },
    )
    messageType.value = 'success'
    await loadAlerts({ keepFilter: true, keepMessage: true })
  } catch (error: unknown) {
    const apiMessage =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
    stockError.value = apiMessage ?? 'Enregistrement impossible.'
  } finally {
    stockSaving.value = false
  }
}

type ExportRow = { name: string; detail: string; meta: string; levelLabel: string }

const exportColumns = computed<ExportColumn<ExportRow>[]>(() => {
  void localeCode.value
  return [
    { header: uiText('Produit'), value: (r) => r.name },
    { header: uiText('Détail'), value: (r) => r.detail },
    { header: uiText('Info'), value: (r) => r.meta },
    { header: uiText('Alerte'), value: (r) => r.levelLabel },
  ]
})

function exportPdf() {
  if (!filteredCards.value.length) return
  const title = `${activeFilterMeta.value.count} ${activeFilterMeta.value.label}`
  const body = `${buildClinicPrintHeader(uiText('Alertes pharmacie'))}
<h3>${title}</h3>
${rowsToHtmlTable(exportColumns.value, filteredCards.value)}`
  openPrintDocument(uiText('Alertes pharmacie'), body, { pageSize: 'A4', autoPrint: true })
}

function exportExcel() {
  if (!filteredCards.value.length) return
  exportWorkbook(exportBasename('alertes-pharmacie'), [
    {
      name: activeFilterMeta.value.label,
      columns: exportColumns.value,
      rows: filteredCards.value,
    },
  ])
}

function exportWord() {
  if (!filteredCards.value.length) return
  void exportWorkbookWord(exportBasename('alertes-pharmacie'), [
    {
      name: activeFilterMeta.value.label,
      columns: exportColumns.value,
      rows: filteredCards.value,
    },
  ])
}

watch(
  () => data.value,
  (next) => {
    if (!next) return
    const current = filterButtons.value.find((b) => b.key === activeFilter.value)
    if (current && current.count === 0) pickDefaultFilter(next)
  },
)

onMounted(() => loadAlerts())

defineExpose({ reload: () => loadAlerts() })
</script>

<template>
  <div class="alerts-layout">
    <div class="alerts-toolbar">
      <strong class="alerts-toolbar__title">{{ uiText('Filtres d’alertes') }}</strong>
      <div class="alerts-toolbar__actions">
        <UiButton
          v-if="showRemoveExpired"
          variant="danger"
          size="sm"
          :icon="Trash2"
          :disabled="loading || removing"
          @click="removeAllExpired"
        >
          {{ removing ? uiText('Retrait…') : uiText('Retirer les produits expirés') }}
        </UiButton>
        <ExportButtons
          :disabled="loading || !filteredCards.length"
          @pdf="exportPdf"
          @excel="exportExcel"
          @word="exportWord"
        />
      </div>
    </div>

    <UiAlert v-if="message" :type="messageType" :message="message" />

    <div class="alert-filters" role="tablist" :aria-label="uiText('Types d’alertes')">
      <button
        v-for="btn in filterButtons"
        :key="btn.key"
        type="button"
        role="tab"
        class="filter-btn"
        :class="[
          `filter-btn--${btn.variant}`,
          { 'filter-btn--active': activeFilter === btn.key },
        ]"
        :aria-selected="activeFilter === btn.key"
        :disabled="loading"
        @click="selectFilter(btn.key)"
      >
        <component :is="btn.icon" :size="18" class="filter-btn__icon" aria-hidden="true" />
        <span class="filter-btn__count">{{ btn.count }}</span>
        <span class="filter-btn__label">{{ btn.label }}</span>
      </button>
    </div>

    <div class="alerts-panel">
      <header class="alerts-panel__head">
        <div>
          <h3>
            {{ activeFilterMeta.count }}
            {{ activeFilterMeta.label }}
          </h3>
          <p>{{ translateTemplate('{n} produit(s) affiché(s)', { n: filteredCards.length }) }}</p>
        </div>
      </header>

      <p v-if="loading" class="empty">{{ uiText('Chargement des alertes…') }}</p>
      <p v-else-if="!hasAlertRows" class="empty">{{ uiText('Aucune alerte pour le moment.') }}</p>
      <p v-else-if="!filteredCards.length" class="empty">{{ uiText('Aucun produit dans cette catégorie.') }}</p>

      <div v-else class="alert-cards" role="list">
        <article
          v-for="card in filteredCards"
          :key="card.id"
          class="alert-card"
          :class="`alert-card--${card.variant}`"
          role="listitem"
        >
          <div class="alert-card__top">
            <div class="alert-card__badge">{{ card.levelLabel }}</div>
            <UiButton
              v-if="activeFilter === 'expired'"
              type="button"
              variant="ghost"
              size="sm"
              :icon="Trash2"
              :disabled="removing"
              @click="removeOneExpired(card)"
            >
              {{ uiText('Retirer') }}
            </UiButton>
          </div>
          <h4 class="alert-card__name">{{ card.name }}</h4>
          <p class="alert-card__detail">{{ card.detail }}</p>
          <p class="alert-card__meta">{{ card.meta }}</p>
          <div v-if="canManageStock && activeFilter !== 'expired'" class="alert-card__actions">
            <button
              type="button"
              class="stock-btn stock-btn--add"
              :disabled="loading || stockSaving"
              @click="openStockModal(card, 'ENTRY')"
            >
              <Plus :size="15" aria-hidden="true" />
              {{ uiText('Ajouter') }}
            </button>
            <button
              type="button"
              class="stock-btn stock-btn--remove"
              :disabled="loading || stockSaving || card.quantity === 0"
              @click="openStockModal(card, 'EXIT')"
            >
              <Minus :size="15" aria-hidden="true" />
              {{ uiText('Retirer') }}
            </button>
          </div>
        </article>
      </div>
    </div>
  </div>

  <UiFormModal
    v-if="stockModalCard"
    title-id="pharmacy-alert-stock-modal-title"
    :title="stockModalType === 'ENTRY' ? uiText('Ajouter du stock') : uiText('Retirer du stock')"
    :subtitle="stockModalCard.name"
    :icon="ArrowDownUp"
    :body-scroll="false"
    @close="closeStockModal"
  >
    <UiAlert v-if="stockError" type="error" :message="stockError" />
    <section class="form-panel">
      <p v-if="stockModalCard.quantity !== null" class="stock-hint">
        {{ translateTemplate('Stock actuel : {qty}', { qty: stockModalCard.quantity }) }}
      </p>
      <template v-if="stockModalType === 'ENTRY'">
        <UiSelect v-model="stockSupplierId" label="Fournisseur" required>
          <option value="">{{ uiText('Sélectionner un fournisseur') }}</option>
          <option v-for="s in activeSuppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
        </UiSelect>
        <div class="stock-form-grid">
          <UiInput v-model="stockQuantity" label="Quantité reçue" type="number" min="1" required />
          <UiInput v-model="stockUnitCost" label="Coût unitaire (FCFA)" type="number" min="1" />
        </div>
        <UiInput v-model="stockReference" label="N° bon / facture fournisseur" placeholder="Référence document…" />
      </template>
      <template v-else>
        <UiInput
          v-model="stockQuantity"
          label="Quantité sortie"
          type="number"
          min="1"
          :max="stockModalCard.quantity ?? undefined"
          required
        />
        <UiInput v-model="stockReference" label="Motif / référence" placeholder="Ex. périmé, casse…" />
      </template>
    </section>
    <template #footer>
      <UiButton variant="ghost" :disabled="stockSaving" @click="closeStockModal">{{ uiText('Annuler') }}</UiButton>
      <UiButton
        :variant="stockModalType === 'ENTRY' ? 'primary' : 'danger'"
        :icon="Save"
        :disabled="stockSaving"
        @click="saveStockMovement"
      >
        {{ stockSaving ? uiText('Enregistrement…') : uiText('Valider') }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.alerts-layout {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
}

.alerts-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
}

.alerts-toolbar__title {
  font-size: 0.95rem;
  color: var(--text);
}

.alerts-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.alert-filters {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.65rem;
}

.filter-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  padding: 0.85rem 0.95rem;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 14px;
  background: #fff;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  font: inherit;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.15s ease;
}

.filter-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
}

.filter-btn:disabled {
  opacity: 0.65;
  cursor: wait;
}

.filter-btn__icon {
  margin-bottom: 0.15rem;
}

.filter-btn__count {
  font-size: 1.35rem;
  font-weight: 800;
  line-height: 1.1;
}

.filter-btn__label {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: lowercase;
}

.filter-btn--danger .filter-btn__icon,
.filter-btn--danger .filter-btn__count {
  color: #b91c1c;
}

.filter-btn--warning .filter-btn__icon,
.filter-btn--warning .filter-btn__count {
  color: #b45309;
}

.filter-btn--muted .filter-btn__icon,
.filter-btn--muted .filter-btn__count {
  color: #475569;
}

.filter-btn--danger.filter-btn--active {
  border-color: #fca5a5;
  background: #fef2f2;
  box-shadow: inset 0 0 0 1px #fecaca;
}

.filter-btn--warning.filter-btn--active {
  border-color: #fcd34d;
  background: #fffbeb;
  box-shadow: inset 0 0 0 1px #fde68a;
}

.filter-btn--muted.filter-btn--active {
  border-color: #cbd5e1;
  background: #f8fafc;
  box-shadow: inset 0 0 0 1px #e2e8f0;
}

.alerts-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 0;
}

.alerts-panel__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.alerts-panel__head h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  text-transform: capitalize;
}

.alerts-panel__head p {
  margin: 0.2rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.alert-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.75rem;
}

.alert-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.9rem 1rem;
  border-radius: 14px;
  border: 1px solid var(--border, #e2e8f0);
  background: #fff;
  min-height: 7.5rem;
}

.alert-card--danger {
  border-color: #fecaca;
  background: linear-gradient(180deg, #fff, #fff5f5);
}

.alert-card--warning {
  border-color: #fde68a;
  background: linear-gradient(180deg, #fff, #fffbeb);
}

.alert-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
}

.alert-card__badge {
  align-self: flex-start;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  font-size: 0.65rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.alert-card--danger .alert-card__badge {
  background: #fee2e2;
  color: #b91c1c;
}

.alert-card--warning .alert-card__badge {
  background: #fef3c7;
  color: #b45309;
}

.alert-card__name {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 800;
  line-height: 1.25;
  color: var(--text);
}

.alert-card__detail,
.alert-card__meta {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.alert-card__detail {
  font-weight: 700;
  color: var(--text);
}

.alert-card__actions {
  display: flex;
  gap: 0.4rem;
  margin-top: auto;
  padding-top: 0.45rem;
}

.stock-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  padding: 0.38rem 0.5rem;
  border-radius: 9px;
  border: 1px solid transparent;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.stock-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.stock-btn--add {
  background: #ecfdf5;
  border-color: #a7f3d0;
  color: #047857;
}

.stock-btn--add:hover:not(:disabled) {
  background: #d1fae5;
}

.stock-btn--remove {
  background: #fff;
  border-color: #fecaca;
  color: #b91c1c;
}

.stock-btn--remove:hover:not(:disabled) {
  background: #fef2f2;
}

.stock-hint {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--text-muted);
}

.stock-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.empty {
  text-align: center;
  color: var(--text-light);
  padding: 1.75rem 1rem;
  font-size: 0.875rem;
  background: var(--surface-muted, #f8fafc);
  border-radius: 12px;
}

@media (max-width: 1100px) {
  .alert-filters {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .alert-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .alert-cards {
    grid-template-columns: 1fr;
  }
}
</style>
