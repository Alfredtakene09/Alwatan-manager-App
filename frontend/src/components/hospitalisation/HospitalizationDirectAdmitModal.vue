<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BedDouble } from '@lucide/vue'
import api from '@/api/client'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import ReceptionPatientIdentityFields from '@/components/reception/ReceptionPatientIdentityFields.vue'
import {
  type AdmissionRoomTypeOption,
} from '@/components/hospitalisation/HospitalizationAdmissionModal.vue'
import { useAppI18n } from '@/i18n/useAppI18n'
import { parsePatientAge, type PatientAgeUnit } from '@/lib/patient-age'
import { splitPatientFullName } from '@/lib/patient-name'
import {
  computeHospitalizationBilling,
  defaultAdmissionForm,
  endDateFromStayDays,
  type HospitalizationAdmissionForm,
} from '@/lib/hospitalization-admission'
import { formatFcfa, fullName } from '@/lib/roles'
import { sortDoctorsForReception } from '@/lib/doctor-compensation'

type DoctorOption = { id: string; firstName: string; lastName: string }

type RoomTypeChoice = '' | 'VIP' | 'SIMPLE'
type PaymentChoice = 'paid' | 'pending'

const props = defineProps<{
  open: boolean
  roomTypes: AdmissionRoomTypeOption[]
  submitting?: boolean
  initialPayment?: PaymentChoice
}>()

const emit = defineEmits<{
  close: []
  confirmed: [
    payload: {
      printForm: HospitalizationAdmissionForm
      nights: number
      totalDueFcfa: number
    },
  ]
}>()

const { uiText, localeCode } = useAppI18n()

const localError = ref('')
const localSubmitting = ref(false)

const newForm = ref({
  fullName: '',
  age: '',
  ageUnit: 'YEARS' as PatientAgeUnit,
  phone: '',
  gender: 'F',
})

const roomTypeChoice = ref<RoomTypeChoice>('')
const roomChoice = ref('')
const bedChoice = ref('')
const startDate = ref(new Date().toISOString().slice(0, 10))
const stayDays = ref(1)
const reductionFcfa = ref(0)
const paymentChoice = ref<PaymentChoice>('paid')
const attendingDoctorId = ref('')
const doctors = ref<DoctorOption[]>([])

const doctorsSorted = computed(() => sortDoctorsForReception(doctors.value))

const selectedDoctor = computed(
  () => doctors.value.find((doctor) => doctor.id === attendingDoctorId.value) ?? null,
)

const attendingDoctorLabel = computed(() =>
  selectedDoctor.value
    ? `Dr ${fullName(selectedDoctor.value.firstName, selectedDoctor.value.lastName)}`
    : '',
)

const parsedName = computed(() => splitPatientFullName(newForm.value.fullName))
const parsedAge = computed(() => parsePatientAge(newForm.value.age, newForm.value.ageUnit))

const selectedRoomType = computed(
  () => props.roomTypes.find((room) => room.type === roomTypeChoice.value) ?? null,
)
const availableRooms = computed(() => selectedRoomType.value?.availableRooms ?? [])
const selectedRoom = computed(
  () => availableRooms.value.find((room) => room.id === roomChoice.value) ?? null,
)
const availableBeds = computed(() => {
  if (selectedRoom.value) return selectedRoom.value.availableBeds
  return selectedRoomType.value?.availableBeds ?? []
})

const billing = computed(() =>
  computeHospitalizationBilling(
    startDate.value,
    stayDays.value,
    selectedRoom.value?.dailyRateFcfa ?? selectedRoomType.value?.dailyRateFcfa ?? 0,
    Number(reductionFcfa.value) || 0,
  ),
)

const endDate = computed(() =>
  startDate.value && stayDays.value >= 1
    ? endDateFromStayDays(startDate.value, stayDays.value)
    : '',
)

const patientReady = computed(() => {
  const { firstName, lastName } = parsedName.value
  return firstName.length >= 2 && lastName.length >= 2 && parsedAge.value !== null
})

const roomReady = computed(() => {
  if (!roomTypeChoice.value || !selectedRoomType.value?.autoRoomId) return false
  if (availableRooms.value.length > 0 && !roomChoice.value) return false
  if (availableBeds.value.length > 0 && !bedChoice.value) return false
  if (!startDate.value || stayDays.value < 1) return false
  return true
})

const canSubmit = computed(() => {
  if (props.submitting || localSubmitting.value) return false
  return patientReady.value && roomReady.value && Boolean(attendingDoctorId.value)
})

const labels = computed(() => {
  void localeCode.value
  return {
    title: uiText('Nouvelle hospitalisation'),
    subtitle: uiText('Patient externe, salle et paiement'),
    patientSection: uiText('Patient externe'),
    roomSection: uiText('Salle et séjour'),
    doctorSection: uiText('Médecin hospitalier'),
    paymentSection: uiText('Paiement'),
    paid: uiText('Payé'),
    pending: uiText('En attente de paiement'),
    cancel: uiText('Annuler'),
    confirm: uiText('Valider et imprimer'),
    creating: uiText('Enregistrement…'),
  }
})

function resetState() {
  localError.value = ''
  localSubmitting.value = false
  newForm.value = {
    fullName: '',
    age: '',
    ageUnit: 'YEARS',
    phone: '',
    gender: 'F',
  }
  roomTypeChoice.value = ''
  roomChoice.value = ''
  bedChoice.value = ''
  startDate.value = new Date().toISOString().slice(0, 10)
  stayDays.value = 1
  reductionFcfa.value = 0
  paymentChoice.value = props.initialPayment === 'pending' ? 'pending' : 'paid'
  attendingDoctorId.value = ''
  void loadDoctors()
}

async function loadDoctors() {
  try {
    const { data } = await api.get<DoctorOption[]>('/visits/doctors')
    doctors.value = Array.isArray(data) ? data : []
  } catch {
    doctors.value = []
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) resetState()
  },
)

watch(
  () => props.initialPayment,
  (value) => {
    if (props.open) paymentChoice.value = value === 'pending' ? 'pending' : 'paid'
  },
)

watch(roomTypeChoice, () => {
  const firstRoom = availableRooms.value[0]
  roomChoice.value = firstRoom?.id ?? selectedRoomType.value?.autoRoomId ?? ''
  bedChoice.value = firstRoom?.autoBedId ?? availableBeds.value[0]?.id ?? ''
})

watch(roomChoice, () => {
  bedChoice.value = selectedRoom.value?.autoBedId ?? availableBeds.value[0]?.id ?? ''
})

function onStayDaysInput(value: string | number) {
  const parsed = Number.parseInt(String(value), 10)
  stayDays.value = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
}

function buildPrintForm(patient: {
  code: string
  firstName: string
  lastName: string
}): HospitalizationAdmissionForm {
  const room = selectedRoomType.value
  const selectedBed = availableBeds.value.find((b) => b.id === bedChoice.value)
  return defaultAdmissionForm({
    patientFirstName: patient.firstName,
    patientLastName: patient.lastName,
    patientCode: patient.code,
    service: 'Hospitalisation',
    bedId: bedChoice.value || '',
    roomType: roomTypeChoice.value,
    roomName: selectedBed?.roomName ?? selectedRoom.value?.name ?? room?.roomName ?? '',
    dailyRateFcfa: selectedBed?.dailyRateFcfa ?? selectedRoom.value?.dailyRateFcfa ?? room?.dailyRateFcfa ?? 0,
    startDate: startDate.value,
    stayDays: stayDays.value,
    reductionFcfa: Number(reductionFcfa.value) || 0,
    attendingDoctor: attendingDoctorLabel.value,
    attendingDoctorId: attendingDoctorId.value,
    paymentPaid: paymentChoice.value === 'paid',
  })
}

async function submit() {
  if (!canSubmit.value || localSubmitting.value) return
  const room = selectedRoomType.value
  if (!room?.autoRoomId) return

  const selectedBed = availableBeds.value.find((b) => b.id === bedChoice.value)
  const roomId = selectedBed?.roomId ?? selectedRoom.value?.id ?? room.autoRoomId
  if (!roomId) return

  localSubmitting.value = true
  localError.value = ''
  try {
    const { data } = await api.post<{
      hospitalization: {
        visit: { patient: { code: string; firstName: string; lastName: string } }
      }
      nights: number
      totalDueFcfa: number
    }>('/hospitalisation/actions', {
      action: 'admit_direct',
      firstName: parsedName.value.firstName,
      lastName: parsedName.value.lastName,
      age: parsedAge.value ?? undefined,
      ageUnit: newForm.value.ageUnit,
      phone: newForm.value.phone.trim() || undefined,
      gender: newForm.value.gender,
      roomId,
      bedId: bedChoice.value || undefined,
      startDate: startDate.value,
      endDate: endDate.value,
      reductionFcfa: Number(reductionFcfa.value) || 0,
      service: 'Hospitalisation',
      attendingDoctorId: attendingDoctorId.value || undefined,
      attendingDoctor: attendingDoctorLabel.value || undefined,
      paidNow: paymentChoice.value === 'paid',
    })

    const printForm = buildPrintForm(data.hospitalization.visit.patient)
    emit('confirmed', {
      printForm,
      nights: data.nights,
      totalDueFcfa: data.totalDueFcfa,
    })
  } catch (error: unknown) {
    const apiMessage =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
    localError.value = apiMessage ?? uiText("Erreur lors de l'enregistrement.")
  } finally {
    localSubmitting.value = false
  }
}
</script>

<template>
  <UiFormModal
    :open="open"
    :title="labels.title"
    :subtitle="labels.subtitle"
    :icon="BedDouble"
    size="large"
    @close="emit('close')"
  >
    <div class="unified-admit">
      <p v-if="localError" class="unified-admit__error">{{ localError }}</p>

      <section class="unified-admit__patient">
        <h3>{{ labels.patientSection }}</h3>
        <ReceptionPatientIdentityFields
          v-model:full-name="newForm.fullName"
          v-model:age="newForm.age"
          v-model:age-unit="newForm.ageUnit"
          v-model:phone="newForm.phone"
          v-model:gender="newForm.gender"
        />
      </section>

      <section class="unified-admit__room">
        <h3>{{ labels.roomSection }}</h3>

        <UiSelect v-model="roomTypeChoice" :label="uiText('Type de chambre')" required>
          <option value="">{{ uiText('Sélectionner VIP ou Simple') }}</option>
          <option
            v-for="room in roomTypes"
            :key="room.type"
            :value="room.type"
            :disabled="!(room.availableRooms?.length || room.availableCount)"
          >
            {{ room.label }}
            {{
              room.availableCount
                ? `— ${formatFcfa(room.dailyRateFcfa)}/${uiText('nuit')}`
                : `— ${uiText('indisponible')}`
            }}
          </option>
        </UiSelect>

        <div v-if="selectedRoom" class="unified-admit__room-summary">
          <UiBadge :variant="selectedRoomType?.type === 'VIP' ? 'primary' : 'info'">
            {{ selectedRoomType?.label }}
          </UiBadge>
          <span>{{ selectedRoom.name }}</span>
          <strong>{{ formatFcfa(selectedRoom.dailyRateFcfa) }}/{{ uiText('nuit') }}</strong>
        </div>

        <UiSelect
          v-if="roomTypeChoice && availableRooms.length"
          v-model="roomChoice"
          :label="uiText('Salle')"
          required
        >
          <option value="" disabled>{{ uiText('Sélectionner une salle') }}</option>
          <option v-for="room in availableRooms" :key="room.id" :value="room.id">
            {{ room.name }} — {{ formatFcfa(room.dailyRateFcfa) }}/{{ uiText('nuit') }}
          </option>
        </UiSelect>

        <UiSelect
          v-if="roomChoice && availableBeds.length"
          v-model="bedChoice"
          :label="uiText('Lit')"
          required
        >
          <option value="" disabled>{{ uiText('Sélectionner un lit') }}</option>
          <option v-for="bed in availableBeds" :key="bed.id" :value="bed.id">
            {{ bed.label || bed.code }}
          </option>
        </UiSelect>

        <div class="unified-admit__dates">
          <UiInput
            v-model="startDate"
            :label="uiText('Date d\'entrée')"
            type="date"
            required
          />
          <UiInput
            :model-value="stayDays"
            :label="uiText('Nombre de jours')"
            type="number"
            min="1"
            max="365"
            required
            @update:model-value="onStayDaysInput"
          />
          <UiInput
            :model-value="reductionFcfa"
            :label="uiText('Réduction (FCFA)')"
            type="number"
            min="0"
            @update:model-value="reductionFcfa = Number($event) || 0"
          />
        </div>

        <div v-if="roomReady" class="unified-admit__total">
          <span>{{ billing.nights }} {{ uiText('nuitée(s)') }}</span>
          <strong>{{ formatFcfa(billing.netFcfa) }}</strong>
        </div>
      </section>

      <section class="unified-admit__doctor">
        <h3>{{ labels.doctorSection }}</h3>
        <UiSelect v-model="attendingDoctorId" :label="labels.doctorSection" required>
          <option value="">{{ uiText('Sélectionner un médecin') }}</option>
          <option v-for="doctor in doctorsSorted" :key="doctor.id" :value="doctor.id">
            Dr {{ fullName(doctor.firstName, doctor.lastName) }}
          </option>
        </UiSelect>
      </section>

      <section class="unified-admit__payment">
        <h3>{{ labels.paymentSection }}</h3>
        <div class="unified-admit__pay-options" role="radiogroup" :aria-label="labels.paymentSection">
          <button
            type="button"
            role="radio"
            :aria-checked="paymentChoice === 'paid'"
            :class="{ active: paymentChoice === 'paid' }"
            @click="paymentChoice = 'paid'"
          >
            {{ labels.paid }}
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="paymentChoice === 'pending'"
            :class="{ active: paymentChoice === 'pending' }"
            @click="paymentChoice = 'pending'"
          >
            {{ labels.pending }}
          </button>
        </div>
      </section>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">{{ labels.cancel }}</UiButton>
      <UiButton :disabled="!canSubmit" @click="submit">
        {{ localSubmitting || submitting ? labels.creating : labels.confirm }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.unified-admit {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.unified-admit__patient,
.unified-admit__room,
.unified-admit__doctor,
.unified-admit__payment {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.unified-admit__room,
.unified-admit__doctor,
.unified-admit__payment {
  padding-top: 0.5rem;
  border-top: 1px solid var(--border);
}

.unified-admit__patient h3,
.unified-admit__room h3,
.unified-admit__doctor h3,
.unified-admit__payment h3 {
  margin: 0;
  font-size: 0.95rem;
}

.unified-admit__room-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.unified-admit__dates {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.unified-admit__total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0.9rem;
  border-radius: var(--radius-sm);
  background: var(--primary-50);
  border: 1px solid var(--primary-200);
  font-weight: 700;
}

.unified-admit__pay-options {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.unified-admit__pay-options button {
  display: inline-flex;
  align-items: center;
  padding: 0.55rem 0.9rem;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  cursor: pointer;
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-muted);
}

.unified-admit__pay-options button.active {
  background: var(--primary-50);
  border-color: var(--primary-500);
  color: var(--primary-800);
}

.unified-admit__error {
  margin: 0;
  font-size: 0.875rem;
  color: var(--danger, #dc2626);
}

@media (max-width: 720px) {
  .unified-admit__dates {
    grid-template-columns: 1fr;
  }
}
</style>
