<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { Settings, Scissors, Eye, ExternalLink } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { statusBadge, catalogRowActionsHtml } from '@/lib/datatable-defaults'
import { clinicPercentFromSplits } from '@/lib/intervention-splits'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

const { uiText, localeCode } = useAppI18n()

const interventions = ref<any[]>([])
const message = ref('')
const tab = ref<'interventions'>('interventions')
const viewModalOpen = ref(false)
const viewingIntervention = ref<any | null>(null)

const interventionsById = computed(() => new Map(interventions.value.map((i) => [i.id, i])))

function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    MAJEURE_A: 'Majeure (A)',
    MOYENNE_B: 'Moyenne (B)',
    PETITE_C: 'Petite (C)',
  }
  return uiText(labels[category] ?? category)
}

const interventionRows = computed(() => {
  localeCode.value
  return interventions.value.map((item) => ({
    id: item.id,
    label: item.label,
    code: item.code,
    category: categoryLabel(item.category),
    cost: formatFcfa(item.totalCostFcfa),
    costSort: item.totalCostFcfa,
    surgeonPercent: `${item.surgeonPercent}%`,
    active: item.active,
    statusLabel: item.active ? uiText('Actif') : uiText('Inactif'),
    statusVariant: item.active ? 'success' : 'danger',
    toggleLabel: item.active ? uiText('Désactiver') : uiText('Activer'),
    isActive: item.active,
  }))
})

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

async function load() {
  const i = await api.get('/admin/interventions')
  interventions.value = i.data
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
      subtitle="Consultation de la nomenclature chirurgicale — création et modification via Types opérations"
      :icon="Settings"
    />

    <UiAlert v-if="message" type="success" :message="message" />

    <UiAlert
      type="info"
      message="Pour créer, modifier ou supprimer une opération, utilisez Paramètres → Types opérations."
      class="admin-ops-hint"
    />

    <div class="admin-ops-actions">
      <RouterLink to="/comptabilite/types-examen/operation" class="admin-ops-link">
        <UiButton variant="secondary">
          <ExternalLink :size="16" />
          {{ uiText("Gérer les types d'opération") }}
        </UiButton>
      </RouterLink>
    </div>

    <div class="tabs">
      <button :class="{ active: tab === 'interventions' }" @click="tab = 'interventions'">
        <Scissors :size="16" /> {{ uiText('Chirurgie') }}
      </button>
    </div>

    <template v-if="tab === 'interventions'">
      <UiCard title="Nomenclature chirurgicale" description="Tarifs et pourcentages médecin opérateur — activation rapide ci-dessous" :icon="Scissors" icon-variant="rose" class="section">
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
            <dt>{{ uiText('Catégorie') }}</dt>
            <dd>{{ categoryLabel(viewingIntervention.category) }}</dd>
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
            <dt>{{ uiText('Statut') }}</dt>
            <dd>{{ viewingIntervention.active ? uiText('Actif') : uiText('Inactif') }}</dd>
          </div>
        </dl>
        <template #footer>
          <UiButton variant="ghost" @click="closeViewIntervention">Fermer</UiButton>
        </template>
      </UiFormModal>
    </template>
  </div>
</template>

<style scoped>
.admin-ops-hint {
  margin-bottom: 0.75rem;
}

.admin-ops-actions {
  margin-bottom: 1rem;
}

.admin-ops-link {
  text-decoration: none;
}

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
