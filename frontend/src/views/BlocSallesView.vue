<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { BedDouble, Scissors, ShieldCheck, Plus, Pencil, Save, Trash2 } from '@lucide/vue'
import api from '@/api/client'
import { fullName } from '@/lib/roles'
import { confirmAppModal, showDuplicateModalFromError } from '@/lib/api-modal-helper'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiAlert from '@/components/ui/UiAlert.vue'

type RoomRow = {
  id: string
  name: string
  type: 'VIP' | 'SIMPLE'
  dailyRateFcfa: number
  description?: string | null
  active?: boolean
  status?: 'LIBRE' | 'OCCUPE'
  currentPatient?: { firstName: string; lastName: string } | null
}

type BlocSallesPayload = {
  rooms: RoomRow[]
  surgeries: Array<{
    visit: { patient: { firstName: string; lastName: string } }
    interventionType: { label: string }
    surgeon: { firstName: string; lastName: string }
  }>
}

const data = ref<BlocSallesPayload | null>(null)
const roomsCatalog = ref<RoomRow[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const showAddModal = ref(false)
const editingId = ref<string | null>(null)

const newRoom = ref({
  name: '',
  type: 'SIMPLE' as 'VIP' | 'SIMPLE',
  dailyRateFcfa: '25000',
})

const editForm = ref({
  name: '',
  type: 'SIMPLE' as 'VIP' | 'SIMPLE',
  description: '',
  dailyRateFcfa: '',
  active: true,
})

const roomsById = computed(() => new Map(roomsCatalog.value.map((room) => [room.id, room])))
const editingRoom = computed(() => (editingId.value ? roomsById.value.get(editingId.value) ?? null : null))

function resetMessages() {
  message.value = ''
}

async function load() {
  loading.value = true
  resetMessages()
  try {
    const [{ data: blocData }, { data: adminRooms }] = await Promise.all([
      api.get<BlocSallesPayload>('/bloc-salles'),
      api.get<RoomRow[]>('/admin/rooms'),
    ])
    data.value = blocData
    roomsCatalog.value = adminRooms
  } catch {
    message.value = 'Impossible de charger les salles.'
    messageType.value = 'error'
  } finally {
    loading.value = false
  }
}

function openAddModal() {
  newRoom.value = {
    name: '',
    type: 'SIMPLE',
    dailyRateFcfa: '25000',
  }
  showAddModal.value = true
}

function closeAddModal() {
  showAddModal.value = false
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
    await api.post('/admin/rooms', {
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
      message.value = 'Création impossible.'
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
    active: room.active ?? true,
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
    await api.put(`/admin/rooms/${editingId.value}`, {
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

async function deleteRoom(id: string) {
  const room = data.value?.rooms.find((row) => row.id === id)
  if (!room) return

  if (room.status === 'OCCUPE') {
    message.value = 'Suppression impossible : la salle est encore occupée.'
    messageType.value = 'error'
    return
  }

  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer la salle',
    message: `Supprimer définitivement la salle « ${room.name} » ?`,
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return

  saving.value = true
  resetMessages()
  try {
    await api.delete(`/hospitalisation/rooms/${id}`)
    message.value = 'Salle supprimée.'
    messageType.value = 'success'
    if (editingId.value === id) closeEditModal()
    await load()
  } catch {
    message.value = "Suppression impossible. Vérifiez qu'aucune hospitalisation n'est liée à cette salle."
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await load()
})
</script>

<template>
  <div v-if="data">
    <UiPageHeader
      title="Bloc opératoire & Salles"
      subtitle="Gestion des salles et autorisations chirurgicales"
      :icon="BedDouble"
    >
      <template #actions>
        <UiButton variant="primary" :icon="Plus" @click="openAddModal">Nouvelle salle</UiButton>
      </template>
    </UiPageHeader>

    <UiAlert v-if="message" :type="messageType" :message="message" />

    <UiCard title="Plan des salles" description="Suivi temps réel des salles" :icon="BedDouble" icon-variant="blue" class="section">
      <div class="rooms-grid">
        <div
          v-for="room in data.rooms"
          :key="room.id"
          class="room-card"
          :class="`room-card--${(room.status ?? 'LIBRE').toLowerCase()}`"
        >
          <div class="room-card__head">
            <strong>{{ room.name }}</strong>
            <UiBadge :variant="room.status === 'LIBRE' ? 'success' : 'danger'">
              {{ room.status === 'LIBRE' ? 'Libérée' : 'Occupée' }}
            </UiBadge>
          </div>
          <UiBadge variant="info">{{ room.type }}</UiBadge>
          <p v-if="room.currentPatient" class="room-patient">
            <ShieldCheck :size="14" />
            {{ fullName(room.currentPatient.firstName, room.currentPatient.lastName) }}
          </p>
          <p v-else class="room-empty">Disponible</p>
          <div class="room-card__actions">
            <UiButton variant="ghost" size="sm" class="room-action-btn" :icon="Pencil" @click="openEditModal(room.id)">
              Modifier
            </UiButton>
            <UiButton
              variant="danger"
              size="sm"
              class="room-action-btn"
              :icon="Trash2"
              :disabled="saving"
              @click="deleteRoom(room.id)"
            >
              Supprimer
            </UiButton>
          </div>
        </div>
      </div>
    </UiCard>

    <UiCard title="Autorisations chirurgicales" description="Interventions payées par la comptabilité" :icon="Scissors" icon-variant="rose" class="section">
      <div v-for="(surgery, i) in data.surgeries" :key="i" class="auth-card">
        <div class="auth-card__icon"><Scissors :size="18" /></div>
        <div>
          <strong>{{ fullName(surgery.visit.patient.firstName, surgery.visit.patient.lastName) }}</strong>
          <span>{{ surgery.interventionType.label }}</span>
          <small>Opérateur : Dr {{ fullName(surgery.surgeon.firstName, surgery.surgeon.lastName) }}</small>
        </div>
        <UiBadge variant="success">Autorisé</UiBadge>
      </div>
      <p v-if="!data.surgeries.length" class="empty">Aucune autorisation active</p>
    </UiCard>

    <UiFormModal
      v-if="showAddModal"
      title-id="add-room-title"
      title="Nouvelle salle"
      subtitle="Ajouter une salle au plan de bloc"
      :icon="BedDouble"
      @close="closeAddModal"
    >
      <section class="form-panel">
        <div class="form-grid-2">
          <UiInput v-model="newRoom.name" label="Nom de la salle" placeholder="Ex. Salle 4" />
          <UiSelect v-model="newRoom.type" label="Type">
            <option value="VIP">VIP</option>
            <option value="SIMPLE">Simple</option>
          </UiSelect>
          <UiInput v-model="newRoom.dailyRateFcfa" label="Tarif nuitée (FCFA)" type="number" min="1" />
        </div>
      </section>
      <template #footer>
        <UiButton variant="ghost" @click="closeAddModal">Annuler</UiButton>
        <UiButton variant="primary" :icon="Plus" :disabled="saving" @click="addRoom">Créer</UiButton>
      </template>
    </UiFormModal>

    <UiFormModal
      v-if="editingId && editingRoom"
      title-id="edit-room-title"
      :title="editingRoom.name"
      subtitle="Modifier la salle"
      :icon="BedDouble"
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
          <UiSelect v-model="editForm.active" label="Statut">
            <option :value="true">Active</option>
            <option :value="false">Inactive</option>
          </UiSelect>
        </div>
      </section>
      <template #footer>
        <UiButton variant="ghost" @click="closeEditModal">Fermer</UiButton>
        <UiButton variant="primary" :icon="Save" :disabled="saving" @click="saveEdit">Enregistrer</UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.section {
  margin-bottom: 1.25rem;
}

.rooms-grid {
  display: grid;
  gap: 0.875rem;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}

.room-card {
  padding: 1rem;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--border);
  background: #fafcfd;
}

.room-card--libre {
  border-color: #a7f3d0;
  background: linear-gradient(135deg, #f0fdf4, #ecfdf5);
}

.room-card--occupe {
  border-color: #fecaca;
  background: linear-gradient(135deg, #fef2f2, #fff1f2);
}

.room-card__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.room-patient {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.75rem 0 0;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text);
}

.room-empty {
  margin: 0.75rem 0 0;
  font-size: 0.8rem;
  color: var(--text-light);
}

.room-card__actions {
  display: flex;
  gap: 0.35rem;
  flex-wrap: nowrap;
  align-items: center;
  margin-top: 0.75rem;
}

.room-action-btn {
  min-height: 1.6rem;
  padding: 0.2rem 0.45rem;
  font-size: 0.68rem;
}

.auth-card {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  margin-bottom: 0.5rem;
}

.auth-card__icon {
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffe4e6;
  color: #e11d48;
  border-radius: 10px;
}

.auth-card strong {
  display: block;
}

.auth-card span {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.auth-card small {
  display: block;
  font-size: 0.75rem;
  color: var(--text-light);
  margin-top: 0.15rem;
}

.auth-card > :last-child {
  margin-left: auto;
}

.empty {
  text-align: center;
  color: var(--text-light);
  padding: 1.5rem;
  font-size: 0.875rem;
}

.form-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

@media (max-width: 680px) {
  .form-grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
