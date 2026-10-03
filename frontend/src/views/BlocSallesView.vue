<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { BedDouble, Plus, Scissors } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import { hospitalizationStayEnded } from '@/lib/hospitalization-admission'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import HospitalizationDirectAdmitModal from '@/components/hospitalisation/HospitalizationDirectAdmitModal.vue'
import OccupiedStayCards, {
  type OccupiedStayCard,
} from '@/components/hospitalisation/OccupiedStayCards.vue'
import type { AdmissionRoomTypeOption } from '@/components/hospitalisation/HospitalizationAdmissionModal.vue'
import type { HospitalizationAdmissionForm } from '@/lib/hospitalization-admission'

type HospRow = {
  id: string
  status: string
  roomType: string
  totalDueFcfa?: number
  paidFcfa?: number
  endDate?: string | null
  startDate?: string | null
  nightsCount?: number | null
  paidAt?: string | null
  room?: { name: string; type: string } | null
  visit: { patient: { firstName: string; lastName: string } }
}

type BlocSallesPayload = {
  hospitalizations: HospRow[]
  roomAvailability?: {
    VIP: Omit<AdmissionRoomTypeOption, 'label'>
    SIMPLE: Omit<AdmissionRoomTypeOption, 'label'>
  }
  surgeries: Array<{
    visit: { patient: { firstName: string; lastName: string } }
    interventionType: { label: string }
    surgeon: { firstName: string; lastName: string }
  }>
}

const data = ref<BlocSallesPayload | null>(null)
const loading = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const directAdmitOpen = ref(false)

const occupiedStays = computed((): OccupiedStayCard[] =>
  (data.value?.hospitalizations ?? [])
    .filter((row) => Boolean(row.room) && !hospitalizationStayEnded(row))
    .map((row) => ({
      id: row.id,
      patientName: fullName(row.visit.patient.firstName, row.visit.patient.lastName),
      roomName: row.room?.name ?? '',
      roomType: row.room?.type ?? row.roomType,
      endDate: row.endDate,
      totalDueFcfa: row.totalDueFcfa ?? 0,
      paidFcfa: row.paidFcfa ?? (row.paidAt ? (row.totalDueFcfa ?? 0) : 0),
    })),
)

const admissionRoomTypeOptions = computed((): AdmissionRoomTypeOption[] => {
  const availability = data.value?.roomAvailability
  return (['VIP', 'SIMPLE'] as const).map((type) => {
    const fromApi = availability?.[type]
    return {
      type,
      label: type === 'VIP' ? 'VIP' : 'Simple',
      roomName: fromApi?.roomName ?? (type === 'VIP' ? 'Salle VIP' : 'Salle simple'),
      dailyRateFcfa: type === 'VIP' ? 20_000 : 5_000,
      availableCount: fromApi?.availableCount ?? 0,
      autoRoomId: fromApi?.autoRoomId ?? null,
      autoBedId: fromApi?.autoBedId ?? null,
      availableBeds: fromApi?.availableBeds ?? [],
      availableRooms: fromApi?.availableRooms ?? [],
      blockedReason: fromApi?.blockedReason ?? null,
    }
  })
})

async function load() {
  loading.value = true
  message.value = ''
  try {
    const { data: blocData } = await api.get<BlocSallesPayload>('/bloc-salles')
    data.value = blocData
  } catch {
    message.value = 'Impossible de charger les salles.'
    messageType.value = 'error'
  } finally {
    loading.value = false
  }
}

function onDirectAdmitConfirmed(payload: {
  printForm: HospitalizationAdmissionForm
  nights: number
  totalDueFcfa: number
}) {
  directAdmitOpen.value = false
  message.value = `Patient ajouté — ${payload.nights} nuitée(s), ${formatFcfa(payload.totalDueFcfa)} à encaisser.`
  messageType.value = 'success'
  void load()
}

onMounted(async () => {
  await load()
})
</script>

<template>
  <div>
    <UiPageHeader
      title="Bloc opératoire & Salles"
      subtitle="Salles occupées — VIP 20 000 FCFA / nuit, simple 5 000 FCFA / nuit. La salle se libère à la date de sortie."
      :icon="BedDouble"
    >
      <template #actions>
        <UiButton variant="primary" :icon="Plus" @click="directAdmitOpen = true">
          Ajouter un patient
        </UiButton>
      </template>
    </UiPageHeader>

    <UiAlert v-if="message" :type="messageType" :message="message" />
    <p v-if="loading && !data" class="empty">Chargement…</p>

    <UiCard
      v-if="data"
      title="Salles occupées"
      description="Temps restant et montant payé ou restant"
      :icon="BedDouble"
      icon-variant="blue"
      class="section"
    >
      <p v-if="loading && !occupiedStays.length" class="empty">Chargement…</p>
      <OccupiedStayCards v-else :occupants="occupiedStays" />
    </UiCard>

    <UiCard
      v-if="data"
      title="Autorisations chirurgicales"
      description="Interventions payées par la comptabilité"
      :icon="Scissors"
      icon-variant="rose"
      class="section"
    >
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

    <HospitalizationDirectAdmitModal
      :open="directAdmitOpen"
      :room-types="admissionRoomTypeOptions"
      @close="directAdmitOpen = false"
      @confirmed="onDirectAdmitConfirmed"
    />
  </div>
</template>

<style scoped>
.section {
  margin-bottom: 1.25rem;
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
</style>
