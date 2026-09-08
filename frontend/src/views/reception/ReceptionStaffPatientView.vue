<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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
import {
  doctorMatchesService,
  doctorMatchesClinicServiceId,
  preferredDoctorId,
  sortDoctorsForReception,
  type DoctorOption,
} from '@/lib/doctor-compensation'
import { CLINIC } from '@/lib/clinic'
import { buildClinicPrintHeader, cancelPrintWindow, openPrintDocument, reservePrintWindow } from '@/lib/print-document'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import ReceptionPatientIdentityFields from '@/components/reception/ReceptionPatientIdentityFields.vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'

const { uiText, clinicServiceText, dateTimeText, numberText, localeCode } = useAppI18n()

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
const services = ref<Array<{ id: string; name: string; doctorUserIds?: string[] }>>([])
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
const sortedDoctors = computed(() => sortDoctorsForReception(doctors.value))
const filteredDoctors = computed(() => {
  if (!form.value.service) return sortedDoctors.value
  const svc = services.value.find((service) => service.name === form.value.service)
  const linkedIds = svc?.doctorUserIds?.filter(Boolean) ?? []
  if (linkedIds.length) {
    const idSet = new Set(linkedIds)
    return sortDoctorsForReception(sortedDoctors.value.filter((doctor) => idSet.has(doctor.id)))
  }
  if (svc?.id) {
    return sortDoctorsForReception(
      sortedDoctors.value.filter((doctor) => doctorMatchesClinicServiceId(doctor, svc.id)),
    )
  }
  return sortDoctorsForReception(
    sortedDoctors.value.filter((doctor) => doctorMatchesService(doctor, form.value.service)),
  )
})

const canRegister = computed(() => {
  const { firstName, lastName } = parsedName.value
  const phoneDigits = form.value.phone.replace(/\D/g, '')
  return (
    firstName.length >= 2 &&
    lastName.length >= 2 &&
    parsedAge.value !== null &&
    phoneDigits.length >= 6 &&
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
    doctorId: '',
    treatingDoctorId: '',
  }
  syncDoctorsForService()
}

function getDoctorName(doctorId: string) {
  const doctor = doctors.value.find((d) => d.id === doctorId)
  return doctor ? `Dr ${fullName(doctor.firstName, doctor.lastName)}` : '—'
}

function syncDoctorsForService() {
  if (!filteredDoctors.value.length) {
    form.value.doctorId = ''
    form.value.treatingDoctorId = ''
    return
  }
  form.value.doctorId = preferredDoctorId(filteredDoctors.value, form.value.doctorId)
  if (form.value.treatingDoctorId && !filteredDoctors.value.some((d) => d.id === form.value.treatingDoctorId)) {
    form.value.treatingDoctorId = ''
  }
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
    doctors.value = Array.isArray(data) ? data : []
    syncDoctorsForService()
  } catch {
    doctors.value = []
  }
}

async function loadServices() {
  try {
    const { data } = await api.get<Array<{ id: string; name: string; doctorUserIds?: string[] }>>(
      '/visits/external-services',
    )
    services.value = Array.isArray(data) ? data : []
    if (!form.value.service) form.value.service = services.value[0]?.name ?? ''
    syncDoctorsForService()
  } catch {
    services.value = []
  }
}

watch(
  () => form.value.service,
  () => syncDoctorsForService(),
)

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
  reservePrintWindow('A4')
  registering.value = true
  message.value = ''
  try {
    const { firstName, lastName } = parsedName.value
    const { data } = await api.post<{ patient: StaffPatientRow; linkedExistingDossier?: boolean }>(
      '/patients/register-consultation',
      {
        firstName,
        lastName,
        age: parsedAge.value ?? undefined,
        ageUnit: form.value.ageUnit,
        phone: form.value.phone.trim(),
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
    message.value = translateTemplate('Patient personnel enregistré (gratuit) — envoyé chez {doctor}.', {
      doctor: getDoctorName(form.value.doctorId),
    })
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
    cancelPrintWindow()
    const shown = await showDuplicateModalFromError(error)
    if (shown) return
    const apiMessage =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
    message.value = apiMessage ?? "Erreur lors de l'enregistrement."
    messageType.value = 'error'
  } finally {
    registering.value = false
  }
}

function printFiche(row: StaffPatientRow) {
  const patientName = fullName(row.firstName, row.lastName)
  openPrintDocument(
    `${uiText('Fiche patient personnel')} ${row.code}`,
    `
${buildClinicPrintHeader(uiText('Fiche patient — Personnel (gratuit)'))}
  <div class="row"><span>${uiText('Date')}</span><strong>${dateTimeText(row.createdAt)}</strong></div>
  <div class="row"><span>${uiText('Patient')}</span><strong>${patientName}</strong></div>
  <div class="row"><span>${uiText('Matricule')}</span><strong>${row.code}</strong></div>
              ${row.service ? `<div class="row"><span>${uiText('Service')}</span><strong>${clinicServiceText(row.service)}</strong></div>` : ''}
  ${row.recommendedByName ? `<div class="row"><span>${uiText('Recommandé par')}</span><strong>${row.recommendedByName}</strong></div>` : ''}
  ${row.phone ? `<div class="row"><span>${uiText('Téléphone')}</span><strong>${row.phone}</strong></div>` : ''}
  ${row.age != null ? `<div class="row"><span>${uiText('Âge')}</span><strong>${formatPatientAge(row.age, normalizePatientAgeUnit(row.ageUnit))}</strong></div>` : ''}
  <p style="margin-top:1rem;color:#64748b;font-size:0.875rem;">${uiText('Parcours gratuit — consultation et examens exonérés.')}</p>
  <div class="footer">${CLINIC.fullAddress}<br>${CLINIC.phoneLabel} — ${CLINIC.email}</div>
`,
  )
}

const queueCountLabel = computed(() => {
  void localeCode.value
  return translateTemplate('{n} dossier(s)', { n: numberText(queue.value.length) })
})

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
      subtitle="Enregistrement d'un membre du personnel ou d'un proche recommandé — parcours entièrement gratuit"
      :icon="UserCheck"
    />

    <UiAlert v-if="message" :type="messageType" :message="message" />

    <div class="page-create-bar">
      <UiButton variant="primary" :icon="UserPlus" @click="openFormModal">
        Nouveau
      </UiButton>
    </div>

    <UiCard title="Patients personnel enregistrés" class="queue-card" :icon="UserCheck" icon-variant="blue">
      <template #actions>
        <UiButton variant="ghost" size="sm" :disabled="loadingQueue" @click="loadQueue">
          Actualiser
        </UiButton>
        <span class="list-count">{{ queueCountLabel }}</span>
      </template>

      <p v-if="!loadingQueue && !queue.length" class="empty">
        {{ uiText('Aucun patient personnel enregistré pour le moment') }}
      </p>
      <div v-else class="queue-table-wrap">
        <table class="queue-table">
          <thead>
            <tr>
              <th>{{ uiText('Patient') }}</th>
              <th>{{ uiText('Service') }}</th>
              <th>{{ uiText('Recommandé par') }}</th>
              <th>{{ uiText('Enregistré le') }}</th>
              <th class="col-actions">{{ uiText('Actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in queue" :key="row.id">
              <td>
                <strong>{{ fullName(row.firstName, row.lastName) }}</strong>
                <span class="sub">{{ row.code }}</span>
              </td>
              <td>{{ row.service ? clinicServiceText(row.service) : '—' }}</td>
              <td>{{ row.recommendedByName || '—' }}</td>
              <td>{{ dateTimeText(row.createdAt) }}</td>
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
            <option value="" disabled>
              {{
                services.length
                  ? uiText('Sélectionner un service')
                  : uiText('Aucun service disponible')
              }}
            </option>
            <option v-for="service in services" :key="service.id" :value="service.name">
              {{ clinicServiceText(service.name) }}
            </option>
          </UiSelect>
          <UiSelect v-model="form.doctorId" label="Médecin" required>
            <option value="" disabled>
              {{
                filteredDoctors.length
                  ? uiText('Sélectionner')
                  : uiText('Aucun médecin sur ce service')
              }}
            </option>
            <option v-for="doctor in filteredDoctors" :key="doctor.id" :value="doctor.id">
              Dr {{ fullName(doctor.firstName, doctor.lastName) }}
            </option>
          </UiSelect>
        </div>

        <UiInput
          v-model="form.recommendedByName"
          label="Recommandé par"
          placeholder="Nom du membre du personnel"
          :icon="UserRound"
          required
        />

        <UiSelect v-model="form.treatingDoctorId" label="Médecin traitant (dossier)">
          <option value="">{{ uiText('Aucun (optionnel)') }}</option>
          <option v-for="doctor in filteredDoctors" :key="doctor.id" :value="doctor.id">
            Dr {{ fullName(doctor.firstName, doctor.lastName) }}
          </option>
        </UiSelect>

        <UiAlert
          v-if="!filteredDoctors.length"
          type="warning"
          message="Aucun médecin lié à ce service. Affectez les médecins au service depuis la page Services."
        />
        <p v-if="!filteredDoctors.length" class="doctors-empty-alert__links">
          <RouterLink to="/admin/services">{{ uiText('Services') }}</RouterLink>
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
          {{ registering ? uiText('Enregistrement…') : uiText('Enregistrer (gratuit)') }}
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
