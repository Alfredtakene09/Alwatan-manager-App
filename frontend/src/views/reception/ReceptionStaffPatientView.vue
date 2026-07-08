<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
  gender?: string | null
  age?: number | null
  ageUnit?: PatientAgeUnit | null
  recommendedByName?: string | null
  createdAt: string
}

const doctors = ref<DoctorOption[]>([])
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
  gender: 'F',
  recommendedByName: '',
  doctorId: '',
})

const parsedName = computed(() => splitPatientFullName(form.value.fullName))
const parsedAge = computed(() => parsePatientAge(form.value.age, form.value.ageUnit))

const canRegister = computed(() => {
  const { firstName, lastName } = parsedName.value
  return (
    firstName.length >= 2 &&
    lastName.length >= 2 &&
    parsedAge.value !== null &&
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
    gender: 'F',
    recommendedByName: '',
    doctorId: doctors.value[0]?.id ?? '',
  }
}

function getDoctorName(doctorId: string) {
  const doctor = doctors.value.find((d) => d.id === doctorId)
  return doctor ? `Dr ${fullName(doctor.firstName, doctor.lastName)}` : '—'
}

function openFormModal() {
  resetForm()
  message.value = ''
  showFormModal.value = true
}

function closeFormModal() {
  showFormModal.value = false
}

async function loadDoctors() {
  const { data } = await api.get<DoctorOption[]>('/visits/doctors')
  doctors.value = data
  if (!form.value.doctorId) form.value.doctorId = data[0]?.id ?? ''
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
        gender: form.value.gender,
        category: 'PERSONNEL',
        recommendedByName: form.value.recommendedByName.trim(),
        doctorId: form.value.doctorId,
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
          <UiInput
            v-model="form.recommendedByName"
            label="Recommandé par"
            placeholder="Nom du membre du personnel"
            :icon="UserRound"
            required
          />
          <UiSelect v-model="form.doctorId" label="Médecin" required>
            <option value="" disabled>Sélectionner</option>
            <option v-for="doctor in doctors" :key="doctor.id" :value="doctor.id">
              Dr {{ fullName(doctor.firstName, doctor.lastName) }}{{ doctorSelectSuffix(doctor) }}
            </option>
          </UiSelect>
        </div>
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
