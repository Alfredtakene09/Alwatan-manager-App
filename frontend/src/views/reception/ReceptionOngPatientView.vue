<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { UserPlus, RotateCcw, Printer, Handshake, Building2, Pencil, Trash2, Save } from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal, showApiErrorModal, showDuplicateModalFromError } from '@/lib/api-modal-helper'
import { fullName } from '@/lib/roles'
import { joinPatientFullName, parsePatientAge, splitPatientFullName } from '@/lib/patient-name'
import { normalizePatientAgeUnit, type PatientAgeUnit } from '@/lib/patient-age'
import {
  doctorMatchesService,
  doctorMatchesClinicServiceId,
  preferredDoctorId,
  sortDoctorsForReception,
  type DoctorOption,
} from '@/lib/doctor-compensation'
import {
  buildConsultationReceiptHtml,
  cancelPrintWindow,
  openPrintDocument,
  reservePrintWindow,
} from '@/lib/print-document'
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
import PartnersManager from '@/components/reception/PartnersManager.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
/** L'onglet Partenaires (gestion de la liste) est réservé à l'administrateur. */
const isAdmin = computed(() => auth.user?.role === 'ADMIN')
const isReceptionist = computed(() => auth.user?.role === 'RECEPTIONNISTE')
const activeTab = ref<'patients' | 'partners'>('patients')

function goToPartnersTab() {
  showFormModal.value = false
  activeTab.value = 'partners'
}

const { uiText, clinicServiceText, dateTimeText, numberText, localeCode } = useAppI18n()

type OngPatientRow = {
  id: string
  code: string
  firstName: string
  lastName: string
  phone?: string | null
  service?: string | null
  gender?: string | null
  age?: number | null
  ageUnit?: PatientAgeUnit | null
  ongName?: string | null
  createdAt: string
}

const doctors = ref<DoctorOption[]>([])
const services = ref<Array<{ id: string; name: string; doctorUserIds?: string[] }>>([])
const queue = ref<OngPatientRow[]>([])
const loadingQueue = ref(false)
const registering = ref(false)
const showFormModal = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const search = ref('')
const partners = ref<Array<{ id: string; name: string }>>([])
/** Dossier en cours de modification (null = nouvel enregistrement). */
const editingId = ref<string | null>(null)
const busyRowId = ref<string | null>(null)

type OngPatientDetail = OngPatientRow & {
  treatingDoctorId?: string | null
  waitingVisit?: {
    doctorId?: string | null
    doctor?: { firstName: string; lastName: string } | null
    serviceName?: string | null
    consultationFeeFcfa?: number | null
    consultationAmountFcfa?: number | null
    reductionFcfa?: number | null
    totalFcfa?: number | null
    invoiceNumber?: string | null
  } | null
  consultationPayment?: { amountFcfa?: number | null; invoiceNumber?: string | null } | null
}

async function loadPartners() {
  try {
    const { data } = await api.get<Array<{ id: string; name: string }>>('/partners')
    partners.value = Array.isArray(data) ? data : []
  } catch {
    partners.value = []
  }
}

const emptyForm = () => ({
  fullName: '',
  age: '',
  ageUnit: 'YEARS' as PatientAgeUnit,
  phone: '',
  service: services.value[0]?.name ?? '',
  gender: 'F',
  ongName: '',
  doctorId: '',
  treatingDoctorId: '',
})
const form = ref(emptyForm())

const parsedName = computed(() => splitPatientFullName(form.value.fullName))
const parsedAge = computed(() => parsePatientAge(form.value.age, form.value.ageUnit))
const sortedDoctors = computed(() => sortDoctorsForReception(doctors.value))
const filteredDoctors = computed(() => {
  if (!form.value.service) return sortedDoctors.value
  const svc = services.value.find((service) => service.name === form.value.service)
  const linkedIds = svc?.doctorUserIds?.filter(Boolean) ?? []
  let matched = sortedDoctors.value
  if (linkedIds.length) {
    const idSet = new Set(linkedIds)
    matched = sortedDoctors.value.filter((doctor) => idSet.has(doctor.id))
  } else if (svc?.id) {
    matched = sortedDoctors.value.filter((doctor) => doctorMatchesClinicServiceId(doctor, svc.id))
  } else {
    matched = sortedDoctors.value.filter((doctor) => doctorMatchesService(doctor, form.value.service))
  }
  if (form.value.service && !matched.length) matched = sortedDoctors.value
  return sortDoctorsForReception(matched)
})

const filteredQueue = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return queue.value
  return queue.value.filter((row) =>
    [row.firstName, row.lastName, row.code, row.ongName ?? '', row.phone ?? '']
      .join(' ')
      .toLowerCase()
      .includes(q),
  )
})

const canRegister = computed(() => {
  const { firstName, lastName } = parsedName.value
  // Téléphone facultatif (comme à la réception), mais au moins 6 chiffres s'il est saisi.
  const phoneDigits = form.value.phone.replace(/\D/g, '')
  return (
    firstName.length >= 2 &&
    lastName.length >= 2 &&
    parsedAge.value !== null &&
    (!form.value.phone.trim() || phoneDigits.length >= 6) &&
    !!form.value.service &&
    form.value.ongName.trim().length >= 2 &&
    !!form.value.doctorId
  )
})

function resetForm() {
  form.value = emptyForm()
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
  await Promise.all([loadServices(), loadPartners()])
  editingId.value = null
  resetForm()
  message.value = ''
  showFormModal.value = true
}

async function openEditModal(row: OngPatientRow) {
  busyRowId.value = row.id
  try {
    const [{ data }] = await Promise.all([
      api.get<OngPatientDetail>(`/patients/${row.id}`),
      loadServices(),
      loadPartners(),
    ])
    editingId.value = row.id
    message.value = ''
    form.value = {
      fullName: joinPatientFullName(data.firstName, data.lastName),
      age: data.age != null ? String(data.age) : '',
      ageUnit: normalizePatientAgeUnit(data.ageUnit),
      phone: data.phone ?? '',
      service: data.service?.trim() || data.waitingVisit?.serviceName?.trim() || '',
      gender: data.gender ?? 'F',
      ongName: data.ongName ?? '',
      doctorId: data.waitingVisit?.doctorId ?? '',
      treatingDoctorId: data.treatingDoctorId ?? '',
    }
    showFormModal.value = true
  } catch (error) {
    await showApiErrorModal(error, 'Impossible de charger le dossier patient.')
  } finally {
    busyRowId.value = null
  }
}

async function deleteOngPatient(row: OngPatientRow) {
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: uiText('Supprimer le patient (admin)'),
    message: translateTemplate(
      'Supprimer le dossier {code} — {name} ? Visites, consultations et documents liés seront supprimés. La somme déjà encaissée sera aussi retirée du solde. Cette action est irréversible.',
      { code: row.code, name: fullName(row.firstName, row.lastName) },
    ),
    confirmLabel: uiText('Supprimer'),
  })
  if (!confirmed) return
  busyRowId.value = row.id
  try {
    await api.delete(`/patients/${row.id}`)
    message.value = translateTemplate('Dossier {code} supprimé.', { code: row.code })
    messageType.value = 'success'
    await loadQueue()
  } catch (error) {
    await showApiErrorModal(error, 'Impossible de supprimer ce patient.')
  } finally {
    busyRowId.value = null
  }
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
    const { data } = await api.get<OngPatientRow[]>('/patients', { params: { category: 'ONG' } })
    queue.value = data
  } finally {
    loadingQueue.value = false
  }
}

async function registerOngPatient() {
  if (!canRegister.value || registering.value) return
  if (editingId.value) return updateOngPatient(editingId.value)
  reservePrintWindow('80mm')
  registering.value = true
  message.value = ''
  try {
    const { firstName, lastName } = parsedName.value
    const ongName = form.value.ongName.trim()
    const { data } = await api.post<{ patient: OngPatientRow; linkedExistingDossier?: boolean }>(
      '/patients/register-consultation',
      {
        firstName,
        lastName,
        age: parsedAge.value ?? undefined,
        ageUnit: form.value.ageUnit,
        phone: form.value.phone.trim(),
        service: form.value.service || undefined,
        gender: form.value.gender,
        category: 'ONG',
        ongName,
        doctorId: form.value.doctorId,
        treatingDoctorId: form.value.treatingDoctorId || null,
      },
    )
    message.value = translateTemplate('Patient ONG / Partenaire enregistré ({ong}) — envoyé chez {doctor}.', {
      ong: data.patient.ongName || ongName,
      doctor: getDoctorName(form.value.doctorId),
    })
    messageType.value = 'success'
    await printOngReceipt(data.patient.id)
    showFormModal.value = false
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

async function updateOngPatient(patientId: string) {
  registering.value = true
  message.value = ''
  try {
    const { firstName, lastName } = parsedName.value
    // La réceptionniste a un formulaire restreint (pas de sexe ni de médecin traitant).
    await api.patch(`/patients/${patientId}`, {
      firstName,
      lastName,
      age: parsedAge.value ?? undefined,
      ageUnit: form.value.ageUnit,
      phone: form.value.phone.trim(),
      service: form.value.service || undefined,
      doctorId: form.value.doctorId || undefined,
      ongName: form.value.ongName.trim(),
      ...(isReceptionist.value
        ? {}
        : {
            gender: form.value.gender,
            category: 'ONG',
            treatingDoctorId: form.value.treatingDoctorId || null,
          }),
    })
    message.value = uiText('Dossier mis à jour.')
    messageType.value = 'success'
    showFormModal.value = false
    editingId.value = null
    await loadQueue()
  } catch (error: unknown) {
    const shown = await showDuplicateModalFromError(error)
    if (!shown) await showApiErrorModal(error, 'Impossible de modifier le dossier.')
  } finally {
    registering.value = false
  }
}

/** Reçu de consultation 80 mm, identique aux autres patients (fenêtre déjà réservée). */
async function printOngReceipt(patientId: string) {
  const { data: detail } = await api.get<OngPatientDetail>(`/patients/${patientId}`)
  const visit = detail.waitingVisit
  const payment = detail.consultationPayment
  const reduction = Math.max(0, visit?.reductionFcfa ?? 0)
  const fee = Number(visit?.consultationFeeFcfa) || Number(visit?.consultationAmountFcfa) || 0
  const invoiceNet = Number(visit?.totalFcfa) || Number(payment?.amountFcfa) || 0
  const amount = fee > 0 ? fee : invoiceNet > 0 ? invoiceNet + reduction : 0
  const total = invoiceNet > 0 ? invoiceNet : Math.max(0, amount - reduction)
  openPrintDocument(
    translateTemplate('Reçu {code}', { code: detail.code }),
    buildConsultationReceiptHtml({
      patientCode: detail.code,
      patientName: fullName(detail.firstName, detail.lastName),
      doctorName: visit?.doctor ? `Dr ${fullName(visit.doctor.firstName, visit.doctor.lastName)}` : '—',
      amount,
      reduction,
      total,
      invoiceNumber: visit?.invoiceNumber ?? payment?.invoiceNumber ?? uiText('Facturation différée'),
      date: new Date().toLocaleString('fr-FR'),
      age: detail.age,
      ageUnit: normalizePatientAgeUnit(detail.ageUnit),
      gender: detail.gender,
      phone: detail.phone,
      processedBy: auth.user ? fullName(auth.user.firstName, auth.user.lastName) : undefined,
    }),
    { pageSize: '80mm', autoPrint: true, thermalTight: true },
  )
}

async function printReceiptForRow(row: OngPatientRow) {
  if (busyRowId.value) return
  busyRowId.value = row.id
  reservePrintWindow('80mm')
  try {
    await printOngReceipt(row.id)
  } catch (error) {
    cancelPrintWindow()
    await showApiErrorModal(error, "Impossible d'imprimer le reçu.")
  } finally {
    busyRowId.value = null
  }
}

const queueCountLabel = computed(() => {
  void localeCode.value
  return translateTemplate('{n} dossier(s)', { n: numberText(filteredQueue.value.length) })
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
      title="Patients ONG / Partenaire"
      subtitle="Patients pris en charge par une ONG ou un partenaire de la clinique"
      :icon="Handshake"
    />

    <div v-if="isAdmin" class="page-tabs" role="tablist" :aria-label="uiText('ONG / Partenaire')">
      <button
        type="button"
        class="page-tab"
        :class="{ 'page-tab--active': activeTab === 'patients' }"
        @click="activeTab = 'patients'"
      >
        <Handshake :size="14" />
        {{ uiText('Patients') }}
      </button>
      <button
        type="button"
        class="page-tab"
        :class="{ 'page-tab--active': activeTab === 'partners' }"
        @click="activeTab = 'partners'"
      >
        <Building2 :size="14" />
        {{ uiText('Partenaires') }}
      </button>
    </div>

    <PartnersManager v-if="isAdmin && activeTab === 'partners'" />

    <template v-else>
    <UiAlert v-if="message" :type="messageType" :message="message" />

    <div class="page-create-bar">
      <UiButton variant="primary" :icon="UserPlus" @click="openFormModal">Nouveau</UiButton>
    </div>

    <UiCard title="Patients ONG / Partenaire enregistrés" class="queue-card" :icon="Handshake" icon-variant="blue">
      <template #actions>
        <UiInput v-model="search" label="" placeholder="Rechercher un patient ou une ONG…" class="queue-search" />
        <UiButton variant="ghost" size="sm" :disabled="loadingQueue" @click="loadQueue">Actualiser</UiButton>
        <span class="list-count">{{ queueCountLabel }}</span>
      </template>

      <p v-if="!loadingQueue && !filteredQueue.length" class="empty">
        {{ uiText('Aucun patient ONG / Partenaire enregistré pour le moment') }}
      </p>
      <div v-else class="queue-table-wrap">
        <table class="queue-table">
          <thead>
            <tr>
              <th>{{ uiText('Patient') }}</th>
              <th>{{ uiText('ONG / Partenaire') }}</th>
              <th>{{ uiText('Service') }}</th>
              <th>{{ uiText('Téléphone') }}</th>
              <th>{{ uiText('Enregistré le') }}</th>
              <th class="col-actions">{{ uiText('Actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filteredQueue" :key="row.id">
              <td>
                <strong>{{ fullName(row.firstName, row.lastName) }}</strong>
                <span class="sub">{{ row.code }}</span>
              </td>
              <td>{{ row.ongName || '—' }}</td>
              <td>{{ row.service ? clinicServiceText(row.service) : '—' }}</td>
              <td>{{ row.phone || '—' }}</td>
              <td>{{ dateTimeText(row.createdAt) }}</td>
              <td class="col-actions">
                <UiButton
                  variant="ghost"
                  size="sm"
                  :icon="Printer"
                  :title="uiText('Imprimer le reçu')"
                  :aria-label="uiText('Imprimer le reçu')"
                  :disabled="!!busyRowId"
                  @click="printReceiptForRow(row)"
                />
                <UiButton
                  variant="ghost"
                  size="sm"
                  :icon="Pencil"
                  :title="uiText('Modifier')"
                  :aria-label="uiText('Modifier')"
                  :disabled="!!busyRowId"
                  @click="openEditModal(row)"
                />
                <UiButton
                  v-if="isAdmin"
                  variant="ghost"
                  size="sm"
                  class="action-delete"
                  :icon="Trash2"
                  :title="uiText('Supprimer')"
                  :aria-label="uiText('Supprimer')"
                  :disabled="!!busyRowId"
                  @click="deleteOngPatient(row)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCard>
    </template>

    <UiFormModal
      v-if="showFormModal"
      title-id="ong-patient-modal-title"
      :title="editingId ? 'Modifier le patient ONG / Partenaire' : 'Nouveau patient ONG / Partenaire'"
      subtitle="Le parcours est facturé comme un patient standard"
      :icon="UserPlus"
      @close="showFormModal = false"
    >
      <form id="ong-patient-form" class="ong-form" @submit.prevent="registerOngPatient">
        <ReceptionPatientIdentityFields
          v-model:full-name="form.fullName"
          v-model:age="form.age"
          v-model:age-unit="form.ageUnit"
          v-model:phone="form.phone"
          v-model:gender="form.gender"
        />

        <UiSelect v-model="form.ongName" label="ONG / Partenaire" required>
          <option value="" disabled>
            {{ partners.length ? uiText('Sélectionner') : uiText('Aucun partenaire enregistré pour le moment') }}
          </option>
          <option v-for="partner in partners" :key="partner.id" :value="partner.name">
            {{ partner.name }}
          </option>
        </UiSelect>
        <p v-if="!partners.length && isAdmin" class="doctors-empty-alert__links">
          <a href="#" @click.prevent="goToPartnersTab">{{ uiText('Ajouter un partenaire') }}</a>
        </p>

        <div class="form-grid-2">
          <UiSelect v-model="form.service" label="Service" required>
            <option value="" disabled>
              {{ services.length ? uiText('Sélectionner un service') : uiText('Aucun service disponible') }}
            </option>
            <option v-for="service in services" :key="service.id" :value="service.name">
              {{ clinicServiceText(service.name) }}
            </option>
          </UiSelect>
          <UiSelect v-model="form.doctorId" label="Médecin" required>
            <option value="" disabled>
              {{ filteredDoctors.length ? uiText('Sélectionner') : uiText('Aucun médecin sur ce service') }}
            </option>
            <option v-for="doctor in filteredDoctors" :key="doctor.id" :value="doctor.id">
              Dr {{ fullName(doctor.firstName, doctor.lastName) }}
            </option>
          </UiSelect>
        </div>

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
        <UiButton type="button" variant="ghost" @click="showFormModal = false">Annuler</UiButton>
        <UiButton type="button" variant="ghost" :icon="RotateCcw" @click="resetForm">Effacer</UiButton>
        <UiButton
          type="submit"
          form="ong-patient-form"
          variant="primary"
          :icon="editingId ? Save : UserPlus"
          :disabled="!canRegister || registering"
        >
          {{ registering ? uiText('Enregistrement…') : uiText(editingId ? 'Mettre à jour' : 'Enregistrer') }}
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.col-actions :deep(.action-delete) {
  color: #be123c;
}

.ong-form {
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

.queue-search {
  min-width: 14rem;
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
  min-width: 5rem;
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
