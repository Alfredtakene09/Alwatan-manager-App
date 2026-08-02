<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { Building2, Plus, Save, RefreshCw, Pencil, Trash2 } from '@lucide/vue'
import api from '@/api/client'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import { confirmAppModal } from '@/lib/api-modal-helper'
import { useAuthStore } from '@/stores/auth'

type ServiceDoctor = {
  id: string
  firstName: string
  lastName: string
  specialty: string | null
  active: boolean
  clinicServiceId?: string | null
  clinicServiceIds?: string[]
  clinicServices?: { id: string; name: string; isDefault?: boolean }[]
  isDefaultForService?: boolean
}

type ClinicService = {
  id: string
  name: string
  active: boolean
  sortOrder: number
  doctors: ServiceDoctor[]
}

const auth = useAuthStore()
const apiBase = computed(() => (auth.user?.role === 'GESTIONNAIRE' ? '/gestionnaire' : '/admin'))

const rows = ref<ClinicService[]>([])
const doctors = ref<ServiceDoctor[]>([])
const loading = ref(false)
const saving = ref(false)
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const doctorSearch = ref('')

const form = ref({
  name: '',
  active: true,
  doctorIds: [] as string[],
})

const sortedRows = computed(() =>
  [...rows.value].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
)

const filteredDoctors = computed(() => {
  const q = doctorSearch.value.trim().toLowerCase()
  const list = [...doctors.value].sort((a, b) =>
    `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'fr'),
  )
  if (!q) return list
  return list.filter((doctor) => {
    const hay = `${doctor.firstName} ${doctor.lastName} ${doctor.specialty ?? ''}`.toLowerCase()
    return hay.includes(q)
  })
})

function doctorFullName(doctor: Pick<ServiceDoctor, 'firstName' | 'lastName'>) {
  return `${doctor.firstName} ${doctor.lastName}`.trim()
}

function doctorsLabel(row: ClinicService) {
  if (!row.doctors?.length) return 'Aucun médecin'
  return row.doctors.map(doctorFullName).join(', ')
}

function resetForm() {
  form.value = { name: '', active: true, doctorIds: [] }
  doctorSearch.value = ''
}

function toggleDoctor(id: string) {
  const set = new Set(form.value.doctorIds)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  form.value.doctorIds = [...set]
}

function isDoctorChecked(id: string) {
  return form.value.doctorIds.includes(id)
}

function doctorAlreadyElsewhere(doctor: ServiceDoctor) {
  const otherIds = (doctor.clinicServiceIds ?? doctor.clinicServices?.map((s) => s.id) ?? []).filter(
    (id) => id && id !== editingId.value,
  )
  if (otherIds.length) return true
  if (!doctor.clinicServiceId) return false
  if (editingId.value && doctor.clinicServiceId === editingId.value) return false
  return true
}

function otherServiceName(doctor: ServiceDoctor) {
  const names = (doctor.clinicServices ?? [])
    .filter((s) => s.id !== editingId.value)
    .map((s) => s.name)
  if (names.length) return names.join(', ')
  if (!doctor.clinicServiceId || doctor.clinicServiceId === editingId.value) return ''
  return rows.value.find((row) => row.id === doctor.clinicServiceId)?.name ?? 'autre service'
}

async function loadDoctors() {
  try {
    const { data } = await api.get<ServiceDoctor[]>(`${apiBase.value}/services/doctors`)
    doctors.value = Array.isArray(data) ? data : []
  } catch {
    doctors.value = []
  }
}

async function loadServices() {
  loading.value = true
  try {
    const { data } = await api.get<ClinicService[]>(`${apiBase.value}/services`)
    rows.value = Array.isArray(data)
      ? data.map((row) => ({ ...row, doctors: Array.isArray(row.doctors) ? row.doctors : [] }))
      : []
  } finally {
    loading.value = false
  }
}

async function reloadAll() {
  await Promise.all([loadServices(), loadDoctors()])
}

function openCreateModal() {
  editingId.value = null
  resetForm()
  modalOpen.value = true
  message.value = ''
}

function openEditModal(row: ClinicService) {
  editingId.value = row.id
  form.value = {
    name: row.name,
    active: row.active,
    doctorIds: row.doctors.map((doctor) => doctor.id),
  }
  doctorSearch.value = ''
  modalOpen.value = true
  message.value = ''
}

function closeModal() {
  modalOpen.value = false
  editingId.value = null
  resetForm()
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === 'string') {
    return error.response.data.error
  }
  return fallback
}

async function saveService() {
  const name = form.value.name.trim()
  if (name.length < 2) {
    message.value = 'Le nom du service doit contenir au moins 2 caractères.'
    messageType.value = 'error'
    return
  }

  saving.value = true
  message.value = ''
  const payload = {
    name,
    active: form.value.active,
    doctorIds: form.value.doctorIds,
  }
  try {
    if (editingId.value) {
      await api.put(`${apiBase.value}/services/${editingId.value}`, payload)
      message.value = 'Service mis à jour.'
    } else {
      await api.post(`${apiBase.value}/services`, payload)
      message.value = 'Service créé.'
    }
    messageType.value = 'success'
    closeModal()
    await reloadAll()
  } catch (error: unknown) {
    message.value = apiErrorMessage(error, 'Impossible d’enregistrer ce service.')
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

async function deleteService(row: ClinicService) {
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer le service',
    message: `Supprimer définitivement « ${row.name} » ?`,
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return

  try {
    await api.delete(`${apiBase.value}/services/${row.id}`)
    message.value = 'Service supprimé.'
    messageType.value = 'success'
    await reloadAll()
  } catch (error: unknown) {
    message.value = apiErrorMessage(error, 'Suppression impossible.')
    messageType.value = 'error'
  }
}

onMounted(reloadAll)
</script>

<template>
  <div>
    <UiPageHeader
      title="Services"
      subtitle="Créer et gérer la liste des services de la clinique"
      :icon="Building2"
    />

    <UiAlert v-if="message && !modalOpen" :type="messageType" :message="message" />

    <UiCard title="Référentiel des services" :icon="Building2" icon-variant="violet">
      <template #actions>
        <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="reloadAll">
          Actualiser
        </UiButton>
        <UiButton variant="primary" size="sm" :icon="Plus" @click="openCreateModal">
          Nouveau service
        </UiButton>
      </template>

      <p v-if="!loading && !sortedRows.length" class="empty">Aucun service configuré.</p>
      <div v-else class="services-table-wrap">
        <table class="services-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Service</th>
              <th>Médecins</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in sortedRows" :key="row.id">
              <td class="col-index">{{ index + 1 }}</td>
              <td>
                <strong>{{ row.name }}</strong>
              </td>
              <td>
                <span v-if="!row.doctors.length" class="muted">Aucun médecin</span>
                <ul v-else class="doctor-chips">
                  <li v-for="doctor in row.doctors" :key="doctor.id">
                    {{ doctorFullName(doctor) }}
                  </li>
                </ul>
              </td>
              <td>{{ row.active ? 'Actif' : 'Inactif' }}</td>
              <td class="service-actions">
                <UiButton variant="ghost" size="sm" :icon="Pencil" @click="openEditModal(row)">
                  Modifier
                </UiButton>
                <UiButton variant="danger" size="sm" :icon="Trash2" @click="deleteService(row)">
                  Supprimer
                </UiButton>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="sr-only">{{ sortedRows.map((row) => doctorsLabel(row)).join(' ; ') }}</p>
      </div>
    </UiCard>

    <UiFormModal
      v-if="modalOpen"
      title-id="service-modal-title"
      :title="editingId ? 'Modifier le service' : 'Nouveau service'"
      :icon="Building2"
      size="large"
      @close="closeModal"
    >
      <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />
      <section class="form-panel">
        <UiInput v-model="form.name" label="Nom du service" required placeholder="Ex: Laboratoire" />
        <UiSelect
          :model-value="form.active ? 'true' : 'false'"
          label="Statut"
          @update:model-value="form.active = $event === 'true'"
        >
          <option value="true">Actif</option>
          <option value="false">Inactif</option>
        </UiSelect>

        <div class="doctors-picker">
          <div class="doctors-picker__head">
            <div>
              <h3>Médecins du service</h3>
              <p>Cochez les médecins rattachés à ce service. Un médecin peut appartenir à plusieurs services.</p>
            </div>
            <span class="doctors-picker__count">{{ form.doctorIds.length }} sélectionné(s)</span>
          </div>
          <UiInput
            v-model="doctorSearch"
            label="Rechercher un médecin"
            placeholder="Nom, prénom ou spécialité…"
          />
          <p v-if="!filteredDoctors.length" class="empty empty--compact">Aucun médecin disponible.</p>
          <ul v-else class="doctors-checklist">
            <li v-for="doctor in filteredDoctors" :key="doctor.id">
              <label class="doctor-option">
                <input
                  type="checkbox"
                  :checked="isDoctorChecked(doctor.id)"
                  @change="toggleDoctor(doctor.id)"
                />
                <span>
                  <strong>{{ doctorFullName(doctor) }}</strong>
                  <small v-if="doctor.specialty">{{ doctor.specialty }}</small>
                  <small v-if="doctorAlreadyElsewhere(doctor)" class="elsewhere">
                    Aussi lié à : {{ otherServiceName(doctor) }}
                  </small>
                </span>
              </label>
            </li>
          </ul>
        </div>
      </section>
      <template #footer>
        <UiButton variant="ghost" @click="closeModal">Annuler</UiButton>
        <UiButton variant="primary" :icon="Save" :disabled="saving" @click="saveService">
          {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.empty {
  text-align: center;
  color: var(--text-light);
  padding: 1.5rem 1rem;
}

.empty--compact {
  padding: 0.75rem 0;
}

.muted {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.services-table-wrap {
  overflow-x: auto;
}

.services-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.services-table th,
.services-table td {
  text-align: left;
  padding: 0.7rem 0.65rem;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

.services-table th {
  color: var(--text-muted);
  font-weight: 600;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.col-index {
  width: 2.5rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.doctor-chips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.doctor-chips li {
  background: color-mix(in srgb, var(--primary, #2563eb) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--primary, #2563eb) 22%, var(--border));
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  font-size: 0.78rem;
}

.service-actions {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.form-panel {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.doctors-picker {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.85rem;
  background: color-mix(in srgb, var(--surface, #fff) 92%, var(--border));
}

.doctors-picker__head {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: flex-start;
}

.doctors-picker__head h3 {
  margin: 0;
  font-size: 0.95rem;
}

.doctors-picker__head p {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.doctors-picker__count {
  font-size: 0.78rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.doctors-checklist {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 16rem;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.doctor-option {
  display: flex;
  gap: 0.55rem;
  align-items: flex-start;
  padding: 0.45rem 0.5rem;
  border-radius: 8px;
  cursor: pointer;
}

.doctor-option:hover {
  background: color-mix(in srgb, var(--primary, #2563eb) 8%, transparent);
}

.doctor-option input {
  margin-top: 0.2rem;
}

.doctor-option strong {
  display: block;
  font-size: 0.875rem;
}

.doctor-option small {
  display: block;
  color: var(--text-muted);
  font-size: 0.75rem;
}

.doctor-option .elsewhere {
  color: #b45309;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

@media (max-width: 720px) {
  .doctors-picker__head {
    flex-direction: column;
  }
}
</style>
