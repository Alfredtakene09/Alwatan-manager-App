<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Building2, Plus, RefreshCw, Save } from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal, showDuplicateModalFromError } from '@/lib/api-modal-helper'
import { formatFcfa } from '@/lib/roles'
import { statusBadge, catalogRowActionsHtml } from '@/lib/datatable-defaults'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import '@/assets/comptabilite-section.css'

type RoomRow = {
  id: string
  name: string
  type: string
  dailyRateFcfa: number
  description?: string | null
  active: boolean
  status: 'LIBRE' | 'OCCUPE'
}

const rooms = ref<RoomRow[]>([])
const stats = ref({
  roomCount: 0,
  freeRooms: 0,
  occupiedRooms: 0,
})
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const showAddModal = ref(false)
const editingId = ref<string | null>(null)

const newRoom = ref({
  name: '',
  type: 'SIMPLE',
  dailyRateFcfa: '25000',
})

const editForm = ref({
  name: '',
  type: 'SIMPLE',
  description: '',
  dailyRateFcfa: '',
  active: true,
})

const roomsById = computed(() => new Map(rooms.value.map((room) => [room.id, room])))

const editingRoom = computed(() => (editingId.value ? roomsById.value.get(editingId.value) ?? null : null))

const tableRows = computed(() =>
  rooms.value.map((room) => {
    const isFree = room.status === 'LIBRE'
    return {
      id: room.id,
      name: room.name,
      typeLabel: room.type === 'VIP' ? 'VIP' : 'Simple',
      typeVariant: room.type === 'VIP' ? 'primary' : 'info',
      rate: formatFcfa(room.dailyRateFcfa),
      rateSort: room.dailyRateFcfa,
      availabilityLabel: isFree ? 'Libre' : 'Occupée',
      availabilityVariant: isFree ? 'success' : 'danger',
      occupancyLabel: isFree ? 'Disponible' : 'En hospitalisation',
      statusLabel: room.active ? 'Active' : 'Inactive',
      statusVariant: room.active ? 'success' : 'danger',
      toggleLabel: room.active ? 'Désactiver' : 'Activer',
      isActive: room.active,
      canDelete: isFree,
    }
  }),
)

const columns = [
  { data: 'name', title: 'Salle', render: (v: string) => `<span class="dt-name">${v}</span>` },
  {
    data: 'typeLabel',
    title: 'Type',
    render: (label: string, _t: string, row: { typeVariant: string }) =>
      statusBadge(label, row.typeVariant as 'primary' | 'info'),
  },
  {
    data: 'rateSort',
    title: 'Tarif / nuit',
    render: (_d: number, _t: string, row: { rate: string }) => `<span class="dt-amount">${row.rate}</span>`,
  },
  {
    data: 'availabilityLabel',
    title: 'Capacité',
    render: (label: string, _t: string, row: { availabilityVariant: string }) =>
      statusBadge(label, row.availabilityVariant as 'success' | 'danger'),
  },
  { data: 'occupancyLabel', title: 'Occupation' },
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
    render: (_d: unknown, _t: string, row: { id: string; toggleLabel: string; canDelete: boolean }) =>
      catalogRowActionsHtml(row),
  },
]

function resetMessages() {
  message.value = ''
}

async function load() {
  loading.value = true
  resetMessages()
  try {
    const { data } = await api.get<{
      rooms: RoomRow[]
      stats: typeof stats.value
    }>('/hospitalisation')
    rooms.value = data.rooms
    stats.value = data.stats
  } catch {
    message.value = 'Impossible de charger les salles.'
    messageType.value = 'error'
  } finally {
    loading.value = false
  }
}

function resetNewRoomForm() {
  newRoom.value = {
    name: '',
    type: 'SIMPLE',
    dailyRateFcfa: '25000',
  }
}

function openAddModal() {
  resetNewRoomForm()
  showAddModal.value = true
}

function closeAddModal() {
  showAddModal.value = false
  resetNewRoomForm()
}

async function addRoom() {
  if (!newRoom.value.name.trim() || !newRoom.value.dailyRateFcfa) {
    message.value = 'Nom et tarif sont obligatoires.'
    messageType.value = 'error'
    return
  }

  saving.value = true
  resetMessages()
  try {
    await api.post('/hospitalisation/rooms', {
      name: newRoom.value.name.trim(),
      type: newRoom.value.type,
      dailyRateFcfa: Number(newRoom.value.dailyRateFcfa),
    })
    message.value = 'Salle créée.'
    messageType.value = 'success'
    closeAddModal()
    await load()
  } catch (error) {
    const shown = await showDuplicateModalFromError(error)
    if (!shown) {
      message.value = 'Création impossible. Vérifiez les informations saisies.'
      messageType.value = 'error'
    }
  } finally {
    saving.value = false
  }
}

function openEditModal(id: string) {
  const room = roomsById.value.get(id)
  if (!room) return
  editingId.value = id
  editForm.value = {
    name: room.name,
    type: room.type,
    description: room.description ?? '',
    dailyRateFcfa: String(room.dailyRateFcfa),
    active: room.active,
  }
}

function closeEditModal() {
  editingId.value = null
}

async function saveEdit() {
  if (!editingId.value) return
  saving.value = true
  resetMessages()
  try {
    await api.put(`/hospitalisation/rooms/${editingId.value}`, {
      name: editForm.value.name.trim(),
      type: editForm.value.type,
      description: editForm.value.description.trim() || undefined,
      dailyRateFcfa: Number(editForm.value.dailyRateFcfa),
      active: editForm.value.active,
    })
    message.value = 'Salle mise à jour.'
    messageType.value = 'success'
    closeEditModal()
    await load()
  } catch {
    message.value = 'Mise à jour impossible.'
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

async function toggleRoom(id: string) {
  const room = roomsById.value.get(id)
  if (!room) return
  resetMessages()
  try {
    await api.put(`/hospitalisation/rooms/${id}`, { active: !room.active })
    message.value = room.active ? 'Salle désactivée.' : 'Salle réactivée.'
    messageType.value = 'success'
    await load()
  } catch {
    message.value = 'Action impossible.'
    messageType.value = 'error'
  }
}

async function deleteRoom(id: string) {
  const room = roomsById.value.get(id)
  if (!room) return

  if (room.status === 'OCCUPE') {
    message.value = 'Suppression impossible : la salle est encore occupée.'
    messageType.value = 'error'
    return
  }

  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer la salle',
    message: `Supprimer définitivement la salle « ${room.name} » ? Cette action est irréversible.`,
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return

  resetMessages()
  try {
    await api.delete(`/hospitalisation/rooms/${id}`)
    message.value = 'Salle supprimée.'
    messageType.value = 'success'
    if (editingId.value === id) closeEditModal()
    await load()
  } catch {
    message.value = 'Suppression impossible. Vérifiez qu\'aucune hospitalisation n\'est liée à cette salle.'
    messageType.value = 'error'
  }
}

function onTableAction({ action, id }: { action: string; id: string }) {
  if (action === 'toggle') toggleRoom(id)
  if (action === 'edit') openEditModal(id)
  if (action === 'delete') deleteRoom(id)
}

onMounted(load)
</script>

<template>
  <div>
    <UiPageHeader
      title="Salles"
      subtitle="Nomenclature des chambres et tarifs de nuitée"
      :icon="Building2"
    />

    <UiAlert v-if="message" :type="messageType" :message="message" />

    <div class="stats-row">
      <div class="stat-card card-accent card-accent--green">
        <span>Salles totales</span>
        <strong>{{ stats.roomCount }}</strong>
      </div>
      <div class="stat-card card-accent card-accent--green">
        <span>Libres</span>
        <strong>{{ stats.freeRooms }}</strong>
      </div>
      <div class="stat-card card-accent card-accent--green">
        <span>Occupées</span>
        <strong>{{ stats.occupiedRooms }}</strong>
      </div>
    </div>

    <UiCard
      title="Référentiel des salles"
      description="Tarifs appliqués à la facturation des hospitalisations"
      :icon="Building2"
      icon-variant="blue"
      class="section"
    >
      <template #actions>
        <UiButton variant="primary" size="sm" :icon="Plus" @click="openAddModal">
          Nouvelle salle
        </UiButton>
        <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="load">
          Actualiser
        </UiButton>
        <span class="list-count">{{ rooms.length }} salle(s)</span>
      </template>

      <div class="table-panel-scroll">
        <UiDataTable
          table-key="compta-salles"
          compact
          :data="tableRows"
          :columns="columns"
          :loading="loading"
          loading-label="Chargement des salles…"
          @action="onTableAction"
        />
      </div>
    </UiCard>

    <UiFormModal
      v-if="showAddModal"
      title-id="add-room-title"
      title="Nouvelle salle"
      subtitle="Ajouter une chambre au référentiel hospitalier"
      :icon="Building2"
      @close="closeAddModal"
    >
      <section class="form-panel">
        <div class="form-grid-2">
          <UiInput v-model="newRoom.name" label="Nom de la salle" placeholder="Ex. VIP 103" />
          <UiSelect v-model="newRoom.type" label="Type">
            <option value="VIP">VIP</option>
            <option value="SIMPLE">Simple</option>
          </UiSelect>
          <UiInput v-model="newRoom.dailyRateFcfa" label="Tarif nuitée (FCFA)" type="number" min="1" />
        </div>
      </section>
      <template #footer>
        <UiButton variant="ghost" @click="closeAddModal">Annuler</UiButton>
        <UiButton variant="primary" :icon="Plus" :disabled="saving" @click="addRoom">
          Créer
        </UiButton>
      </template>
    </UiFormModal>

    <UiFormModal
      v-if="editingId && editingRoom"
      title-id="edit-room-title"
      :title="editingRoom.name"
      subtitle="Modifier le tarif, le type ou le statut de la salle"
      :icon="Building2"
      @close="closeEditModal"
    >
      <section class="form-panel">
        <div class="form-grid-2">
          <UiInput v-model="editForm.name" label="Nom de la salle" />
          <UiSelect v-model="editForm.type" label="Type">
            <option value="VIP">VIP</option>
            <option value="SIMPLE">Simple</option>
          </UiSelect>
          <UiInput v-model="editForm.dailyRateFcfa" label="Tarif nuitée (FCFA)" type="number" min="1" />
          <UiInput v-model="editForm.description" label="Description" placeholder="Optionnel" />
          <UiSelect v-model="editForm.active" label="Statut de la salle">
            <option :value="true">Active</option>
            <option :value="false">Inactive</option>
          </UiSelect>
        </div>
      </section>

      <template #footer>
        <UiButton variant="ghost" @click="closeEditModal">Fermer</UiButton>
        <UiButton variant="primary" :icon="Save" :disabled="saving" @click="saveEdit">
          Enregistrer
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.section {
  margin-top: 0;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem 1rem;
  border-radius: var(--radius-sm);
}

.stat-card span {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.stat-card strong {
  font-size: 1.25rem;
  color: var(--text);
}

.list-count {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
}

.table-panel-scroll {
  overflow: auto;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.span-2 {
  grid-column: span 2;
}

@media (max-width: 768px) {
  .stats-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .form-grid,
  .span-2 {
    grid-template-columns: 1fr;
    grid-column: auto;
  }
}
</style>
