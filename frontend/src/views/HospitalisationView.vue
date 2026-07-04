<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { BedDouble, Plus, RefreshCw, Save, ShieldCheck } from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { formatFcfa, fullName, canManageResources } from '@/lib/roles'
import { printHospitalizationAdmission, type HospitalizationAdmissionForm } from '@/lib/hospitalization-admission'
import HospitalizationAdmissionModal, {
  type AdmissionRoomTypeOption,
} from '@/components/hospitalisation/HospitalizationAdmissionModal.vue'
import HospitalizationDischargeModal from '@/components/hospitalisation/HospitalizationDischargeModal.vue'
import HospitalizationsQueueDataTable from '@/components/ui/HospitalizationsQueueDataTable.vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import '@/assets/comptabilite-section.css'

type HospRow = {
  id: string
  status: string
  roomType: string
  reductionFcfa?: number
  totalDueFcfa?: number
  nightsCount?: number
  endDate?: string | null
  dailyRateFcfa?: number
  startDate?: string | null
  service?: string | null
  attendingDoctor?: string | null
  doctorInstructions?: string | null
  visit: {
    id: string
    patient: { code: string; firstName: string; lastName: string; phone?: string | null }
    consultation?: {
      doctor?: { firstName: string; lastName: string } | null
      doctorComment?: string | null
      diagnosis?: string | null
    } | null
    assignedDoctor?: { firstName: string; lastName: string } | null
  }
  room?: { id?: string; name: string; type: string } | null
}

const route = useRoute()

const data = ref<{
  rooms: Array<{
    id: string
    name: string
    type: string
    dailyRateFcfa: number
    description?: string | null
    active: boolean
    status: 'LIBRE' | 'OCCUPE'
    currentPatient?: { firstName: string; lastName: string } | null
  }>
  hospitalizations: HospRow[]
  roomAvailability?: {
    VIP: Omit<AdmissionRoomTypeOption, 'label'>
    SIMPLE: Omit<AdmissionRoomTypeOption, 'label'>
  }
  stats: {
    roomCount: number
    freeRooms: number
    occupiedRooms: number
    pendingHospitalizations: number
  }
} | null>(null)

const auth = useAuthStore()
const canManage = computed(() => (auth.user ? canManageResources(auth.user.role) : false))

const loading = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const tab = ref<'plan' | 'rooms' | 'queue' | 'hospitalized'>('queue')
const admissionHospId = ref<string | null>(null)
const admissionMode = ref<'create' | 'edit' | 'view'>('create')
const admissionSubmitting = ref(false)
const dischargeHospId = ref<string | null>(null)
const dischargeSubmitting = ref(false)

const focusedVisitId = computed(() =>
  typeof route.query.visitId === 'string' ? route.query.visitId : null,
)

function isHospitalizedPatient(h: HospRow) {
  return (
    h.status === 'DISCHARGED' ||
    h.status === 'ACTIVE' ||
    (Boolean(h.room) && Boolean(h.startDate))
  )
}

function isPendingAdmission(h: HospRow) {
  if (h.status === 'DISCHARGED' || h.status === 'CANCELLED') return false
  return !isHospitalizedPatient(h)
}

function applyRouteQuery() {
  const qTab = route.query.tab
  if (qTab === 'queue' || qTab === 'plan' || qTab === 'hospitalized' || qTab === 'hospitaliser') {
    tab.value = qTab === 'hospitaliser' ? 'hospitalized' : (qTab as typeof tab.value)
  } else if (qTab === 'rooms' && canManage.value) {
    tab.value = 'rooms'
  }

  const visitId = typeof route.query.visitId === 'string' ? route.query.visitId : null
  if (!visitId || !data.value) return
  const hosp = data.value.hospitalizations.find((row) => row.visit.id === visitId)
  if (hosp && isHospitalizedPatient(hosp)) {
    tab.value = 'hospitalized'
  }
}

async function scrollToFocusedVisit() {
  if (!focusedVisitId.value) return
  await nextTick()
  document
    .querySelector(`[data-visit-id="${focusedVisitId.value}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

const newRoom = ref({
  name: '',
  type: 'SIMPLE',
  description: '',
  dailyRateFcfa: '25000',
})

const admissionRoomTypeOptions = computed((): AdmissionRoomTypeOption[] => {
  const availability = data.value?.roomAvailability
  return (['VIP', 'SIMPLE'] as const).map((type) => {
    const fromApi = availability?.[type]
    if (fromApi) {
      return {
        type,
        label: type === 'VIP' ? 'VIP' : 'Simple',
        roomName: fromApi.roomName,
        dailyRateFcfa: fromApi.dailyRateFcfa,
        availableCount: fromApi.availableCount,
        autoRoomId: fromApi.autoRoomId,
        blockedReason: fromApi.blockedReason,
      }
    }

    const roomsOfType = (data.value?.rooms ?? []).filter(
      (room) => room.active && room.status === 'LIBRE' && room.type === type,
    )
    const firstRoom = roomsOfType[0]
    return {
      type,
      label: type === 'VIP' ? 'VIP' : 'Simple',
      roomName: firstRoom?.name ?? (type === 'VIP' ? 'Salle VIP' : 'Salle simple'),
      dailyRateFcfa: firstRoom?.dailyRateFcfa ?? 0,
      availableCount: roomsOfType.length,
      autoRoomId: firstRoom?.id ?? null,
      blockedReason: null,
    }
  })
})

const pendingHospitalizations = computed(() =>
  (data.value?.hospitalizations ?? []).filter((h) => isPendingAdmission(h)),
)

const hospitalizedPatients = computed(() =>
  (data.value?.hospitalizations ?? []).filter((h) => isHospitalizedPatient(h)),
)

const admissionHosp = computed(() =>
  admissionHospId.value
    ? (data.value?.hospitalizations.find((h) => h.id === admissionHospId.value) ?? null)
    : null,
)

const dischargeHosp = computed(() =>
  dischargeHospId.value
    ? (data.value?.hospitalizations.find((h) => h.id === dischargeHospId.value) ?? null)
    : null,
)

function openAdmission(hospId: string) {
  admissionMode.value = 'create'
  admissionHospId.value = hospId
}

function openView(hospId: string) {
  admissionMode.value = 'view'
  admissionHospId.value = hospId
}

function openEdit(hospId: string) {
  admissionMode.value = 'edit'
  admissionHospId.value = hospId
}

function closeAdmission() {
  admissionHospId.value = null
  admissionMode.value = 'create'
  admissionSubmitting.value = false
}

function openDischarge(hospId: string) {
  dischargeHospId.value = hospId
}

function closeDischarge() {
  dischargeHospId.value = null
  dischargeSubmitting.value = false
}

async function load() {
  loading.value = true
  try {
    const visitId = focusedVisitId.value
    const { data: res } = await api.get('/hospitalisation', {
      params: visitId ? { visitId } : undefined,
    })
    data.value = res
    applyRouteQuery()
    await scrollToFocusedVisit()
  } finally {
    loading.value = false
  }
}

async function addRoom() {
  try {
    await api.post('/hospitalisation/rooms', {
      name: newRoom.value.name.trim(),
      type: newRoom.value.type,
      description: newRoom.value.description.trim() || undefined,
      dailyRateFcfa: Number(newRoom.value.dailyRateFcfa),
    })
    message.value = 'Salle créée avec succès.'
    messageType.value = 'success'
    newRoom.value = { name: '', type: 'SIMPLE', description: '', dailyRateFcfa: '25000' }
    await load()
  } catch {
    message.value = 'Impossible de créer la salle.'
    messageType.value = 'error'
  }
}

async function confirmAdmission(payload: HospitalizationAdmissionForm & { hospitalizationId: string; roomId?: string }) {
  admissionSubmitting.value = true
  try {
    if (admissionMode.value === 'edit') {
      const { data: res } = await api.post('/hospitalisation/actions', {
        action: 'update_admission',
        hospitalizationId: payload.hospitalizationId,
        startDate: payload.startDate,
        endDate: payload.endDate,
        reductionFcfa: Number(payload.reductionFcfa ?? 0),
        service: payload.service,
        attendingDoctor: payload.attendingDoctor,
        doctorInstructions: payload.doctorInstructions,
      })
      message.value = `Séjour mis à jour — ${res.nights} nuitée(s), total ${formatFcfa(res.totalDueFcfa)}`
      messageType.value = 'success'
      closeAdmission()
      await load()
      return
    }

    if (!payload.roomId) return

    const { data: res } = await api.post('/hospitalisation/actions', {
      action: 'reserve_room',
      hospitalizationId: payload.hospitalizationId,
      roomId: payload.roomId,
      startDate: payload.startDate,
      endDate: payload.endDate,
      reductionFcfa: Number(payload.reductionFcfa ?? 0),
      service: payload.service,
      attendingDoctor: payload.attendingDoctor,
      doctorInstructions: payload.doctorInstructions,
    })
    printHospitalizationAdmission(payload)
    message.value = res.totalDueFcfa
      ? `Admission validée — ${formatFcfa(res.totalDueFcfa)} (${res.nights} nuitée(s))`
      : `Admission validée — ${res.nights} nuitée(s).`
    messageType.value = 'success'
    closeAdmission()
    tab.value = 'hospitalized'
    await load()
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: { error?: string; detail?: string } } }
    const detail = apiError.response?.data?.detail
    const label = apiError.response?.data?.error
    message.value = detail
      ? `${label ?? 'Erreur'} : ${detail}`
      : (label ?? 'Chambre indisponible ou erreur lors de l\'admission.')
    messageType.value = 'error'
  } finally {
    admissionSubmitting.value = false
  }
}

async function confirmDischarge(payload: { hospitalizationId: string; endDate: string }) {
  dischargeSubmitting.value = true
  try {
    const { data: res } = await api.post('/hospitalisation/actions', {
      action: 'discharge',
      hospitalizationId: payload.hospitalizationId,
      endDate: payload.endDate,
    })
    message.value = `Sortie validée — ${res.nights} nuitée(s), total ${formatFcfa(res.totalDue)}`
    messageType.value = 'success'
    closeDischarge()
    await load()
  } catch {
    message.value = 'Erreur lors de la clôture.'
    messageType.value = 'error'
  } finally {
    dischargeSubmitting.value = false
  }
}

onMounted(() => {
  applyRouteQuery()
  load()
})

watch(() => route.query, () => {
  applyRouteQuery()
  scrollToFocusedVisit()
})
</script>

<template>
  <div>
    <UiPageHeader
      title="Hospitalisation"
      :subtitle="
        canManage
          ? 'Gestion des salles, plan des salles et attribution des hospitalisations'
          : 'Plan des salles, attribution et clôture des hospitalisations prescrites'
      "
      :icon="BedDouble"
    />

    <UiAlert v-if="message" :type="messageType" :message="message" />

    <template v-if="data">
      <div class="stats-row">
      <div class="stat-card card-accent card-accent--green">
        <span>Salles</span>
        <strong>{{ data.stats.roomCount }}</strong>
      </div>
      <div class="stat-card card-accent card-accent--green">
        <span>Salles libres</span>
        <strong>{{ data.stats.freeRooms }}</strong>
      </div>
      <div class="stat-card card-accent card-accent--green">
        <span>Salles occupées</span>
        <strong>{{ data.stats.occupiedRooms }}</strong>
      </div>
      <div class="stat-card card-accent card-accent--green">
        <span>En attente</span>
        <strong>{{ data.stats.pendingHospitalizations }}</strong>
      </div>
    </div>

    <div class="tabs">
      <button :class="{ active: tab === 'plan' }" @click="tab = 'plan'">Plan des salles</button>
      <button v-if="canManage" :class="{ active: tab === 'rooms' }" @click="tab = 'rooms'">
        Gestion des salles
      </button>
      <button :class="{ active: tab === 'queue' }" @click="tab = 'queue'">
        Hospitalisations
        <span v-if="pendingHospitalizations.length" class="tab-count">{{ pendingHospitalizations.length }}</span>
      </button>
      <button :class="{ active: tab === 'hospitalized' }" @click="tab = 'hospitalized'">
        Hospitaliser
        <span v-if="hospitalizedPatients.length" class="tab-count">{{ hospitalizedPatients.length }}</span>
      </button>
    </div>

    <template v-if="tab === 'plan'">
      <UiCard title="Plan des salles" description="Suivi en temps réel — [LIBRE] / [OCCUPÉ]" :icon="BedDouble" icon-variant="blue" class="compta-section">
        <template #actions>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="load">Actualiser</UiButton>
        </template>
        <div class="rooms-grid">
          <div
            v-for="room in data.rooms"
            :key="room.id"
            class="room-card"
            :class="`room-card--${room.status.toLowerCase()}`"
          >
            <div class="room-card__head">
              <strong>{{ room.name }}</strong>
              <UiBadge :variant="room.status === 'LIBRE' ? 'success' : 'danger'">[{{ room.status }}]</UiBadge>
            </div>
            <UiBadge variant="info">{{ room.type }}</UiBadge>
            <p v-if="room.currentPatient" class="room-patient">
              <ShieldCheck :size="14" />
              {{ fullName(room.currentPatient.firstName, room.currentPatient.lastName) }}
            </p>
            <p v-else class="room-empty">Disponible</p>
          </div>
        </div>
      </UiCard>
    </template>

    <template v-if="tab === 'rooms'">
      <UiCard title="Salles enregistrées" description="Tarifs nuitée et statut" :icon="BedDouble" icon-variant="blue" class="compta-section">
        <template #actions>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="load">Actualiser</UiButton>
        </template>
        <div v-for="room in data.rooms" :key="room.id" class="room-block">
          <div class="room-block__head">
            <div>
              <strong>{{ room.name }}</strong>
              <UiBadge :variant="room.type === 'VIP' ? 'primary' : 'info'">{{ room.type }}</UiBadge>
              <UiBadge :variant="room.status === 'LIBRE' ? 'success' : 'danger'">{{ room.status }}</UiBadge>
              <span class="room-rate">{{ formatFcfa(room.dailyRateFcfa) }}/nuit</span>
            </div>
          </div>
          <p v-if="room.description" class="room-desc">{{ room.description }}</p>
        </div>
        <p v-if="!data.rooms.length" class="compta-empty">Aucune salle enregistrée</p>
      </UiCard>

      <UiCard title="Nouvelle salle" description="Création d'une nouvelle salle" :icon="Plus" icon-variant="violet" class="compta-section">
        <div class="form-grid-2">
          <UiInput v-model="newRoom.name" label="Nom de la salle" placeholder="Ex. VIP 103" />
          <UiSelect v-model="newRoom.type" label="Type">
            <option value="VIP">VIP</option>
            <option value="SIMPLE">Simple</option>
          </UiSelect>
          <UiInput v-model="newRoom.dailyRateFcfa" label="Tarif nuitée (FCFA)" type="number" />
          <UiInput v-model="newRoom.description" label="Description" class="span-2" />
        </div>
        <UiButton variant="primary" :icon="Save" @click="addRoom">Enregistrer la salle</UiButton>
      </UiCard>
    </template>

    <template v-if="tab === 'queue'">
      <UiCard
        title="Hospitalisations en attente"
        description="Patients orientés par les médecins pour hospitalisation (payés ou non)"
        :icon="BedDouble"
        icon-variant="blue"
        class="compta-section"
      >
        <template #actions>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="load">Actualiser</UiButton>
        </template>

        <p v-if="!loading && !pendingHospitalizations.length" class="compta-empty">
          Aucun patient orienté pour hospitalisation
        </p>
        <HospitalizationsQueueDataTable
          v-else
          fill
          :items="pendingHospitalizations"
          :loading="loading"
          :focused-visit-id="focusedVisitId"
          @admit="openAdmission"
          @view="openView"
          @edit="openEdit"
          @discharge="openDischarge"
        />
      </UiCard>
    </template>

    <template v-if="tab === 'hospitalized'">
      <UiCard
        title="Patients hospitalisés"
        description="Tous les séjours hospitaliers — en cours et clôturés"
        :icon="BedDouble"
        icon-variant="green"
        class="compta-section"
      >
        <template #actions>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="load">Actualiser</UiButton>
        </template>

        <p v-if="!loading && !hospitalizedPatients.length" class="compta-empty">
          Aucun patient hospitalisé pour le moment
        </p>
        <HospitalizationsQueueDataTable
          v-else
          fill
          :items="hospitalizedPatients"
          :loading="loading"
          :focused-visit-id="focusedVisitId"
          @admit="openAdmission"
          @view="openView"
          @edit="openEdit"
          @discharge="openDischarge"
        />
      </UiCard>
    </template>

    <HospitalizationAdmissionModal
      :hosp="admissionHosp"
      :mode="admissionMode"
      :room-types="admissionRoomTypeOptions"
      :submitting="admissionSubmitting"
      @close="closeAdmission"
      @confirm="confirmAdmission"
    />

    <HospitalizationDischargeModal
      :hosp="dischargeHosp"
      :submitting="dischargeSubmitting"
      @close="closeDischarge"
      @confirm="confirmDischarge"
    />
    </template>

    <p v-else-if="loading" class="compta-empty">Chargement…</p>
  </div>
</template>

<style scoped>
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem 1rem;
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.stat-card span {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.stat-card strong {
  font-size: 1.25rem;
  color: var(--text);
}

.tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.tabs button {
  padding: 0.55rem 0.9rem;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  cursor: pointer;
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-muted);
}

.tabs button.active {
  background: var(--primary-50);
  border-color: var(--primary-500);
  color: var(--primary-800);
}

.tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  margin-left: 0.35rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--primary-500);
  color: #fff;
  font-size: 0.6875rem;
  font-weight: 700;
  line-height: 1;
}

.rooms-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.75rem;
}

.room-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.75rem;
  background: var(--bg-card);
}

.room-card--libre {
  border-left: 3px solid var(--success);
}

.room-card--occupe {
  border-left: 3px solid var(--danger);
}

.room-card__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.room-patient {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.5rem 0 0;
  font-size: 0.8125rem;
  font-weight: 600;
}

.room-empty {
  margin: 0.5rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.room-block {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 1rem;
  margin-bottom: 0.75rem;
}

.room-block__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.room-block__head strong {
  margin-right: 0.5rem;
}

.room-rate {
  margin-left: 0.5rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.room-desc {
  margin: 0.5rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.form-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.span-2 {
  grid-column: span 2;
}

@media (max-width: 768px) {
  .stats-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .form-grid-2,
  .span-2 {
    grid-template-columns: 1fr;
    grid-column: auto;
  }
}
</style>
