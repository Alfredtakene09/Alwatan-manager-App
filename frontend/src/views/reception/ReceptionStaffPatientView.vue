<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  UserRound,
  UserPlus,
  RotateCcw,
  Printer,
  UserCheck,
} from '@lucide/vue'
import api from '@/api/client'
import { showDuplicateModalFromError } from '@/lib/api-modal-helper'
import { fullName } from '@/lib/roles'
import { parsePatientAge, splitPatientFullName, formatPatientAge } from '@/lib/patient-name'
import { normalizePatientAgeUnit, type PatientAgeUnit } from '@/lib/patient-age'
import { doctorSelectSuffix, type DoctorOption } from '@/lib/doctor-compensation'
import { CLINIC } from '@/lib/clinic'
import { buildClinicPrintHeader, openPrintDocument } from '@/lib/print-document'
import ReceptionPatientIdentityFields from '@/components/reception/ReceptionPatientIdentityFields.vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'

type StaffPatientRow = {
  id: string
  code: string
  firstName: string
  lastName: string
  phone?: string | null
  service?: string | null
  gender?: string | null
  age?: number | null
  ageUnit?: PatientAgeUnit | null
  recommendedByName?: string | null
  createdAt: string
}

const doctors = ref<DoctorOption[]>([])
const services = ref<Array<{ id: string; name: string }>>([])
const queue = ref<StaffPatientRow[]>([])
const loadingQueue = ref(false)
const registering = ref(false)
const showFormModal = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')

const form = ref({
  fullName: '',
  age: '',
  ageUnit: 'YEARS' as PatientAgeUnit,
  phone: '',
  service: '',
  gender: 'F',
  recommendedByName: '',
  doctorId: '',
  treatingDoctorId: '',
})

const parsedName = computed(() => splitPatientFullName(form.value.fullName))
const parsedAge = computed(() => parsePatientAge(form.value.age, form.value.ageUnit))

const canRegister = computed(() => {
  const { firstName, lastName } = parsedName.value
  return (
    firstName.length >= 2 &&
    lastName.length >= 2 &&
    parsedAge.value !== null &&
    !!form.value.service &&
    form.value.recommendedByName.trim().length >= 2 &&
    !!form.value.doctorId
  )
})

function resetForm() {
  form.value = {
    fullName: '',
    age: '',
    ageUnit: 'YEARS',
    phone: '',
    service: services.value[0]?.name ?? '',
    gender: 'F',
    recommendedByName: '',
    doctorId: doctors.value[0]?.id ?? '',
    treatingDoctorId: '',
  }
}

function getDoctorName(doctorId: string) {
  const doctor = doctors.value.find((d) => d.id === doctorId)
  return doctor ? `Dr ${fullName(doctor.firstName, doctor.lastName)}` : '—'
}

async function openFormModal() {
  await loadServices()
  resetForm()
  message.value = ''
  showFormModal.value = true
}

function closeFormModal() {
  showFormModal.value = false
}

async function loadDoctors() {
  try {
    const { data } = await api.get<DoctorOption[]>('/visits/doctors')
    doctors.value = Array.isArray(data)
      ? [...data].sort((a, b) => {
          const byLast = a.lastName.localeCompare(b.lastName, 'fr', { sensitivity: 'base' })
          if (byLast !== 0) return byLast
          return a.firstName.localeCompare(b.firstName, 'fr', { sensitivity: 'base' })
        })
      : []
    if (!form.value.doctorId) form.value.doctorId = doctors.value[0]?.id ?? ''
  } catch {
    doctors.value = []
  }
}

async function loadServices() {
  try {
    const { data } = await api.get<Array<{ id: string; name: string }>>('/visits/external-services')
    services.value = Array.isArray(data) ? data : []
    if (!form.value.service) form.value.service = services.value[0]?.name ?? ''
  } catch {
    services.value = []
  }
}

async function loadQueue() {
  loadingQueue.value = true
  try {
    const { data } = await api.get<StaffPatientRow[]>('/patients', {
      params: { category: 'PERSONNEL' },
    })
    queue.value = data
  } finally {
    loadingQueue.value = false
  }
}

async function registerStaffPatient() {
  if (!canRegister.value || registering.value) return
  registering.value = true
  message.value = ''
  try {
    const { firstName, lastName } = parsedName.value
    const { data } = await api.post<{ patient: StaffPatientRow }>(
      '/patients/register-consultation',
      {
        firstName,
        lastName,
        age: parsedAge.value ?? undefined,
        ageUnit: form.value.ageUnit,
        phone: form.value.phone.trim() || undefined,
        service: form.value.service || undefined,
        gender: form.value.gender,
        category: 'PERSONNEL',
        recommendedByName: form.value.recommendedByName.trim(),
        doctorId: form.value.doctorId,
        treatingDoctorId: form.value.treatingDoctorId || null,
        consultationAmountFcfa: 0,
        reductionFcfa: 0,
      },
    )
    message.value = `Patient personnel enregistré (gratuit) — envoyé chez ${getDoctorName(form.value.doctorId)}.`
    messageType.value = 'success'
    printFiche({
      ...data.patient,
      recommendedByName: form.value.recommendedByName.trim(),
      createdAt: new Date().toISOString(),
    })
    closeFormModal()
    resetForm()
    await loadQueue()
  } catch (error: unknown) {
    const shown = await showDuplicateModalFromError(error)
    if (shown) return
    const apiMessage =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
    message.value = apiMessage ?? 'Erreur lors de l’enregistrement.'
    messageType.value = 'error'
  } finally {
    registering.value = false
  }
}

function printFiche(row: StaffPatientRow) {
  const patientName = fullName(row.firstName, row.lastName)
  openPrintDocument(
    `Fiche patient personnel ${row.code}`,
    `
${buildClinicPrintHeader('Fiche patient — Personnel (gratuit)')}
  <div class="row"><span>Date</span><strong>${new Date(row.createdAt).toLocaleString('fr-FR')}</strong></div>
  <div class="row"><span>Patient</span><strong>${patientName}</strong></div>
  <div class="row"><span>Matricule</span><strong>${row.code}</strong></div>
  ${row.service ? `<div class="row"><span>Service</span><strong>${row.service}</strong></div>` : ''}
  ${row.recommendedByName ? `<div class="row"><span>Recommandé par</span><strong>${row.recommendedByName}</strong></div>` : ''}
  ${row.phone ? `<div class="row"><span>Téléphone</span><strong>${row.phone}</strong></div>` : ''}
  ${row.age != null ? `<div class="row"><span>Âge</span><strong>${formatPatientAge(row.age, normalizePatientAgeUnit(row.ageUnit))}</strong></div>` : ''}
  <p style="margin-top:1rem;color:#64748b;font-size:0.875rem;">Parcours gratuit — consultation et examens exonérés.</p>
  <div class="footer">${CLINIC.fullAddress}<br>${CLINIC.phoneLabel} — ${CLINIC.email}</div>
`,
  )
}

onMounted(() => {
  void loadDoctors()
  void loadServices()
  void loadQueue()
})
</script>

<template>
  <div>
    <UiPageHeader
      title="Patient personnel"
      subtitle="Enregistrement d’un membre du personnel ou d’un proche recommandé — parcours entièrement gratuit"
      :icon="UserCheck"
    />

    <UiAlert v-if="message" :type="messageType" :message="message" />

    <UiCard title="Patients personnel enregistrés" class="queue-card" :icon="UserCheck" icon-variant="blue">
      <template #actions>
        <UiButton variant="primary" size="sm" :icon="UserPlus" @click="openFormModal">
          Nouveau
        </UiButton>
        <UiButton variant="ghost" size="sm" :disabled="loadingQueue" @click="loadQueue">
          Actualiser
        </UiButton>
        <span class="list-count">{{ queue.length }} dossier(s)</span>
      </template>

      <p v-if="!loadingQueue && !queue.length" class="empty">
        Aucun patient personnel enregistré pour le moment
      </p>
      <div v-else class="queue-table-wrap">
        <table class="queue-table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Service</th>
              <th>Recommandé par</th>
              <th>Enregistré le</th>
              <th class="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in queue" :key="row.id">
              <td>
                <strong>{{ fullName(row.firstName, row.lastName) }}</strong>
                <span class="sub">{{ row.code }}</span>
              </td>
              <td>{{ row.service || '—' }}</td>
              <td>{{ row.recommendedByName || '—' }}</td>
              <td>{{ new Date(row.createdAt).toLocaleString('fr-FR') }}</td>
              <td class="col-actions">
                <UiButton variant="ghost" size="sm" :icon="Printer" @click="printFiche(row)">
                  Fiche
                </UiButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCard>

    <UiFormModal
      v-if="showFormModal"
      title-id="staff-patient-modal-title"
      title="Nouveau patient personnel"
      subtitle="Parcours entièrement gratuit — consultation et examens exonérés"
      :icon="UserPlus"
      @close="closeFormModal"
    >
      <form
        id="staff-patient-form"
        class="staff-form"
        @submit.prevent="registerStaffPatient"
      >
        <ReceptionPatientIdentityFields
          v-model:full-name="form.fullName"
          v-model:age="form.age"
          v-model:age-unit="form.ageUnit"
          v-model:phone="form.phone"
          v-model:gender="form.gender"
        />

        <div class="form-grid-2">
          <UiSelect v-model="form.service" label="Service" required>
            <option value="" disabled>{{ services.length ? 'Sélectionner un service' : 'Aucun service disponible' }}</option>
            <option v-for="service in services" :key="service.id" :value="service.name">
              {{ service.name }}
            </option>
          </UiSelect>
          <UiInput
            v-model="form.recommendedByName"
            label="Recommandé par"
            placeholder="Nom du membre du personnel"
            :icon="UserRound"
            required
          />
        </div>

        <UiSelect v-model="form.doctorId" label="Médecin" required>
          <option value="" disabled>{{ doctors.length ? 'Sélectionner' : 'Aucun médecin disponible' }}</option>
          <option v-for="doctor in doctors" :key="doctor.id" :value="doctor.id">
            Dr {{ fullName(doctor.firstName, doctor.lastName) }}{{ doctorSelectSuffix(doctor) }}
          </option>
        </UiSelect>

        <UiSelect v-model="form.treatingDoctorId" label="Médecin traitant (dossier)">
          <option value="">Aucun (optionnel)</option>
          <option v-for="doctor in doctors" :key="doctor.id" :value="doctor.id">
            Dr {{ fullName(doctor.firstName, doctor.lastName) }}{{ doctorSelectSuffix(doctor) }}
          </option>
        </UiSelect>

        <UiAlert
          v-if="!doctors.length"
          type="warning"
          message="Aucun médecin sélectionnable. Les médecins du personnel doivent être en profil Médecin et avoir un compte utilisateur (rôle Médecin)."
        />
        <p v-if="!doctors.length" class="doctors-empty-alert__links">
          <RouterLink to="/admin/utilisateurs">Utilisateurs</RouterLink>
          <span aria-hidden="true"> · </span>
          <RouterLink to="/admin/employes">Employés</RouterLink>
        </p>
      </form>

      <template #footer>
        <UiButton type="button" variant="ghost" @click="closeFormModal">Annuler</UiButton>
        <UiButton type="button" variant="ghost" :icon="RotateCcw" @click="resetForm">Effacer</UiButton>
        <UiButton
          type="submit"
          form="staff-patient-form"
          variant="primary"
          :icon="UserPlus"
          :disabled="!canRegister || registering"
        >
          {{ registering ? 'Enregistrement…' : 'Enregistrer (gratuit)' }}
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.staff-form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.form-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.doctors-empty-alert__links {
  margin: -0.15rem 0 0;
  font-size: 0.8125rem;
}

.doctors-empty-alert__links a {
  color: var(--primary-700, #4b5d2a);
  font-weight: 600;
}

.queue-table-wrap {
  overflow-x: auto;
}

.queue-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.queue-table th,
.queue-table td {
  padding: 0.65rem 0.5rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: middle;
}

.queue-table .sub {
  display: block;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.col-actions {
  min-width: 7rem;
  text-align: right;
  white-space: nowrap;
}

.list-count {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
}

.empty {
  text-align: center;
  color: var(--text-light);
  padding: 1.5rem;
}

@media (max-width: 960px) {
  .form-grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
