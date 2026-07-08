<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { ClipboardList, Plus, RefreshCw, Save, X } from '@lucide/vue'
import api from '@/api/client'
import { fullName } from '@/lib/roles'
import { statusBadge, DT_ICONS } from '@/lib/datatable-defaults'
import type { LogisticsItemRecord } from '@/components/logistique/LogisticsItemsPanel.vue'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

type RequestStatus = 'PENDING' | 'FULFILLED' | 'REJECTED'

type RequestLine = {
  id: string
  itemId: string
  quantityRequested: number
  quantityIssued: number
  item: { id: string; name: string; sku: string; unit: string; quantity: number }
}

type RequestRecord = {
  id: string
  code: string
  service: string
  status: RequestStatus
  notes: string | null
  createdAt: string
  handledAt: string | null
  requestedBy: { id: string; firstName: string; lastName: string }
  handledBy: { id: string; firstName: string; lastName: string } | null
  lines: RequestLine[]
}

const LOGISTICS_SERVICES = [
  'Laboratoire',
  'Bloc opératoire',
  'Hospitalisation',
  'Réception',
  'Consultation',
  'Administration',
  'Autre',
]

const emit = defineEmits<{ changed: [] }>()

const requests = ref<RequestRecord[]>([])
const items = ref<LogisticsItemRecord[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const modalOpen = ref(false)
const filterStatus = ref('')

const formService = ref(LOGISTICS_SERVICES[0])
const formNotes = ref('')
const formLines = ref<Array<{ itemId: string; quantityRequested: string }>>([{ itemId: '', quantityRequested: '1' }])

const statusLabels: Record<RequestStatus, string> = {
  PENDING: 'En attente',
  FULFILLED: 'Livrée',
  REJECTED: 'Refusée',
}

const statusVariants: Record<RequestStatus, 'warning' | 'success' | 'danger'> = {
  PENDING: 'warning',
  FULFILLED: 'success',
  REJECTED: 'danger',
}

const activeItems = computed(() => items.value.filter((p) => p.active))

const tableRows = computed(() =>
  requests.value.map((r) => ({
    id: r.id,
    code: r.code,
    service: r.service,
    date: new Date(r.createdAt).toLocaleString('fr-FR'),
    dateSort: new Date(r.createdAt).getTime(),
    requestedBy: fullName(r.requestedBy.firstName, r.requestedBy.lastName),
    linesCount: r.lines.length,
    linesLabel: `${r.lines.length} article(s)`,
    status: r.status,
    statusLabel: statusLabels[r.status],
    statusVariant: statusVariants[r.status],
    canFulfill: r.status === 'PENDING',
    canReject: r.status === 'PENDING',
  })),
)

const columns = [
  {
    data: 'code',
    title: 'N° bon',
    responsivePriority: 1,
    render: (code: string) => `<span class="dt-name">${code}</span>`,
  },
  { data: 'service', title: 'Service', responsivePriority: 1 },
  {
    data: 'dateSort',
    title: 'Date',
    responsivePriority: 2,
    render: (_d: number, _t: string, row: { date: string }) => row.date,
  },
  { data: 'requestedBy', title: 'Demandeur', responsivePriority: 3 },
  { data: 'linesLabel', title: 'Articles', responsivePriority: 3 },
  {
    data: 'statusLabel',
    title: 'Statut',
    responsivePriority: 2,
    render: (label: string, _t: string, row: { statusVariant: string }) =>
      statusBadge(label, row.statusVariant as 'warning' | 'success' | 'danger'),
  },
  {
    data: null,
    title: 'Actions',
    orderable: false,
    className: 'dt-actions-col all',
    responsivePriority: 1,
    render: (_d: unknown, _t: string, row: { id: string; canFulfill: boolean; canReject: boolean }) => {
      if (!row.canFulfill && !row.canReject) return '—'
      return `
        <div class="dt-row-actions" data-id="${row.id}">
          ${row.canFulfill ? `<button type="button" class="dt-btn dt-btn--icon dt-btn--catalog-on" data-action="fulfill" title="Livrer" aria-label="Livrer">${DT_ICONS.check}</button>` : ''}
          ${row.canReject ? `<button type="button" class="dt-btn dt-btn--icon dt-btn--catalog-off" data-action="reject" title="Refuser" aria-label="Refuser">${DT_ICONS.ban}</button>` : ''}
        </div>
      `
    },
  },
]

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === 'string') {
    return error.response.data.error
  }
  return fallback
}

async function loadItems() {
  const { data } = await api.get<LogisticsItemRecord[]>('/logistique/items')
  items.value = data
}

async function loadRequests() {
  loading.value = true
  message.value = ''
  try {
    const params = filterStatus.value ? { status: filterStatus.value } : undefined
    const { data } = await api.get<RequestRecord[]>('/logistique/requests', { params })
    requests.value = data
  } catch {
    message.value = 'Impossible de charger les demandes.'
    messageType.value = 'error'
    requests.value = []
  } finally {
    loading.value = false
  }
}

async function reload() {
  await Promise.all([loadItems(), loadRequests()])
}

function resetForm() {
  formService.value = LOGISTICS_SERVICES[0]
  formNotes.value = ''
  formLines.value = [{ itemId: '', quantityRequested: '1' }]
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

function addLine() {
  formLines.value.push({ itemId: '', quantityRequested: '1' })
}

function removeLine(index: number) {
  if (formLines.value.length <= 1) return
  formLines.value.splice(index, 1)
}

async function saveRequest() {
  const lines = formLines.value
    .filter((line) => line.itemId && Number(line.quantityRequested) > 0)
    .map((line) => ({ itemId: line.itemId, quantityRequested: Number(line.quantityRequested) }))

  if (!formService.value.trim()) {
    message.value = 'Sélectionnez un service.'
    messageType.value = 'error'
    return
  }
  if (!lines.length) {
    message.value = 'Ajoutez au moins un article.'
    messageType.value = 'error'
    return
  }

  saving.value = true
  message.value = ''
  try {
    await api.post('/logistique/requests', {
      service: formService.value,
      notes: formNotes.value.trim() || undefined,
      lines,
    })
    message.value = 'Demande enregistrée.'
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

async function fulfillRequest(id: string) {
  if (!window.confirm('Confirmer la livraison de cette demande ? Le stock sera déduit.')) return
  try {
    await api.post(`/logistique/requests/${id}/fulfill`)
    message.value = 'Demande livrée — stock mis à jour.'
    messageType.value = 'success'
    emit('changed')
    await reload()
  } catch (error) {
    message.value = apiErrorMessage(error, 'Livraison impossible.')
    messageType.value = 'error'
  }
}

async function rejectRequest(id: string) {
  if (!window.confirm('Refuser cette demande ?')) return
  try {
    await api.post(`/logistique/requests/${id}/reject`)
    message.value = 'Demande refusée.'
    messageType.value = 'success'
    emit('changed')
    await reload()
  } catch (error) {
    message.value = apiErrorMessage(error, 'Action impossible.')
    messageType.value = 'error'
  }
}

function onTableAction({ action, id }: { action: string; id: string }) {
  if (action === 'fulfill') fulfillRequest(id)
  if (action === 'reject') rejectRequest(id)
}

onMounted(reload)

defineExpose({ reload })
</script>

<template>
  <PageTableSection embedded>
    <template #toolbar>
      <select v-model="filterStatus" class="filter-select" @change="loadRequests">
        <option value="">Tous les statuts</option>
        <option value="PENDING">En attente</option>
        <option value="FULFILLED">Livrées</option>
        <option value="REJECTED">Refusées</option>
      </select>
      <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading || saving" @click="reload">
        Actualiser
      </UiButton>
      <UiButton variant="primary" size="sm" :icon="Plus" @click="openCreateModal">
        Nouvelle demande
      </UiButton>
    </template>

    <UiAlert v-if="message && !modalOpen" :type="messageType" :message="message" class="panel-alert" />

    <p v-if="!loading && !requests.length" class="empty">Aucune demande enregistrée</p>
    <UiDataTable
      v-else
      fill
      table-key="logistics-requests"
      compact
      :data="tableRows"
      :columns="columns"
      :loading="loading"
      loading-label="Chargement des demandes…"
      @action="onTableAction"
    />
  </PageTableSection>

  <UiFormModal
    v-if="modalOpen"
    title-id="logistics-request-modal-title"
    title="Nouvelle demande interne"
    subtitle="Bon de sortie pour un service de la clinique"
    :icon="ClipboardList"
    size="large"
    @close="closeModal"
  >
    <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />
    <section class="form-panel">
      <UiSelect v-model="formService" label="Service demandeur" required>
        <option v-for="service in LOGISTICS_SERVICES" :key="service" :value="service">{{ service }}</option>
      </UiSelect>

      <div class="lines-section">
        <div class="lines-section__head">
          <strong>Articles demandés</strong>
          <UiButton variant="ghost" size="sm" :icon="Plus" @click="addLine">Ajouter une ligne</UiButton>
        </div>
        <div v-for="(line, index) in formLines" :key="index" class="line-row">
          <UiSelect v-model="line.itemId" label="Article">
            <option value="">Sélectionner</option>
            <option v-for="item in activeItems" :key="item.id" :value="item.id">
              {{ item.name }} ({{ item.quantity }} {{ item.unit }})
            </option>
          </UiSelect>
          <UiInput v-model="line.quantityRequested" label="Quantité" type="number" min="1" />
          <UiButton
            v-if="formLines.length > 1"
            variant="ghost"
            size="sm"
            :icon="X"
            class="line-row__remove"
            @click="removeLine(index)"
          />
        </div>
      </div>

      <UiTextarea v-model="formNotes" label="Notes" :rows="2" placeholder="Motif ou précisions…" />
    </section>
    <template #footer>
      <UiButton variant="ghost" @click="closeModal">Annuler</UiButton>
      <UiButton variant="primary" :icon="Save" :disabled="saving" @click="saveRequest">
        {{ saving ? 'Enregistrement…' : 'Enregistrer la demande' }}
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

.filter-select {
  min-width: 160px;
  padding: 0.4rem 0.6rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #fff;
  font-family: inherit;
  font-size: 0.8125rem;
  color: var(--text);
}

.lines-section {
  margin: 0.5rem 0 1rem;
}

.lines-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
}

.line-row {
  display: grid;
  grid-template-columns: 1fr 120px auto;
  gap: 0.75rem;
  align-items: end;
  margin-bottom: 0.5rem;
}

.line-row__remove {
  margin-bottom: 1rem;
}

@media (max-width: 640px) {
  .line-row {
    grid-template-columns: 1fr;
  }

  .line-row__remove {
    margin-bottom: 0;
  }
}
</style>
