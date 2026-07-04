<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Settings, Scissors, Package, BedDouble, Eye } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { statusBadge, catalogRowActionsHtml } from '@/lib/datatable-defaults'
import { clinicPercentFromSplits } from '@/lib/intervention-splits'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

const interventions = ref<any[]>([])
const products = ref<any[]>([])
const rooms = ref<any[]>([])
const message = ref('')
const tab = ref<'interventions' | 'products' | 'rooms'>('interventions')
const viewModalOpen = ref(false)
const viewingIntervention = ref<any | null>(null)

const interventionsById = computed(() => new Map(interventions.value.map((i) => [i.id, i])))

const CATEGORY_LABELS: Record<string, string> = {
  MAJEURE_A: 'Majeure (A)',
  MOYENNE_B: 'Moyenne (B)',
  PETITE_C: 'Petite (C)',
}

const interventionRows = computed(() =>
  interventions.value.map((item) => ({
    id: item.id,
    label: item.label,
    code: item.code,
    category: CATEGORY_LABELS[item.category] ?? item.category,
    cost: formatFcfa(item.totalCostFcfa),
    costSort: item.totalCostFcfa,
    surgeonPercent: `${item.surgeonPercent}%`,
    active: item.active,
    statusLabel: item.active ? 'Actif' : 'Inactif',
    statusVariant: item.active ? 'success' : 'danger',
    toggleLabel: item.active ? 'Désactiver' : 'Activer',
    isActive: item.active,
  })),
)

const productRows = computed(() =>
  products.value.map((item) => ({
    id: item.id,
    name: item.name,
    sku: item.sku,
    price: formatFcfa(item.unitPriceFcfa),
    priceSort: item.unitPriceFcfa,
    quantity: item.quantity,
    minStock: item.minStock,
    stockLabel: `${item.quantity} unités`,
    lowStock: item.quantity <= item.minStock,
    statusVariant: item.quantity <= item.minStock ? 'danger' : 'success',
  })),
)

const roomRows = computed(() =>
  rooms.value.map((room) => ({
    id: room.id,
    name: room.name,
    type: room.type,
    rate: `${formatFcfa(room.dailyRateFcfa)}/nuit`,
    rateSort: room.dailyRateFcfa,
    activeLabel: room.active ? 'Active' : 'Inactive',
    typeVariant: room.type === 'VIP' ? 'primary' : 'info',
  })),
)

const interventionColumns = [
  { data: 'label', title: 'Libellé', render: (v: string) => `<span class="dt-name">${v}</span>` },
  { data: 'code', title: 'Code' },
  { data: 'category', title: 'Catégorie' },
  {
    data: 'costSort',
    title: 'Coût',
    render: (_d: number, _t: string, row: { cost: string }) => `<span class="dt-amount">${row.cost}</span>`,
  },
  { data: 'surgeonPercent', title: '% Chirurgien' },
  {
    data: 'statusLabel',
    title: 'Statut',
    render: (label: string, _t: string, row: { statusVariant: string }) =>
      statusBadge(label, row.statusVariant as 'success' | 'danger'),
  },
  {
    data: null,
    title: 'Actions',
    orderable: false,
    className: 'dt-actions-col dt-actions-col--catalog',
    render: (
      _d: unknown,
      _t: string,
      row: { id: string; toggleLabel: string; isActive: boolean },
    ) => catalogRowActionsHtml({ ...row, showEdit: false, showView: true, canDelete: false }),
  },
]

const productColumns = [
  { data: 'name', title: 'Produit', render: (v: string) => `<span class="dt-name">${v}</span>` },
  { data: 'sku', title: 'SKU' },
  {
    data: 'priceSort',
    title: 'Prix unitaire',
    render: (_d: number, _t: string, row: { price: string }) => `<span class="dt-amount">${row.price}</span>`,
  },
  {
    data: 'quantity',
    title: 'Stock',
    render: (_qty: number, _t: string, row: { stockLabel: string; statusVariant: string }) =>
      statusBadge(row.stockLabel, row.statusVariant as 'success' | 'danger'),
  },
  { data: 'minStock', title: 'Stock min.' },
]

const roomColumns = [
  { data: 'name', title: 'Salle', render: (v: string) => `<span class="dt-name">${v}</span>` },
  {
    data: 'type',
    title: 'Type',
    render: (type: string, _t: string, row: { typeVariant: string }) =>
      statusBadge(type, row.typeVariant as 'primary' | 'info'),
  },
  {
    data: 'rateSort',
    title: 'Tarif nuitée',
    render: (_d: number, _t: string, row: { rate: string }) => `<span class="dt-date">${row.rate}</span>`,
  },
  {
    data: 'activeLabel',
    title: 'Statut',
    render: (label: string) => label,
  },
]

async function load() {
  const [i, p, r] = await Promise.all([
    api.get('/admin/interventions'),
    api.get('/admin/products'),
    api.get('/admin/rooms'),
  ])
  interventions.value = i.data
  products.value = p.data
  rooms.value = r.data
}

async function toggleIntervention(id: string) {
  const item = interventionsById.value.get(id)
  if (!item) return
  await api.put(`/admin/interventions/${id}`, { active: !item.active })
  load()
}

function openViewIntervention(id: string) {
  viewingIntervention.value = interventionsById.value.get(id) ?? null
  if (!viewingIntervention.value) return
  viewModalOpen.value = true
}

function closeViewIntervention() {
  viewModalOpen.value = false
  viewingIntervention.value = null
}

function viewingClinicPercent(item: { surgeonPercent: number; anesthesiologistPercent?: number }) {
  return clinicPercentFromSplits(item.surgeonPercent, item.anesthesiologistPercent ?? 0)
}

function onInterventionAction({ action, id }: { action: string; id: string }) {
  if (action === 'view') openViewIntervention(id)
  if (action === 'toggle') toggleIntervention(id)
}

onMounted(load)
</script>

<template>
  <div>
    <UiPageHeader
      title="Administration"
      subtitle="Paramétrage nomenclature chirurgicale, produits pharmacie et salles"
      :icon="Settings"
    />

    <UiAlert v-if="message" type="success" :message="message" />

    <div class="tabs">
      <button :class="{ active: tab === 'interventions' }" @click="tab = 'interventions'">
        <Scissors :size="16" /> Chirurgie
      </button>
      <button :class="{ active: tab === 'products' }" @click="tab = 'products'">
        <Package :size="16" /> Pharmacie
      </button>
      <button :class="{ active: tab === 'rooms' }" @click="tab = 'rooms'">
        <BedDouble :size="16" /> Salles
      </button>
    </div>

    <template v-if="tab === 'interventions'">
      <UiCard title="Nomenclature chirurgicale" description="Tarifs et pourcentages médecin opérateur" :icon="Scissors" icon-variant="rose" class="section">
        <div class="table-panel-scroll">
          <UiDataTable
            table-key="admin-interventions"
            compact
            :data="interventionRows"
            :columns="interventionColumns"
            @action="onInterventionAction"
          />
        </div>
      </UiCard>

      <UiFormModal
        v-if="viewModalOpen && viewingIntervention"
        title-id="admin-intervention-view-title"
        title="Détail de l'opération"
        :subtitle="viewingIntervention.label"
        :icon="Eye"
        @close="closeViewIntervention"
      >
        <dl class="operation-detail">
          <div class="operation-detail__row">
            <dt>Code</dt>
            <dd>{{ viewingIntervention.code }}</dd>
          </div>
          <div class="operation-detail__row">
            <dt>Libellé</dt>
            <dd>{{ viewingIntervention.label }}</dd>
          </div>
          <div class="operation-detail__row">
            <dt>Catégorie</dt>
            <dd>{{ CATEGORY_LABELS[viewingIntervention.category] ?? viewingIntervention.category }}</dd>
          </div>
          <div class="operation-detail__row">
            <dt>Coût total</dt>
            <dd class="operation-detail__amount">{{ formatFcfa(viewingIntervention.totalCostFcfa) }}</dd>
          </div>
          <div class="operation-detail__row">
            <dt>% Chirurgien</dt>
            <dd>{{ viewingIntervention.surgeonPercent }}%</dd>
          </div>
          <div class="operation-detail__row">
            <dt>% Assistant chirurgie</dt>
            <dd>
              {{
                (viewingIntervention.anesthesiologistPercent ?? 0) > 0
                  ? `${viewingIntervention.anesthesiologistPercent}%`
                  : '—'
              }}
            </dd>
          </div>
          <div class="operation-detail__row">
            <dt>% Clinique</dt>
            <dd>{{ viewingClinicPercent(viewingIntervention) }}%</dd>
          </div>
          <div class="operation-detail__row">
            <dt>Statut</dt>
            <dd>{{ viewingIntervention.active ? 'Actif' : 'Inactif' }}</dd>
          </div>
        </dl>
        <template #footer>
          <UiButton variant="ghost" @click="closeViewIntervention">Fermer</UiButton>
        </template>
      </UiFormModal>
    </template>

    <template v-if="tab === 'products'">
      <UiCard title="Catalogue pharmacie" :icon="Package" icon-variant="violet" class="section">
        <div class="table-panel-scroll">
          <UiDataTable
            table-key="admin-products"
            compact
            :data="productRows"
            :columns="productColumns"
          />
        </div>
      </UiCard>
    </template>

    <template v-if="tab === 'rooms'">
      <UiCard title="Salles & tarifs nuitée" :icon="BedDouble" icon-variant="blue" class="section">
        <div class="table-panel-scroll">
          <UiDataTable
            table-key="admin-rooms"
            compact
            :data="roomRows"
            :columns="roomColumns"
          />
        </div>
      </UiCard>
    </template>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}

.tabs button {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.6rem 1rem;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  cursor: pointer;
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-muted);
}

.tabs button.active {
  background: var(--primary-50);
  border-color: var(--primary-500);
  color: var(--primary-800);
}

.section {
  margin-top: 0.5rem;
}

.divider {
  border: none;
  border-top: 1px dashed var(--border);
  margin: 1.25rem 0;
}

h4 {
  margin: 0 0 1rem;
  font-size: 0.9rem;
}

.operation-detail {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0;
}

.operation-detail__row {
  display: grid;
  grid-template-columns: 10rem 1fr;
  gap: 0.5rem 1rem;
  align-items: baseline;
}

.operation-detail__row dt {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.operation-detail__row dd {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--text);
}

.operation-detail__amount {
  font-weight: 700;
  color: var(--primary-800);
}
</style>
