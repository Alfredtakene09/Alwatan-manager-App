<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BedDouble, Plus, RefreshCw, Search, ShieldCheck } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import {
  admissionFormFromHospitalization,
  HOSPITALIZATION_STATUS_LABELS,
  hospitalizationStayDays,
  printHospitalizationAdmission,
  type HospitalizationAdmissionForm,
} from '@/lib/hospitalization-admission'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import { exportTableExcel, exportTablePdf, exportTableWord, type ExportColumn } from '@/lib/table-export'
import HospitalizationAdmissionModal, {
  type AdmissionRoomTypeOption,
} from '@/components/hospitalisation/HospitalizationAdmissionModal.vue'
import HospitalizationDischargeModal from '@/components/hospitalisation/HospitalizationDischargeModal.vue'
import HospitalizationDirectAdmitModal from '@/components/hospitalisation/HospitalizationDirectAdmitModal.vue'
import HospitalizationsQueueDataTable from '@/components/ui/HospitalizationsQueueDataTable.vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import { useSilentRefresh } from '@/composables/useSilentRefresh'
import { useAppI18n } from '@/i18n/useAppI18n'
import { confirmAppModal, showApiErrorModal } from '@/lib/api-modal-helper'
import { translateTemplate } from '@/lib/dashboard-i18n'
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
  paidAt?: string | Date | null
  service?: string | null
  attendingDoctor?: string | null
  attendingDoctorId?: string | null
  bedId?: string | null
  doctorInstructions?: string | null
  visit: {
    id: string
    patient: { code: string; firstName: string; lastName: string; phone?: string | null }
    consultation?: {
      doctor?: { id?: string; firstName: string; lastName: string } | null
      doctorComment?: string | null
      diagnosis?: string | null
      clinicalNotes?: string | null
    } | null
    assignedDoctor?: { id?: string; firstName: string; lastName: string } | null
  }
  room?: { id?: string; name: string; type: string } | null
  bed?: { id: string; code: string; label?: string | null } | null
  attendingDoctorUser?: { id: string; firstName: string; lastName: string } | null
}

withDefaults(
  defineProps<{
    embedded?: boolean
  }>(),
  { embedded: false },
)

const route = useRoute()
const router = useRouter()
const { uiText, localeCode, dateText } = useAppI18n()

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

const loading = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const tab = ref<'plan' | 'hospitalized'>('hospitalized')
const admissionHospId = ref<string | null>(null)
const admissionMode = ref<'create' | 'edit' | 'view'>('create')
const admissionSubmitting = ref(false)
const dischargeHospId = ref<string | null>(null)
const dischargeSubmitting = ref(false)
const directAdmitOpen = ref(false)

const focusedVisitId = computed(() =>
  typeof route.query.visitId === 'string' ? route.query.visitId : null,
)

const labels = computed(() => {
  void localeCode.value
  return {
    rooms: uiText('Salles'),
    freeRooms: uiText('Salles libres'),
    occupiedRooms: uiText('Salles occupées'),
    pending: uiText('En attente'),
    planTab: uiText('Plan des salles'),
    refresh: uiText('Actualiser'),
    newAdmission: uiText('Nouvelle hospitalisation'),
    available: uiText('Disponible'),
    hospEmpty: uiText('Aucun patient hospitalisé pour le moment'),
    loading: uiText('Chargement…'),
  }
})

function persistTabInQuery(next: typeof tab.value) {
  const raw = route.query.tab
  const current =
    raw === 'hospitaliser' || raw === 'queue' ? 'hospitalized' : raw
  if (current === next) return
  void router.replace({ query: { ...route.query, tab: next } })
}

function selectTab(next: typeof tab.value) {
  tab.value = next
  persistTabInQuery(tab.value)
}

function applyRouteQuery() {
  const qTab = route.query.tab
  if (qTab === 'plan') {
    tab.value = 'plan'
  } else if (
    qTab === 'queue' ||
    qTab === 'hospitalized' ||
    qTab === 'hospitaliser'
  ) {
    tab.value = 'hospitalized'
  }

  const visitId = typeof route.query.visitId === 'string' ? route.query.visitId : null
  if (!visitId || !data.value) return
  const hosp = data.value.hospitalizations.find((row) => row.visit.id === visitId)
  if (hosp) {
    tab.value = 'hospitalized'
    persistTabInQuery('hospitalized')
  }
}

async function scrollToFocusedVisit() {
  if (!focusedVisitId.value) return
  await nextTick()
  document
    .querySelector(`[data-visit-id="${focusedVisitId.value}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

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
        autoBedId: fromApi.autoBedId ?? null,
        availableBeds: fromApi.availableBeds ?? [],
        availableRooms: fromApi.availableRooms ?? [],
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
      autoBedId: null,
      availableBeds: [],
      availableRooms: roomsOfType.map((room) => ({
        id: room.id,
        name: room.name,
        dailyRateFcfa: room.dailyRateFcfa,
        autoBedId: null,
        availableBeds: [],
      })),
      blockedReason: null,
    }
  })
})

const hospitalizedPatients = computed(() =>
  (data.value?.hospitalizations ?? []).filter((h) => h.status !== 'CANCELLED'),
)

type RoomFilter = 'ALL' | 'VIP' | 'SIMPLE'

const listSearch = ref('')
const roomFilter = ref<RoomFilter>('ALL')
const dateFrom = ref('')
const dateTo = ref('')

function stayDateIso(value?: string | Date | null) {
  if (!value) return ''
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] ?? ''
}

function hospDoctorName(row: HospRow) {
  if (row.attendingDoctor?.trim()) return row.attendingDoctor.trim()
  const doctor =
    row.attendingDoctorUser ?? row.visit.consultation?.doctor ?? row.visit.assignedDoctor
  return doctor ? `Dr ${fullName(doctor.firstName, doctor.lastName)}` : ''
}

function isUnpaidStay(row: HospRow) {
  return !row.paidAt && (row.totalDueFcfa ?? 0) > 0 && Boolean(row.startDate)
}

function matchesRoomFilter(row: HospRow) {
  if (roomFilter.value === 'ALL') return true
  return (row.room?.type ?? row.roomType) === roomFilter.value
}

function matchesDateFilter(row: HospRow) {
  if (!dateFrom.value && !dateTo.value) return true
  const start = stayDateIso(row.startDate)
  if (!start) return false
  if (dateFrom.value && start < dateFrom.value) return false
  if (dateTo.value && start > dateTo.value) return false
  return true
}

function matchesSearchFilter(row: HospRow) {
  const q = listSearch.value.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    row.visit.patient.code,
    row.visit.patient.firstName,
    row.visit.patient.lastName,
    row.visit.patient.phone ?? '',
    hospDoctorName(row),
    row.room?.name ?? '',
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}

const filteredHospitalizedPatients = computed(() =>
  hospitalizedPatients.value.filter(
    (row) => matchesRoomFilter(row) && matchesDateFilter(row) && matchesSearchFilter(row),
  ),
)

const hasActiveListFilters = computed(
  () =>
    Boolean(listSearch.value.trim()) ||
    roomFilter.value !== 'ALL' ||
    Boolean(dateFrom.value) ||
    Boolean(dateTo.value),
)

function resetListFilters() {
  listSearch.value = ''
  roomFilter.value = 'ALL'
  dateFrom.value = ''
  dateTo.value = ''
}

function setListDatesToToday() {
  const today = new Date()
  const iso = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-')
  dateFrom.value = iso
  dateTo.value = iso
}

function stayStatusLabel(row: HospRow) {
  if (isUnpaidStay(row)) return uiText('En attente de paiement')
  return uiText(HOSPITALIZATION_STATUS_LABELS[row.status] ?? row.status)
}

type HospExportRow = {
  code: string
  patient: string
  phone: string
  doctor: string
  roomType: string
  days: string
  status: string
  entry: string
  exit: string
  amount: string
}

const hospExportColumns: ExportColumn<HospExportRow>[] = [
  { header: 'Matricule', value: (r) => r.code },
  { header: 'Patient', value: (r) => r.patient },
  { header: 'Téléphone', value: (r) => r.phone },
  { header: 'Médecin', value: (r) => r.doctor },
  { header: 'Chambre', value: (r) => r.roomType },
  { header: 'Jours', value: (r) => r.days },
  { header: 'Statut', value: (r) => r.status },
  { header: 'Entrée', value: (r) => r.entry },
  { header: 'Sortie', value: (r) => r.exit },
  { header: 'Montant', value: (r) => r.amount },
]

const hospExportRows = computed<HospExportRow[]>(() =>
  filteredHospitalizedPatients.value.map((row) => {
    const days = hospitalizationStayDays(row)
    const type = row.room?.type ?? row.roomType
    return {
      code: row.visit.patient.code,
      patient: fullName(row.visit.patient.firstName, row.visit.patient.lastName),
      phone: row.visit.patient.phone || '—',
      doctor: hospDoctorName(row) || '—',
      roomType: type === 'VIP' ? 'VIP' : type === 'SIMPLE' ? uiText('Simple') : '—',
      days: days > 0 ? String(days) : '—',
      status: stayStatusLabel(row),
      entry: row.startDate ? dateText(row.startDate) : '—',
      exit: row.endDate ? dateText(row.endDate) : '—',
      amount:
        row.totalDueFcfa && row.totalDueFcfa > 0
          ? formatFcfa(row.totalDueFcfa)
          : row.dailyRateFcfa
            ? `${formatFcfa(row.dailyRateFcfa)}/${uiText('nuit')}`
            : '—',
    }
  }),
)

function hospFilterCaption() {
  const parts: string[] = []
  const q = listSearch.value.trim()
  if (q) parts.push(`${uiText('Recherche')} : ${q}`)
  if (roomFilter.value === 'VIP') parts.push(`${uiText('Chambre')} : VIP`)
  if (roomFilter.value === 'SIMPLE') parts.push(`${uiText('Chambre')} : ${uiText('Simple')}`)
  if (dateFrom.value || dateTo.value) {
    parts.push(`${uiText('Du')} ${dateFrom.value || '…'} ${uiText('Au')} ${dateTo.value || '…'}`)
  }
  return parts.length ? parts.join(' · ') : uiText('Aucun filtre')
}

function hospExportShared() {
  return {
    captionRows: [{ label: uiText('Filtres'), value: hospFilterCaption() }],
    totalsRows: [
      { label: uiText('Nombre de séjours'), value: String(hospExportRows.value.length) },
    ],
  }
}

function exportHospPdf() {
  if (!hospExportRows.value.length) return
  exportTablePdf(uiText('Patients hospitalisés'), hospExportColumns, hospExportRows.value, hospExportShared())
}

function exportHospExcel() {
  if (!hospExportRows.value.length) return
  exportTableExcel(uiText('Patients hospitalisés'), hospExportColumns, hospExportRows.value, hospExportShared())
}

function exportHospWord() {
  if (!hospExportRows.value.length) return
  void exportTableWord(uiText('Patients hospitalisés'), hospExportColumns, hospExportRows.value, hospExportShared())
}

const admissionHosp = computed(() => {
  if (!admissionHospId.value) return null
  const hosp = data.value?.hospitalizations.find((h) => h.id === admissionHospId.value) ?? null
  if (!hosp) return null
  return { ...hosp, dailyRateFcfa: hosp.dailyRateFcfa ?? 0 }
})

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

function openDirectAdmit() {
  directAdmitOpen.value = true
}

function reprintReceipt(hospId: string) {
  const hosp = data.value?.hospitalizations.find((row) => row.id === hospId)
  if (!hosp) return
  printHospitalizationAdmission(
    admissionFormFromHospitalization({
      ...hosp,
      dailyRateFcfa: hosp.dailyRateFcfa ?? 0,
    }),
    { autoPrint: true },
  )
}

async function deleteHospitalization(hospId: string) {
  const hosp = data.value?.hospitalizations.find((row) => row.id === hospId)
  if (!hosp) return
  const patient = hosp.visit.patient
  const amount = Math.max(0, hosp.totalDueFcfa ?? 0)
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: uiText("Supprimer l'hospitalisation"),
    message: translateTemplate(
      'Supprimer l’hospitalisation de {code} — {name} ? Le montant encaissé ({amount}) sera retiré du compte. Cette action est irréversible.',
      {
        code: patient.code,
        name: fullName(patient.firstName, patient.lastName),
        amount: formatFcfa(amount),
      },
    ),
    confirmLabel: uiText('Supprimer'),
  })
  if (!confirmed) return

  try {
    const { data: res } = await api.post<{ refundedFcfa?: number }>('/hospitalisation/actions', {
      action: 'delete',
      hospitalizationId: hospId,
    })
    message.value = translateTemplate("Hospitalisation supprimée. Montant retiré du compte : {amount}.", {
      amount: formatFcfa(res.refundedFcfa ?? amount),
    })
    messageType.value = 'success'
    if (admissionHospId.value === hospId) closeAdmission()
    if (dischargeHospId.value === hospId) closeDischarge()
    await load()
  } catch (error: unknown) {
    await showApiErrorModal(error, uiText("Impossible de supprimer l'hospitalisation."))
  }
}

async function collectPayment(hospId: string) {
  const hosp = data.value?.hospitalizations.find((row) => row.id === hospId)
  if (!hosp) return
  try {
    await api.post('/hospitalisation/actions', {
      action: 'collect_payment',
      hospitalizationId: hospId,
    })
    printHospitalizationAdmission(
      admissionFormFromHospitalization({
        ...hosp,
        dailyRateFcfa: hosp.dailyRateFcfa ?? 0,
        paidAt: new Date().toISOString(),
      }),
      { autoPrint: true },
    )
    message.value = uiText('Paiement encaissé.')
    messageType.value = 'success'
    await load()
  } catch (error: unknown) {
    await showApiErrorModal(error, uiText("Impossible d'encaisser l'hospitalisation."))
  }
}

function closeDischarge() {
  dischargeHospId.value = null
  dischargeSubmitting.value = false
}

async function load(opts?: { silent?: boolean }) {
  if (!opts?.silent) loading.value = true
  try {
    const visitId = focusedVisitId.value
    const { data: res } = await api.get('/hospitalisation', {
      params: visitId ? { visitId } : undefined,
    })
    data.value = res
    applyRouteQuery()
    if (!opts?.silent) await scrollToFocusedVisit()
  } finally {
    if (!opts?.silent) loading.value = false
  }
}

async function onDirectAdmitConfirmed(payload: {
  printForm: HospitalizationAdmissionForm
  nights: number
  totalDueFcfa: number
}) {
  directAdmitOpen.value = false
  try {
    await printHospitalizationAdmission(payload.printForm)
  } catch {
    /* impression non bloquante */
  }
  message.value = payload.totalDueFcfa
    ? uiText('Admission validée — {amount} ({nights} nuitée(s))')
        .replace('{amount}', formatFcfa(payload.totalDueFcfa))
        .replace('{nights}', String(payload.nights))
    : uiText('Admission validée — {nights} nuitée(s).').replace('{nights}', String(payload.nights))
  messageType.value = 'success'
  selectTab('hospitalized')
  await load()
}

async function confirmAdmission(payload: HospitalizationAdmissionForm & { hospitalizationId: string; roomId?: string; bedId?: string }) {
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
        attendingDoctorId: payload.attendingDoctorId || undefined,
        doctorInstructions: payload.doctorInstructions,
      })
      message.value = uiText('Séjour mis à jour — {nights} nuitée(s), total {amount}')
        .replace('{nights}', String(res.nights))
        .replace('{amount}', formatFcfa(res.totalDueFcfa))
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
      bedId: payload.bedId || undefined,
      startDate: payload.startDate,
      endDate: payload.endDate,
      reductionFcfa: Number(payload.reductionFcfa ?? 0),
      service: payload.service,
      attendingDoctor: payload.attendingDoctor,
      attendingDoctorId: payload.attendingDoctorId || undefined,
      doctorInstructions: payload.doctorInstructions,
    })
    printHospitalizationAdmission(payload)
    message.value = res.totalDueFcfa
      ? uiText('Admission validée — {amount} ({nights} nuitée(s))')
          .replace('{amount}', formatFcfa(res.totalDueFcfa))
          .replace('{nights}', String(res.nights))
      : uiText('Admission validée — {nights} nuitée(s).').replace('{nights}', String(res.nights))
    messageType.value = 'success'
    closeAdmission()
    selectTab('hospitalized')
    await load()
  } catch (error: unknown) {
    const apiError = error as { response?: { data?: { error?: string; detail?: string } } }
    const detail = apiError.response?.data?.detail
    const label = apiError.response?.data?.error
    message.value = detail
      ? `${label ?? uiText('Erreur')} : ${detail}`
      : (label ?? uiText("Chambre indisponible ou erreur lors de l'admission."))
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
    message.value = uiText('Sortie validée — {nights} nuitée(s), total {amount}')
      .replace('{nights}', String(res.nights))
      .replace('{amount}', formatFcfa(res.totalDue))
    messageType.value = 'success'
    closeDischarge()
    await load()
  } catch {
    message.value = uiText('Erreur lors de la clôture.')
    messageType.value = 'error'
  } finally {
    dischargeSubmitting.value = false
  }
}

const { refresh: refreshData } = useSilentRefresh(
  ({ silent }) => load({ silent }),
  {
    intervalMs: 30_000,
    enabled: () => !admissionHospId.value && !dischargeHospId.value && !directAdmitOpen.value,
  },
)

applyRouteQuery()

watch(() => route.query, () => {
  applyRouteQuery()
  scrollToFocusedVisit()
})

watch([dateFrom, dateTo], () => {
  if (dateFrom.value && dateTo.value && dateFrom.value > dateTo.value) {
    dateTo.value = dateFrom.value
  }
})
</script>

<template>
  <div :class="{ 'hospitalisation-embedded': embedded }">
    <UiPageHeader
      v-if="!embedded"
      title="Hospitalisation"
      subtitle="Choisir un patient, attribuer une salle et encaisser l'hospitalisation"
      :icon="BedDouble"
    >
      <template #actions>
        <UiButton :icon="Plus" @click="openDirectAdmit">
          {{ labels.newAdmission }}
        </UiButton>
      </template>
    </UiPageHeader>

    <div v-else class="hospitalisation-embedded__actions">
      <UiButton :icon="Plus" @click="openDirectAdmit">
        {{ labels.newAdmission }}
      </UiButton>
    </div>

    <UiAlert v-if="message" :type="messageType" :message="message" />

    <template v-if="data">
      <div class="stats-row">
      <div class="stat-card card-accent card-accent--green">
        <span>{{ labels.rooms }}</span>
        <strong>{{ data.stats.roomCount }}</strong>
      </div>
      <div class="stat-card card-accent card-accent--green">
        <span>{{ labels.freeRooms }}</span>
        <strong>{{ data.stats.freeRooms }}</strong>
      </div>
      <div class="stat-card card-accent card-accent--green">
        <span>{{ labels.occupiedRooms }}</span>
        <strong>{{ data.stats.occupiedRooms }}</strong>
      </div>
      <div class="stat-card card-accent card-accent--green">
        <span>{{ labels.pending }}</span>
        <strong>{{ data.stats.pendingHospitalizations }}</strong>
      </div>
    </div>

    <div v-if="!embedded" class="tabs">
      <button :class="{ active: tab === 'plan' }" @click="selectTab('plan')">{{ labels.planTab }}</button>
      <button :class="{ active: tab === 'hospitalized' }" @click="selectTab('hospitalized')">
        {{ uiText('Patients hospitalisés') }}
        <span v-if="hospitalizedPatients.length" class="tab-count">{{ hospitalizedPatients.length }}</span>
      </button>
    </div>

    <template v-if="tab === 'plan'">
      <UiCard
        title="Plan des salles"
        description="Suivi en temps réel — [LIBRE] / [OCCUPÉ]"
        :icon="BedDouble"
        icon-variant="blue"
        class="compta-section"
      >
        <template #actions>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="refreshData()">{{ labels.refresh }}</UiButton>
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
            <UiBadge variant="info">{{ room.type === 'SIMPLE' ? uiText('Simple') : room.type }}</UiBadge>
            <p v-if="room.currentPatient" class="room-patient">
              <ShieldCheck :size="14" />
              {{ fullName(room.currentPatient.firstName, room.currentPatient.lastName) }}
            </p>
            <p v-else class="room-empty">{{ labels.available }}</p>
          </div>
        </div>
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
          <ExportButtons
            :disabled="loading || !hospExportRows.length"
            @pdf="exportHospPdf"
            @excel="exportHospExcel"
            @word="exportHospWord"
          />
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="refreshData()">{{ labels.refresh }}</UiButton>
        </template>

        <div class="hosp-toolbar">
          <div class="hosp-toolbar__row">
            <label class="hosp-search">
              <Search :size="16" aria-hidden="true" />
              <input
                v-model="listSearch"
                type="search"
                :placeholder="uiText('Rechercher par matricule, nom, médecin…')"
                :aria-label="uiText('Recherche')"
              />
            </label>

            <select v-model="roomFilter" class="hosp-select" :aria-label="uiText('Chambre')">
              <option value="ALL">{{ uiText('Toutes les chambres') }}</option>
              <option value="VIP">VIP</option>
              <option value="SIMPLE">{{ uiText('Simple') }}</option>
            </select>

            <label class="hosp-date">
              <span>{{ uiText('Du') }}</span>
              <input v-model="dateFrom" type="date" :max="dateTo || undefined" :aria-label="uiText('Du')" />
            </label>
            <label class="hosp-date">
              <span>{{ uiText('Au') }}</span>
              <input v-model="dateTo" type="date" :min="dateFrom || undefined" :aria-label="uiText('Au')" />
            </label>
            <UiButton size="sm" variant="outline" @click="setListDatesToToday">
              {{ uiText("Aujourd'hui") }}
            </UiButton>
            <UiButton v-if="hasActiveListFilters" size="sm" variant="ghost" @click="resetListFilters">
              {{ uiText('Effacer') }}
            </UiButton>
            <span class="hosp-toolbar__count">
              {{ uiText('{n} séjour(s)').replace('{n}', String(filteredHospitalizedPatients.length)) }}
            </span>
          </div>
        </div>

        <p v-if="!loading && !hospitalizedPatients.length" class="compta-empty">
          {{ labels.hospEmpty }}
        </p>
        <p v-else-if="!loading && hospitalizedPatients.length && !filteredHospitalizedPatients.length" class="compta-empty">
          {{ uiText('Aucune ligne ne correspond aux filtres.') }}
        </p>
        <HospitalizationsQueueDataTable
          v-else
          fill
          :items="filteredHospitalizedPatients"
          :loading="loading && !hospitalizedPatients.length"
          :focused-visit-id="focusedVisitId"
          @admit="openAdmission"
          @view="openView"
          @edit="openEdit"
          @discharge="openDischarge"
          @print="reprintReceipt"
          @delete="deleteHospitalization"
          @collect="collectPayment"
        />
      </UiCard>
    </template>

    <HospitalizationDirectAdmitModal
      :open="directAdmitOpen"
      :room-types="admissionRoomTypeOptions"
      @close="directAdmitOpen = false"
      @confirmed="onDirectAdmitConfirmed"
    />

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

    <p v-else-if="loading" class="compta-empty">{{ labels.loading }}</p>
  </div>
</template>

<style scoped>
.hosp-toolbar {
  margin-bottom: 0.85rem;
}

.hosp-toolbar__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.hosp-search {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  flex: 1 1 14rem;
  min-width: min(100%, 14rem);
  padding: 0.42rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text-muted);
}

.hosp-search input {
  width: 100%;
  border: 0;
  outline: none;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--text);
  background: transparent;
}

.hosp-select,
.hosp-date input {
  padding: 0.42rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--text);
}

.hosp-date {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 600;
}

.hosp-toolbar__count {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.hospitalisation-embedded__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

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
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
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

@media (max-width: 1023px) {
  .stats-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.45rem;
  }

  .stat-card {
    padding: 0.55rem 0.7rem;
  }

  .stat-card strong {
    font-size: var(--density-stat-value);
  }

  .rooms-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.5rem;
  }

  .tabs button {
    padding: 0.4rem 0.7rem;
    font-size: 0.8rem;
  }
}

@media (max-width: 768px) {
  .stats-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 639px) {
  .room-card {
    padding: 0.55rem;
  }
}
</style>
