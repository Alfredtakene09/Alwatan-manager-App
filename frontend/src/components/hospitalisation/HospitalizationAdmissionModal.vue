<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BedDouble, Printer, Save } from '@lucide/vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import ClinicLetterhead from '@/components/ClinicLetterhead.vue'
import { formatFcfa, fullName } from '@/lib/roles'
import {
  admissionFormFromHospitalization,
  computeHospitalizationBilling,
  defaultAdmissionForm,
  endDateFromStayDays,
  printHospitalizationAdmission,
  type HospitalizationAdmissionForm,
} from '@/lib/hospitalization-admission'
import { parsePrescribedHospitalisationDays } from '@/lib/lab-notes'

export type AdmissionRoomTypeOption = {
  type: 'VIP' | 'SIMPLE'
  label: string
  roomName: string
  dailyRateFcfa: number
  availableCount: number
  autoRoomId: string | null
  blockedReason?: 'VIP_OCCUPIED' | null
}

export type AdmissionHospContext = {
  id: string
  status: string
  roomType: string
  dailyRateFcfa: number
  reductionFcfa?: number
  startDate?: string | null
  endDate?: string | null
  service?: string | null
  attendingDoctor?: string | null
  doctorInstructions?: string | null
  visit: {
    patient: {
      code: string
      firstName: string
      lastName: string
    }
    consultation?: {
      doctor?: { firstName: string; lastName: string } | null
      doctorComment?: string | null
      diagnosis?: string | null
      clinicalNotes?: string | null
    } | null
    assignedDoctor?: { firstName: string; lastName: string } | null
  }
  room?: { id?: string; name: string; type?: string } | null
}

type RoomTypeChoice = '' | 'VIP' | 'SIMPLE'

const props = withDefaults(
  defineProps<{
    hosp: AdmissionHospContext | null
    roomTypes: AdmissionRoomTypeOption[]
    mode?: 'create' | 'edit' | 'view'
    submitting?: boolean
  }>(),
  { mode: 'create' },
)

const emit = defineEmits<{
  close: []
  confirm: [payload: HospitalizationAdmissionForm & { hospitalizationId: string; roomId?: string }]
}>()

const roomTypeChoice = ref<RoomTypeChoice>('')
const form = ref<HospitalizationAdmissionForm>(defaultAdmissionForm({
  patientFirstName: '',
  patientLastName: '',
}))

const isReadonly = computed(() => props.mode === 'view')
const isProgrammed = computed(() => props.mode === 'edit' || props.mode === 'view')
const isVipForm = computed(() => form.value.roomType === 'VIP')

const attendingDoctorLabel = computed(() => {
  if (!props.hosp) return '—'
  const doctor = props.hosp.visit.consultation?.doctor ?? props.hosp.visit.assignedDoctor
  if (doctor) return `Dr ${fullName(doctor.firstName, doctor.lastName)}`
  return form.value.attendingDoctor?.trim() || '—'
})

const serviceLabel = computed(() => 'Hospitalisation')

const selectedRoomType = computed(() =>
  props.roomTypes.find((room) => room.type === roomTypeChoice.value) ?? null,
)

const billing = computed(() =>
  computeHospitalizationBilling(
    form.value.startDate,
    form.value.stayDays,
    form.value.dailyRateFcfa,
    Number(form.value.reductionFcfa) || 0,
  ),
)

const datesValid = computed(() => form.value.stayDays >= 1 && Boolean(form.value.startDate))

const canSubmit = computed(() => {
  if (!props.hosp || !datesValid.value || isReadonly.value) return false
  if (props.mode === 'edit') return true
  return Boolean(roomTypeChoice.value && selectedRoomType.value?.autoRoomId)
})

const modalSubtitle = computed(() => {
  if (props.mode === 'view') return 'Consultation du profil d\'admission'
  if (props.mode === 'edit') return 'Modification du séjour programmé'
  return 'Formulaire d\'admission hospitalière'
})

function syncStayEndDate() {
  if (!form.value.startDate || form.value.stayDays < 1) return
  form.value.endDate = endDateFromStayDays(form.value.startDate, form.value.stayDays)
}

function syncFormFromContext() {
  if (!props.hosp) return
  if (isProgrammed.value) {
    form.value = admissionFormFromHospitalization(props.hosp)
    roomTypeChoice.value = (props.hosp.roomType as RoomTypeChoice) || ''
  } else {
    roomTypeChoice.value = ''
    const prescribedDays = parsePrescribedHospitalisationDays(props.hosp.visit.consultation?.clinicalNotes)
    const baseForm = admissionFormFromHospitalization(props.hosp)
    form.value = defaultAdmissionForm({
      patientFirstName: props.hosp.visit.patient.firstName,
      patientLastName: props.hosp.visit.patient.lastName,
      patientCode: props.hosp.visit.patient.code,
      attendingDoctor: baseForm.attendingDoctor,
      doctorInstructions: baseForm.doctorInstructions,
      roomType: props.hosp.roomType,
      dailyRateFcfa: props.hosp.dailyRateFcfa,
      prescribedStayDays: prescribedDays,
      stayDays: prescribedDays ?? 1,
    })
  }
  form.value.service = serviceLabel.value
  form.value.attendingDoctor = attendingDoctorLabel.value
}

watch(
  () => [props.hosp, props.mode] as const,
  () => syncFormFromContext(),
  { immediate: true },
)

watch(roomTypeChoice, () => {
  if (isProgrammed.value) return
  const room = selectedRoomType.value
  form.value.roomType = roomTypeChoice.value
  form.value.roomName = room?.roomName ?? ''
  if (room?.dailyRateFcfa) {
    form.value.dailyRateFcfa = room.dailyRateFcfa
  }
})

watch(
  () => [form.value.startDate, form.value.stayDays] as const,
  () => {
    if (isReadonly.value) return
    syncStayEndDate()
  },
)

function onStayDaysInput(value: string | number) {
  const parsed = Number.parseInt(String(value), 10)
  form.value.stayDays = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
  syncStayEndDate()
}

function onPrint() {
  syncStayEndDate()
  printHospitalizationAdmission(form.value, { autoPrint: true })
}

function onSubmit() {
  if (!props.hosp || !canSubmit.value) return
  syncStayEndDate()
  const payload = {
    ...form.value,
    reductionFcfa: billing.value.reductionFcfa,
    hospitalizationId: props.hosp.id,
  }
  if (props.mode === 'create') {
    const roomId = selectedRoomType.value?.autoRoomId
    if (!roomId) return
    emit('confirm', { ...payload, roomId })
    return
  }
  emit('confirm', payload)
}
</script>

<template>
  <UiFormModal
    v-if="hosp"
    size="large"
    title="Profil d'entrée en paroisse"
    :subtitle="modalSubtitle"
    :icon="BedDouble"
    @close="emit('close')"
  >
    <div class="hosp-adm-form" :class="{ 'hosp-adm-form--vip': isVipForm }">
      <ClinicLetterhead doc-title="Profil d'entrée en paroisse" />

      <div class="hosp-adm-form__doc-title">
        <h2>Profil d'entrée en paroisse</h2>
        <p dir="rtl">{{ isVipForm ? 'ملف دخول عنبر VIP' : 'ملف دخول عنبر' }}</p>
        <div v-if="isVipForm" class="hosp-adm-form__vip-banner" aria-hidden="true">VIP</div>
      </div>

      <section class="hosp-adm-form__section hosp-adm-form__section--patient">
        <h3>Patient</h3>
        <div class="hosp-adm-form__patient-card">
          <div class="hosp-adm-form__patient-name">{{ form.patientName }}</div>
          <div class="hosp-adm-form__patient-meta">
            <span>Matricule : <strong>{{ form.patientCode }}</strong></span>
          </div>
        </div>
      </section>

      <section class="hosp-adm-form__section hosp-adm-form__section--highlight">
        <h3>Chambre</h3>
        <template v-if="isProgrammed">
          <div class="hosp-adm-form__room-summary">
            <UiBadge :variant="form.roomType === 'VIP' ? 'primary' : 'info'">
              {{ form.roomType === 'VIP' ? 'VIP' : 'Simple' }}
            </UiBadge>
            <span v-if="form.roomName">{{ form.roomName }}</span>
            <strong>{{ formatFcfa(form.dailyRateFcfa) }}/nuit</strong>
          </div>
        </template>
        <template v-else>
          <UiSelect v-model="roomTypeChoice" label="Type de chambre" required>
            <option value="">Sélectionner VIP ou Simple</option>
            <option
              v-for="room in roomTypes"
              :key="room.type"
              :value="room.type"
              :disabled="!room.availableCount"
            >
              {{ room.label }}
              {{
                room.availableCount
                  ? `— ${formatFcfa(room.dailyRateFcfa)}/nuit`
                  : '— indisponible'
              }}
            </option>
          </UiSelect>
          <p v-if="roomTypeChoice && selectedRoomType && !selectedRoomType.availableCount" class="hosp-adm-form__hint hosp-adm-form__hint--warn">
            <template v-if="selectedRoomType.blockedReason === 'VIP_OCCUPIED'">
              La chambre VIP est déjà occupée par un patient hospitalisé. Choisissez une chambre simple ou attendez la sortie.
            </template>
            <template v-else>
              Aucune place libre en chambre {{ selectedRoomType.label }} pour le moment.
            </template>
          </p>
          <div v-else-if="selectedRoomType" class="hosp-adm-form__room-summary">
            <UiBadge :variant="selectedRoomType.type === 'VIP' ? 'primary' : 'info'">
              {{ selectedRoomType.label }}
            </UiBadge>
            <span>{{ selectedRoomType.roomName }}</span>
            <strong>{{ formatFcfa(selectedRoomType.dailyRateFcfa) }}/nuit</strong>
          </div>
        </template>
      </section>

      <section class="hosp-adm-form__section">
        <h3>Dates du séjour</h3>
        <div class="hosp-adm-form__grid">
          <UiInput v-model="form.startDate" label="Date d'entrée" type="date" :readonly="isReadonly" required />
          <UiInput
            :model-value="form.stayDays"
            label="Nombre de jours"
            type="number"
            min="1"
            max="365"
            :readonly="isReadonly"
            required
            @update:model-value="onStayDaysInput"
          />
        </div>
        <p v-if="form.startDate && form.stayDays >= 1" class="hosp-adm-form__hint">
          Durée du séjour : {{ form.stayDays }} jour(s)
        </p>
      </section>

      <section class="hosp-adm-form__section">
        <h3>Service et médecin traitant</h3>
        <div class="hosp-adm-form__readonly-grid">
          <div class="hosp-adm-form__readonly-item">
            <span class="hosp-adm-form__readonly-label">Service</span>
            <strong class="hosp-adm-form__readonly-value">{{ serviceLabel }}</strong>
          </div>
          <div class="hosp-adm-form__readonly-item">
            <span class="hosp-adm-form__readonly-label">Médecin traitant</span>
            <strong class="hosp-adm-form__readonly-value">{{ attendingDoctorLabel }}</strong>
          </div>
        </div>
        <p class="hosp-adm-form__hint">
          Informations issues du dossier patient — non modifiables à l'admission.
        </p>
      </section>

      <section class="hosp-adm-form__section">
        <h3>Réduction</h3>
        <UiInput
          v-model="form.reductionFcfa"
          label="Réduction (FCFA)"
          type="number"
          min="0"
          :max="billing.grossFcfa"
          :readonly="isReadonly"
        />
      </section>

      <section class="hosp-adm-form__section hosp-adm-form__section--instructions">
        <h3>Instructions du médecin traitant</h3>
        <label class="hosp-adm-form__textarea-label" for="doctor-instructions">
          Diagnostic, consignes et observations
        </label>
        <textarea
          id="doctor-instructions"
          v-model="form.doctorInstructions"
          class="hosp-adm-form__textarea"
          rows="10"
          :readonly="isReadonly"
          placeholder="Instructions médicales pour le séjour hospitalier…"
        />
      </section>

      <section v-if="datesValid && form.dailyRateFcfa > 0" class="hosp-adm-form__total-bar">
        <div class="hosp-adm-form__total-details">
          <span>{{ billing.nights }} nuitée(s) × {{ formatFcfa(form.dailyRateFcfa) }}</span>
          <span v-if="billing.reductionFcfa > 0">Réduction : − {{ formatFcfa(billing.reductionFcfa) }}</span>
        </div>
        <div class="hosp-adm-form__total-amount">
          <span>Montant total</span>
          <strong>{{ formatFcfa(billing.netFcfa) }}</strong>
        </div>
      </section>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">{{ isReadonly ? 'Fermer' : 'Annuler' }}</UiButton>
      <UiButton
        variant="secondary"
        :icon="Printer"
        :disabled="!datesValid"
        @click="onPrint"
      >
        {{ billing.netFcfa > 0 ? 'Imprimer (3 pages)' : 'Imprimer (2 pages)' }}
      </UiButton>
      <UiButton
        v-if="!isReadonly"
        variant="primary"
        :icon="Save"
        :disabled="!canSubmit || submitting"
        @click="onSubmit"
      >
        {{ submitting ? 'Enregistrement…' : mode === 'edit' ? 'Enregistrer' : 'Valider et imprimer' }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.hosp-adm-form {
  position: relative;
}

.hosp-adm-form--vip .hosp-adm-form__doc-title {
  border-color: #b91c1c;
  background: linear-gradient(180deg, #fff8f8 0%, #ffffff 100%);
}

.hosp-adm-form__doc-title {
  text-align: center;
  margin: 0 0 1.25rem;
  padding: 1rem 1.1rem;
  border: 2px solid var(--primary-200);
  border-radius: var(--radius-sm);
  background: linear-gradient(180deg, var(--primary-50) 0%, #ffffff 100%);
}

.hosp-adm-form__doc-title h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #991b1b;
}

.hosp-adm-form__doc-title p {
  margin: 0.35rem 0 0;
  font-size: 0.875rem;
  font-weight: 700;
  color: #b91c1c;
}

.hosp-adm-form__vip-banner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 0.65rem;
  padding: 0.3rem 1rem;
  border: 2px solid #b91c1c;
  border-radius: 6px;
  color: #b91c1c;
  font-weight: 800;
  font-size: 0.875rem;
  letter-spacing: 0.14em;
  background: #fff;
}

.hosp-adm-form__section {
  margin-bottom: 1.25rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border);
}

.hosp-adm-form__section--patient {
  padding: 0;
  border-bottom: none;
}

.hosp-adm-form__section--highlight {
  padding: 1rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: linear-gradient(180deg, #fafcf7 0%, #ffffff 100%);
}

.hosp-adm-form__section--instructions {
  padding: 1rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: #fafcfd;
}

.hosp-adm-form__section--instructions h3 {
  text-align: center;
  margin-bottom: 0.5rem;
}

.hosp-adm-form__section--instructions .hosp-adm-form__textarea {
  min-height: 240px;
}

.hosp-adm-form__section h3 {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #b91c1c;
}

.hosp-adm-form__patient-card {
  padding: 1rem 1.1rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: linear-gradient(135deg, #f8faf5 0%, #ffffff 100%);
}

.hosp-adm-form__patient-name {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text);
}

.hosp-adm-form__patient-meta {
  margin-top: 0.35rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.hosp-adm-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.hosp-adm-form__readonly-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.hosp-adm-form__readonly-item {
  padding: 0.75rem 0.85rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: #f8fafc;
}

.hosp-adm-form__readonly-label {
  display: block;
  margin-bottom: 0.25rem;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.hosp-adm-form__readonly-value {
  display: block;
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--text);
  line-height: 1.35;
}

.hosp-adm-form__hint {
  margin: 0.65rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.hosp-adm-form__hint--warn {
  color: #b45309;
  font-weight: 600;
}

.hosp-adm-form__room-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  margin-top: 0.85rem;
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-sm);
  background: #f8fafc;
  border: 1px solid var(--border);
  font-size: 0.8125rem;
}

.hosp-adm-form__room-summary strong {
  margin-left: auto;
  color: var(--text);
}

.hosp-adm-form__total-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 0.25rem;
  padding: 1rem 1.1rem;
  border-radius: var(--radius-sm);
  background: linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%);
  border: 2px solid #86efac;
}

.hosp-adm-form__total-details {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.8125rem;
  color: #166534;
}

.hosp-adm-form__total-amount {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.15rem;
  text-align: right;
}

.hosp-adm-form__total-amount span {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #15803d;
}

.hosp-adm-form__total-amount strong {
  font-size: 1.35rem;
  font-weight: 800;
  color: #14532d;
  line-height: 1.1;
}

.hosp-adm-form__textarea-label {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
}

.hosp-adm-form__textarea {
  width: 100%;
  min-height: 120px;
  padding: 0.75rem;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 0.875rem;
  line-height: 1.55;
  resize: vertical;
  background:
    repeating-linear-gradient(
      transparent,
      transparent 27px,
      #e2e8f0 27px,
      #e2e8f0 28px
    );
  background-color: #fafcfd;
}

.hosp-adm-form__textarea:focus {
  outline: none;
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px rgba(107, 124, 62, 0.15);
}

@media (max-width: 768px) {
  .hosp-adm-form__grid,
  .hosp-adm-form__readonly-grid {
    grid-template-columns: 1fr;
  }

  .hosp-adm-form__room-summary strong {
    margin-left: 0;
    width: 100%;
  }

  .hosp-adm-form__total-bar {
    flex-direction: column;
    align-items: stretch;
  }

  .hosp-adm-form__total-amount {
    align-items: flex-start;
    text-align: left;
  }
}
</style>
