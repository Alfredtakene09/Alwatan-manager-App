<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  UserRound,
  FlaskConical,
  CreditCard,
  Search,
  X,
  RotateCcw,
  Percent,
  UserPlus,
  Printer,
  Pencil,
} from '@lucide/vue'
import api from '@/api/client'
import { showDuplicateModalFromError } from '@/lib/api-modal-helper'
import { formatFcfa, fullName } from '@/lib/roles'
import { parsePatientAge, splitPatientFullName, formatPatientAge } from '@/lib/patient-name'
import { normalizePatientAgeUnit, type PatientAgeUnit } from '@/lib/patient-age'
import { computeGrossFcfaFromExamsByKind, getLabExamPriceFcfa } from '@/lib/lab-exams'
import { CLINIC } from '@/lib/clinic'
import { buildClinicPrintHeader, buildLabExamInvoiceHtml, openPrintDocument } from '@/lib/print-document'
import MultiExamPrescriptionPicker from '@/components/MultiExamPrescriptionPicker.vue'
import { emptyExamsByKind, countExamsByKind, type ExamsByKind } from '@/lib/exam-catalog'
import ReceptionPatientIdentityFields from '@/components/reception/ReceptionPatientIdentityFields.vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import ReceptionQueueRowActions, {
  type QueueRowAction,
} from '@/components/reception/ReceptionQueueRowActions.vue'

type PatientRow = {
  id: string
  code: string
  firstName: string
  lastName: string
  phone?: string | null
  gender?: string | null
  age?: number | null
  ageUnit?: PatientAgeUnit | null
}

type QueuePatient = {
  id: string
  code: string
  firstName: string
  lastName: string
  phone?: string | null
  gender?: string | null
  age?: number | null
  ageUnit?: PatientAgeUnit | null
}

type ExternalQueueRow = {
  id: string
  visitId: string
  patientId: string
  updatedAt: string
  hasExams: boolean
  examsSummary: string
  grossFcfa: number
  netFcfa: number
  invoiced: boolean
  invoiceNumber?: string | null
  labSentToLabAt: string | null
  clinicalNotes?: string | null
  patient: QueuePatient
}

type DraftNewPatient = {
  fullName: string
  age: string
  ageUnit: PatientAgeUnit
  phone: string
  gender: string
}

const search = ref('')
const searchResults = ref<PatientRow[]>([])
const showNewPatientModal = ref(false)
const showExamsModal = ref(false)
const showEditModal = ref(false)
const activeRow = ref<ExternalQueueRow | null>(null)
const editingPatientId = ref<string | null>(null)
const queue = ref<ExternalQueueRow[]>([])
const loadingQueue = ref(false)
const registering = ref(false)

const patientForm = ref<DraftNewPatient>({
  fullName: '',
  age: '',
  ageUnit: 'YEARS',
  phone: '',
  gender: 'F',
})

const editForm = ref<DraftNewPatient>({
  fullName: '',
  age: '',
  ageUnit: 'YEARS',
  phone: '',
  gender: 'F',
})

const examsByKind = ref<ExamsByKind>(emptyExamsByKind())
const reductionFcfa = ref(0)
const submitting = ref(false)
const savingEdit = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')

const parsedName = computed(() => splitPatientFullName(patientForm.value.fullName))
const parsedAge = computed(() => parsePatientAge(patientForm.value.age, patientForm.value.ageUnit))
const editParsedName = computed(() => splitPatientFullName(editForm.value.fullName))
const editParsedAge = computed(() => parsePatientAge(editForm.value.age, editForm.value.ageUnit))

const grossFcfa = computed(() => computeGrossFcfaFromExamsByKind(examsByKind.value))
const netFcfa = computed(() => Math.max(0, grossFcfa.value - (Number(reductionFcfa.value) || 0)))

const canConfirmNewPatient = computed(() => {
  const { firstName, lastName } = parsedName.value
  return firstName.length >= 2 && lastName.length >= 2 && parsedAge.value !== null
})

const canSaveEdit = computed(() => {
  const { firstName, lastName } = editParsedName.value
  return firstName.length >= 2 && lastName.length >= 2 && editParsedAge.value !== null
})

const canSubmitExams = computed(
  () => !!activeRow.value && countExamsByKind(examsByKind.value) > 0 && netFcfa.value > 0,
)

const activePatientLabel = computed(() => {
  if (!activeRow.value) return ''
  const p = activeRow.value.patient
  return `${p.code} — ${fullName(p.firstName, p.lastName)}`
})

const searchLabel = computed(() =>
  searchResults.value.length
    ? `${searchResults.value.length} résultat(s)`
    : 'Rechercher un dossier existant',
)

function resetPatientForm() {
  patientForm.value = { fullName: '', age: '', ageUnit: 'YEARS', phone: '', gender: 'F' }
}

function openNewPatientModal() {
  resetPatientForm()
  showNewPatientModal.value = true
}

function closeNewPatientModal() {
  showNewPatientModal.value = false
}

function resetExamsForm() {
  examsByKind.value = emptyExamsByKind()
  reductionFcfa.value = 0
}

function openExamsModal(row: ExternalQueueRow) {
  if (row.hasExams) return
  activeRow.value = row
  resetExamsForm()
  showExamsModal.value = true
}

function closeExamsModal() {
  showExamsModal.value = false
  activeRow.value = null
}

function openEditModal(row: ExternalQueueRow) {
  editingPatientId.value = row.patientId
  editForm.value = {
    fullName: fullName(row.patient.firstName, row.patient.lastName),
    age: row.patient.age != null ? String(row.patient.age) : '',
    ageUnit: normalizePatientAgeUnit(row.patient.ageUnit),
    phone: row.patient.phone ?? '',
    gender: row.patient.gender ?? 'F',
  }
  showEditModal.value = true
}

function closeEditModal() {
  showEditModal.value = false
  editingPatientId.value = null
}

function queueStatusLabel(row: ExternalQueueRow) {
  if (!row.hasExams) return 'En attente examens'
  if (row.invoiced) return row.invoiceNumber ?? 'Payé'
  return 'Envoyé au labo'
}

function queueStatusVariant(row: ExternalQueueRow): 'success' | 'warning' | 'info' {
  if (!row.hasExams) return 'warning'
  if (row.invoiced) return 'success'
  return 'info'
}

function externalRowActions(row: ExternalQueueRow): QueueRowAction[] {
  return [
    {
      key: 'exams',
      label: 'Examens',
      icon: FlaskConical,
      variant: 'accent',
      disabled: row.hasExams,
      disabledReason: row.hasExams ? 'Examens déjà prescrits' : undefined,
    },
    { key: 'edit', label: 'Modifier', icon: Pencil },
    { key: 'print', label: 'Imprimer', icon: Printer },
  ]
}

function onExternalRowAction(key: string, row: ExternalQueueRow) {
  if (key === 'exams') openExamsModal(row)
  if (key === 'edit') openEditModal(row)
  if (key === 'print') printRow(row)
}

function examLabelsFromRow(row: ExternalQueueRow) {
  if (!row.hasExams) return []
  return row.examsSummary.split(', ').filter(Boolean)
}

function printRow(row: ExternalQueueRow) {
  const patient = row.patient
  const patientName = fullName(patient.firstName, patient.lastName)

  if (!row.hasExams) {
    openPrintDocument(
      `Fiche patient ${patient.code}`,
      `
${buildClinicPrintHeader('Fiche patient externe')}
  <div class="row"><span>Date</span><strong>${new Date(row.updatedAt).toLocaleString('fr-FR')}</strong></div>
  <div class="row"><span>Patient</span><strong>${patientName}</strong></div>
  <div class="row"><span>Matricule</span><strong>${patient.code}</strong></div>
  ${patient.phone ? `<div class="row"><span>Téléphone</span><strong>${patient.phone}</strong></div>` : ''}
  ${patient.age != null ? `<div class="row"><span>Âge</span><strong>${formatPatientAge(patient.age, normalizePatientAgeUnit(patient.ageUnit))}</strong></div>` : ''}
  <p style="margin-top:1rem;color:#64748b;font-size:0.875rem;">Dossier enregistré — examens en attente de prescription.</p>
  <div class="footer">${CLINIC.fullAddress}<br>${CLINIC.phoneLabel} — ${CLINIC.email}</div>
`,
    )
    return
  }

  const labels = examLabelsFromRow(row)
  const reduction = Math.max(0, row.grossFcfa - row.netFcfa)

  openPrintDocument(
    `Facture examens ${patient.code}`,
    buildLabExamInvoiceHtml({
      patientCode: patient.code,
      patientName,
      prescribedBy: 'Patient externe — réception',
      examLines: labels.map((label) => ({
        label,
        amountFcfa: getLabExamPriceFcfa(label),
      })),
      grossFcfa: row.grossFcfa,
      reductionFcfa: reduction,
      totalFcfa: row.netFcfa,
      invoiceNumber: row.invoiceNumber ?? undefined,
      date: row.updatedAt,
      age: patient.age,
      ageUnit: normalizePatientAgeUnit(patient.ageUnit),
      gender: patient.gender,
      phone: patient.phone ?? undefined,
    }),
    { pageSize: 'A5' },
  )
}

async function loadQueue() {
  loadingQueue.value = true
  try {
    const { data } = await api.get<ExternalQueueRow[]>('/visits/external-queue')
    queue.value = data
  } finally {
    loadingQueue.value = false
  }
}

async function searchPatients() {
  if (!search.value.trim()) {
    searchResults.value = []
    return
  }
  const { data } = await api.get<PatientRow[]>('/patients', {
    params: { q: search.value.trim(), category: 'STANDARD' },
  })
  searchResults.value = data
}

function clearSearch() {
  search.value = ''
  searchResults.value = []
}

async function registerPatient(payload: Record<string, unknown>) {
  registering.value = true
  message.value = ''
  try {
    const { data } = await api.post<{ alreadyRegistered?: boolean }>('/visits/external-patient', payload)
    message.value = data.alreadyRegistered
      ? 'Patient déjà dans la liste des dossiers externes.'
      : 'Patient enregistré. Ajoutez les examens depuis la liste ci-dessous.'
    messageType.value = 'success'
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

async function confirmNewPatient() {
  if (!canConfirmNewPatient.value) return
  const { firstName, lastName } = parsedName.value
  const age = parsePatientAge(patientForm.value.age, patientForm.value.ageUnit)
  await registerPatient({
    firstName,
    lastName,
    age: age ?? undefined,
    ageUnit: patientForm.value.ageUnit,
    phone: patientForm.value.phone.trim() || undefined,
    gender: patientForm.value.gender,
  })
  closeNewPatientModal()
  resetPatientForm()
}

async function selectPatient(patient: PatientRow) {
  await registerPatient({ patientId: patient.id })
  clearSearch()
}

async function submitExams() {
  if (!canSubmitExams.value || !activeRow.value) return
  submitting.value = true
  message.value = ''
  try {
    const { data } = await api.post('/visits/external-lab-order', {
      patientId: activeRow.value.patientId,
      examsByKind: examsByKind.value,
      reductionFcfa: Number(reductionFcfa.value) || 0,
    })
    message.value = data.invoice
      ? `Paiement validé — ${data.invoice.invoiceNumber}. Patient envoyé au laboratoire.`
      : 'Examens enregistrés et patient envoyé au laboratoire.'
    messageType.value = 'success'
    closeExamsModal()
    resetExamsForm()
    await loadQueue()
  } catch (error: unknown) {
    const apiMessage =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
    message.value = apiMessage ?? 'Erreur lors de la validation.'
    messageType.value = 'error'
  } finally {
    submitting.value = false
  }
}

async function saveEdit() {
  if (!canSaveEdit.value || !editingPatientId.value) return
  savingEdit.value = true
  message.value = ''
  try {
    const { firstName, lastName } = editParsedName.value
    const age = editParsedAge.value
    await api.patch(`/patients/${editingPatientId.value}`, {
      firstName,
      lastName,
      age: age ?? undefined,
      ageUnit: editForm.value.ageUnit,
      phone: editForm.value.phone.trim() || undefined,
      gender: editForm.value.gender,
    })
    message.value = 'Informations patient mises à jour.'
    messageType.value = 'success'
    closeEditModal()
    await loadQueue()
  } catch (error: unknown) {
    const shown = await showDuplicateModalFromError(error)
    if (!shown) {
      const apiMessage =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined
      message.value = apiMessage ?? 'Erreur lors de la modification.'
      messageType.value = 'error'
    }
  } finally {
    savingEdit.value = false
  }
}

onMounted(loadQueue)
</script>

<template>
  <div>
    <UiPageHeader
      title="Patient externe"
      subtitle="Enregistrez le patient, puis ajoutez les examens depuis la liste"
      :icon="UserRound"
    />

    <UiAlert v-if="message" :type="messageType" :message="message" />

    <UiCard title="Rechercher un patient existant" :icon="UserRound" icon-variant="teal" class="patient-card">
      <div class="search-block">
        <div class="search-compact">
          <Search :size="16" class="search-compact__icon" />
          <input
            v-model="search"
            type="search"
            class="search-compact__input"
            placeholder="Rechercher par matricule, nom ou téléphone…"
            @keydown.enter.prevent="searchPatients"
          />
          <button
            v-if="search"
            type="button"
            class="search-compact__clear"
            aria-label="Effacer la recherche"
            @click="clearSearch"
          >
            <X :size="14" />
          </button>
        </div>
        <div class="search-actions">
          <span class="search-count">{{ searchLabel }}</span>
          <UiButton variant="ghost" size="sm" @click="searchPatients">
            Chercher
          </UiButton>
        </div>

        <ul v-if="searchResults.length" class="search-results">
          <li v-for="patient in searchResults" :key="patient.id">
            <button type="button" :disabled="registering" @click="selectPatient(patient)">
              <strong>{{ fullName(patient.firstName, patient.lastName) }}</strong>
              <span>{{ patient.code }}</span>
            </button>
          </li>
        </ul>
      </div>
    </UiCard>

    <UiCard title="Patients externes enregistrés" class="queue-card" :icon="UserRound" icon-variant="blue">
      <template #actions>
        <UiButton variant="primary" size="sm" @click="openNewPatientModal">
          Nouveau
        </UiButton>
        <UiButton variant="ghost" size="sm" :disabled="loadingQueue" @click="loadQueue">
          Actualiser
        </UiButton>
        <span class="list-count">{{ queue.length }} dossier(s)</span>
      </template>

      <p v-if="!loadingQueue && !queue.length" class="empty">Aucun patient externe enregistré pour le moment</p>
      <div v-else class="queue-table-wrap">
        <table class="queue-table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Examens</th>
              <th>Montant</th>
              <th>Statut</th>
              <th class="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in queue" :key="row.id">
              <td>
                <strong>{{ fullName(row.patient.firstName, row.patient.lastName) }}</strong>
                <span class="sub">{{ row.patient.code }}</span>
              </td>
              <td>{{ row.examsSummary }}</td>
              <td>{{ row.hasExams ? formatFcfa(row.netFcfa) : '—' }}</td>
              <td>
                <UiBadge :variant="queueStatusVariant(row)">
                  {{ queueStatusLabel(row) }}
                </UiBadge>
              </td>
              <td class="col-actions">
                <ReceptionQueueRowActions
                  :actions="externalRowActions(row)"
                  @action="onExternalRowAction($event, row)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCard>

    <UiFormModal
      v-if="showNewPatientModal"
      title-id="external-modal-title"
      title="Nouveau patient externe"
      subtitle="Patient payant directement à la clinique"
      :icon="UserPlus"
      @close="closeNewPatientModal"
    >
      <form
        id="external-new-patient-form"
        class="ui-form-modal__form reception-modal-form"
        @submit.prevent="confirmNewPatient"
      >
        <ReceptionPatientIdentityFields
          v-model:full-name="patientForm.fullName"
          v-model:age="patientForm.age"
          v-model:age-unit="patientForm.ageUnit"
          v-model:phone="patientForm.phone"
          v-model:gender="patientForm.gender"
        />
      </form>

      <template #footer>
        <UiButton type="button" variant="ghost" @click="closeNewPatientModal">Annuler</UiButton>
        <UiButton type="button" variant="ghost" :icon="RotateCcw" @click="resetPatientForm">Effacer</UiButton>
        <UiButton
          type="submit"
          form="external-new-patient-form"
          variant="primary"
          :icon="UserPlus"
          :disabled="!canConfirmNewPatient || registering"
        >
          {{ registering ? 'Enregistrement…' : 'Enregistrer' }}
        </UiButton>
      </template>
    </UiFormModal>

    <UiFormModal
      v-if="showEditModal"
      title-id="edit-modal-title"
      title="Modifier le patient"
      :icon="Pencil"
      @close="closeEditModal"
    >
      <form
        id="external-edit-patient-form"
        class="ui-form-modal__form reception-modal-form"
        @submit.prevent="saveEdit"
      >
        <ReceptionPatientIdentityFields
          v-model:full-name="editForm.fullName"
          v-model:age="editForm.age"
          v-model:age-unit="editForm.ageUnit"
          v-model:phone="editForm.phone"
          v-model:gender="editForm.gender"
        />
      </form>

      <template #footer>
        <UiButton type="button" variant="ghost" @click="closeEditModal">Annuler</UiButton>
        <UiButton
          type="submit"
          form="external-edit-patient-form"
          variant="primary"
          :icon="Pencil"
          :disabled="!canSaveEdit || savingEdit"
        >
          {{ savingEdit ? 'Enregistrement…' : 'Enregistrer' }}
        </UiButton>
      </template>
    </UiFormModal>

    <UiFormModal
      v-if="showExamsModal"
      title-id="exams-modal-title"
      title="Examens à réaliser"
      :subtitle="`${activePatientLabel} — Laboratoire, radiologie, échographie…`"
      :icon="FlaskConical"
      size="wide"
      @close="closeExamsModal"
    >
      <section class="form-panel">
        <h3 class="form-panel__title">
          <FlaskConical :size="14" />
          Prescription
        </h3>
        <MultiExamPrescriptionPicker v-model="examsByKind" />

        <div class="form-grid-2">
          <UiInput
            v-model="reductionFcfa"
            label="Réduction (FCFA)"
            type="number"
            min="0"
            :max="grossFcfa"
            placeholder="0"
            :icon="Percent"
          />
          <div class="total-preview">
            <span>Net à payer</span>
            <strong>{{ formatFcfa(netFcfa) }}</strong>
            <small>Sous-total {{ formatFcfa(grossFcfa) }}</small>
          </div>
        </div>
      </section>

      <template #footer>
        <UiButton type="button" variant="ghost" @click="closeExamsModal">Annuler</UiButton>
        <UiButton
          variant="success"
          :icon="CreditCard"
          :disabled="submitting || !canSubmitExams"
          @click="submitExams"
        >
          {{ submitting ? 'Validation…' : 'Valider' }}
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.patient-card {
  margin-bottom: 1rem;
}

.search-block {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.search-compact {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.65rem;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
}

.search-compact:focus-within {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--focus-ring-sm);
}

.search-compact__icon {
  color: var(--text-light);
  flex-shrink: 0;
}

.search-compact__input {
  flex: 1;
  border: 0;
  background: transparent;
  font-size: 0.875rem;
  outline: none;
  min-width: 0;
}

.search-compact__clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border: 0;
  border-radius: 999px;
  background: #f1f5f9;
  color: var(--text-muted);
  cursor: pointer;
}

.search-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.search-count {
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.search-results {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.search-results button {
  display: flex;
  justify-content: space-between;
  width: 100%;
  padding: 0.65rem 0.85rem;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.search-results button:hover:not(:disabled) {
  background: var(--primary-50);
}

.search-results button:disabled {
  opacity: 0.6;
  cursor: wait;
}

.search-results span {
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  margin-bottom: 0;
  background: var(--primary-50);
  border: 1px solid var(--primary-100);
  border-radius: var(--radius-sm);
}

.form-section__title {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--primary-800);
}

.form-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.total-preview {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 0.2rem;
  padding: 0.65rem 0.9rem;
  background: #fff;
  border: 1.5px solid var(--primary-200);
  border-radius: var(--radius-sm);
}

.total-preview span {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.total-preview strong {
  font-size: 1.125rem;
  color: var(--primary-800);
}

.total-preview small {
  font-size: 0.75rem;
  color: var(--text-muted);
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
  min-width: 9.5rem;
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
