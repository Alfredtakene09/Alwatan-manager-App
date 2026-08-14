<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  FlaskConical,
  ScanLine,
  Waves,
  Smile,
  ShoppingBag,
  MessageSquare,
  Scissors,
  BedDouble,
  Stethoscope,
  ClipboardList,
  X,
} from '@lucide/vue'
import ExamPrescriptionPicker from '@/components/ExamPrescriptionPicker.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/format-fcfa'
import { clinicPercentFromSplits } from '@/lib/intervention-splits'
import {
  EXAM_KIND_LABELS,
  EXAM_KIND_ORDER,
  INVOICE_EXAM_COMMENT_KINDS,
  countExamsByKind,
  emptyExamCommentsByKind,
  getCatalogForKind,
  getSpecialtyServiceName,
  getSpecialtyServices,
  invalidateExamCatalogCache,
  examCatalogInvalidateEventName,
  isRedundantWithGlobalOperationTab,
  loadExamCatalog,
  type CatalogExam,
  type ExamCommentsByKind,
  type ExamKindSlug,
  type ExamsByKind,
  type SpecialtyServiceInfo,
} from '@/lib/exam-catalog'
import {
  CLINICAL_CONSULTATION_EXAM_LABEL,
  hasClinicalConsultationSelected,
} from '@/lib/lab-notes'
import { groupPrescribedByPanel, formatPanelGroupDetails } from '@/lib/lab-prescribed-panels'
import { useLabPanelsStore } from '@/stores/lab-panels'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

type ActivePanel = 'consultation' | ExamKindSlug | `specialty:${string}`

const props = withDefaults(
  defineProps<{
    modelValue: ExamsByKind
    comments?: ExamCommentsByKind
    kinds?: ExamKindSlug[]
    showComments?: boolean
    commentKinds?: ExamKindSlug[]
    hospitalisationDays?: number | null
    /** Labels déjà prescrits par type (mode ajout). */
    excludeByKind?: Partial<Record<ExamKindSlug, string[]>>
    /** Filtre examens selon le médecin (service lié + Laboratoire/Hospitalisation). */
    doctorId?: string | null
    serviceId?: string | null
    /** Bouton Consultation (désactivé pour patient externe : le service suffit). */
    showConsultation?: boolean
    /**
     * Masque l’onglet Consultation (acte déjà engagé côté parent,
     * ex. clic « Consulter » sur la file médecin).
     */
    hideConsultationTab?: boolean
    /** Montant opération (FCFA) — modifiable à la sélection, appliqué aux % parties prenantes. */
    operationAmountFcfa?: number | null
  }>(),
  {
    comments: () => emptyExamCommentsByKind(),
    showComments: true,
    commentKinds: () => INVOICE_EXAM_COMMENT_KINDS,
    hospitalisationDays: null,
    showConsultation: true,
    hideConsultationTab: false,
    operationAmountFcfa: null,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: ExamsByKind]
  'update:comments': [value: ExamCommentsByKind]
  'update:hospitalisationDays': [value: number | null]
  'update:operationAmountFcfa': [value: number | null]
  'active-service-change': [
    payload: {
      kind: ExamKindSlug | 'consultation' | null
      clinicServiceId: string | null
      clinicServiceName: string | null
    },
  ]
}>()

const { uiText, localeCode } = useAppI18n()
const labPanelsStore = useLabPanelsStore()

const activePanel = ref<ActivePanel>('examen')
const catalogReady = ref(false)
/** Invalide les computed qui lisent le cache module (non réactif Vue). */
const catalogEpoch = ref(0)
const specialtyExamCount = ref(0)
const specialtyServiceLabel = ref<string | null>(null)
const specialtyServiceTabs = ref<SpecialtyServiceInfo[]>([])

const examsByKind = computed({
  get: () => props.modelValue,
  set: (value: ExamsByKind) => emit('update:modelValue', value),
})

const specialtyTabs = computed(() => {
  void catalogEpoch.value
  const base = props.kinds ?? EXAM_KIND_ORDER
  if (!base.includes('specialty') && !base.includes('operation')) return []
  // Médecin : masquer services sans nomenclature. Patient externe : garder les services vides (choix destination).
  let tabs = props.showConsultation
    ? specialtyServiceTabs.value.filter((svc) => svc.hasExams || svc.hasOperations)
    : specialtyServiceTabs.value
  // Éviter Opération + Chirurgie générale + Bloc opératoire en doublon.
  if (base.includes('operation')) {
    tabs = tabs.filter((svc) => !isRedundantWithGlobalOperationTab(svc.name))
  }
  if (!base.includes('specialty')) {
    return tabs.filter((svc) => svc.hasOperations)
  }
  return tabs
})

const visibleKinds = computed(() => {
  void catalogEpoch.value
  const base = props.kinds ?? EXAM_KIND_ORDER
  return base.filter((kind) => {
    if (kind === 'specialty') {
      if (specialtyTabs.value.length > 0) return false
      return specialtyExamCount.value > 0
    }
    if (kind === 'operation') {
      return getCatalogForKind('operation', props.doctorId, props.serviceId).length > 0
    }
    return true
  })
})

const consultationSelected = computed(() => hasClinicalConsultationSelected(examsByKind.value))

const consultationAlreadyPrescribed = computed(() =>
  hasClinicalConsultationSelected(props.excludeByKind ?? null),
)

const specialtySummaryExams = computed(() =>
  (examsByKind.value.specialty ?? []).filter((label) => label !== CLINICAL_CONSULTATION_EXAM_LABEL),
)

const activeSpecialtyClinicServiceId = computed(() => {
  if (typeof activePanel.value === 'string' && activePanel.value.startsWith('specialty:')) {
    return activePanel.value.slice('specialty:'.length)
  }
  return null
})

function activeSpecialtyTab(): SpecialtyServiceInfo | null {
  const id = activeSpecialtyClinicServiceId.value
  if (!id) return null
  return specialtyTabs.value.find((svc) => svc.id === id) ?? null
}

/** Sur un onglet service : examens si dispo, sinon opérations du service. */
function specialtyTabUsesOperations(tab: SpecialtyServiceInfo | null): boolean {
  return !!tab && !tab.hasExams && tab.hasOperations
}

function kindLabel(kind: ExamKindSlug) {
  void localeCode.value
  void catalogEpoch.value
  if (kind === 'specialty' && specialtyServiceLabel.value) {
    return uiText(specialtyServiceLabel.value)
  }
  return uiText(EXAM_KIND_LABELS[kind])
}

async function refreshCatalogState() {
  catalogReady.value = false
  await Promise.all([
    loadExamCatalog({
      doctorId: props.doctorId,
      serviceId: props.serviceId,
      force: true,
    }),
    labPanelsStore.fetchPanels(true),
  ])
  specialtyExamCount.value = getCatalogForKind('specialty', props.doctorId, props.serviceId).filter(
    (exam) => exam.label !== CLINICAL_CONSULTATION_EXAM_LABEL,
  ).length
  specialtyServiceLabel.value = getSpecialtyServiceName(props.doctorId, props.serviceId)
  // Garder les services avec examens OU opérations (Tromatologie = ops seulement)
  specialtyServiceTabs.value = getSpecialtyServices(props.doctorId, props.serviceId)
  catalogEpoch.value += 1
  catalogReady.value = true

  if (activePanel.value === 'consultation') {
    if (!props.showConsultation || props.hideConsultationTab) {
      activePanel.value = visibleKinds.value.includes('examen')
        ? 'examen'
        : specialtyTabs.value[0]
          ? `specialty:${specialtyTabs.value[0].id}`
          : (visibleKinds.value[0] ?? 'examen')
    } else {
      return
    }
  }
  if (typeof activePanel.value === 'string' && activePanel.value.startsWith('specialty:')) {
    const id = activePanel.value.slice('specialty:'.length)
    if (specialtyTabs.value.some((svc) => svc.id === id)) return
  }
  // Ne plus basculer auto vers la spécialité : les examens labo restent visibles d’abord.
  if (
    !String(activePanel.value).startsWith('specialty:') &&
    !visibleKinds.value.includes(activePanel.value as ExamKindSlug)
  ) {
    if (visibleKinds.value.includes('examen')) {
      activePanel.value = 'examen'
    } else if (visibleKinds.value[0]) {
      activePanel.value = visibleKinds.value[0]
    } else if (specialtyTabs.value[0]) {
      activePanel.value = `specialty:${specialtyTabs.value[0].id}`
    } else {
      activePanel.value = 'examen'
    }
  }
}

const activeKind = computed<ExamKindSlug>(() => {
  if (activePanel.value === 'consultation') return 'specialty'
  if (String(activePanel.value).startsWith('specialty:')) {
    return specialtyTabUsesOperations(activeSpecialtyTab()) ? 'operation' : 'specialty'
  }
  return activePanel.value as ExamKindSlug
})

const activeSpecialtyCart = computed(() => {
  void catalogEpoch.value
  const serviceId = activeSpecialtyClinicServiceId.value
  const tab = activeSpecialtyTab()
  if (!serviceId) {
    return specialtyTabUsesOperations(tab)
      ? (examsByKind.value.operation ?? [])
      : specialtySummaryExams.value
  }
  if (specialtyTabUsesOperations(tab)) {
    const labels = new Set(
      getCatalogForKind('operation', props.doctorId, props.serviceId, serviceId).map((e) => e.label),
    )
    return (examsByKind.value.operation ?? []).filter((label) => labels.has(label))
  }
  const labels = new Set(
    getCatalogForKind('specialty', props.doctorId, props.serviceId, serviceId).map((e) => e.label),
  )
  return specialtySummaryExams.value.filter((label) => labels.has(label))
})

const activeCommentLabel = computed(() => {
  void localeCode.value
  return translateTemplate('Commentaire — {kind}', { kind: kindLabel(activeKind.value) })
})

const activeCommentPlaceholder = computed(() => {
  void localeCode.value
  return translateTemplate('Indications ou remarques pour les examens {kind}…', {
    kind: kindLabel(activeKind.value).toLowerCase(),
  })
})

const commentsByKind = computed({
  get: () => props.comments,
  set: (value: ExamCommentsByKind) => emit('update:comments', value),
})

const prescribedHospitalisationDays = computed({
  get: () => props.hospitalisationDays,
  set: (value: number | null) => emit('update:hospitalisationDays', value),
})

const totalCount = computed(() => countExamsByKind(examsByKind.value))

/** Kinds with a selection or comment — even if the tab is hidden (services specialty). */
const summaryKinds = computed(() => {
  const base = props.kinds ?? EXAM_KIND_ORDER
  return base.filter(
    (kind) => kindCount(kind) > 0 || (showCommentForKind(kind) && !!kindComment(kind)),
  )
})

function showCommentForKind(kind: ExamKindSlug) {
  return props.showComments && props.commentKinds.includes(kind)
}

const activeComment = computed({
  get: () => commentsByKind.value[activeKind.value] ?? '',
  set: (value: string) => {
    commentsByKind.value = { ...commentsByKind.value, [activeKind.value]: value }
  },
})

const kindIcons: Record<ExamKindSlug, typeof FlaskConical> = {
  specialty: Stethoscope,
  examen: FlaskConical,
  radio: ScanLine,
  echo: Waves,
  odonto: Smile,
  operation: Scissors,
  hospitalisation: BedDouble,
}

function updateKind(kind: ExamKindSlug, items: string[]) {
  examsByKind.value = { ...examsByKind.value, [kind]: items }
}

function kindCount(kind: ExamKindSlug) {
  if (kind === 'specialty') return specialtySummaryExams.value.length
  return kindSummaryGroups(kind).length
}

function kindSummaryExams(kind: ExamKindSlug): string[] {
  if (kind === 'specialty') return specialtySummaryExams.value
  return examsByKind.value[kind] ?? []
}

function kindSummaryGroups(kind: ExamKindSlug) {
  return groupPrescribedByPanel(kindSummaryExams(kind))
}

/** Retire tout le formulaire / panel (toutes les lignes champs associées). */
function removePanelGroup(kind: ExamKindSlug, rawLabels: string[]) {
  const remove = new Set(rawLabels)
  if (kind === 'specialty') {
    updateKind(
      'specialty',
      (examsByKind.value.specialty ?? []).filter((label) => !remove.has(label)),
    )
    return
  }
  updateKind(
    kind,
    (examsByKind.value[kind] ?? []).filter((label) => !remove.has(label)),
  )
}

function specialtyServiceCount(serviceId: string) {
  void catalogEpoch.value
  const tab = specialtyTabs.value.find((svc) => svc.id === serviceId)
  if (specialtyTabUsesOperations(tab ?? null)) {
    const labels = new Set(
      getCatalogForKind('operation', props.doctorId, props.serviceId, serviceId).map((e) => e.label),
    )
    return (examsByKind.value.operation ?? []).filter((label) => labels.has(label)).length
  }
  const examLabels = new Set(
    getCatalogForKind('specialty', props.doctorId, props.serviceId, serviceId).map((e) => e.label),
  )
  const examCount = specialtySummaryExams.value.filter((label) => examLabels.has(label)).length
  // Badge = examens + opérations du service (ex. Ophtalmologie)
  if (tab?.hasOperations) {
    const opLabels = new Set(
      getCatalogForKind('operation', props.doctorId, props.serviceId, serviceId).map((e) => e.label),
    )
    const opCount = (examsByKind.value.operation ?? []).filter((label) => opLabels.has(label)).length
    return examCount + opCount
  }
  return examCount
}

function kindComment(kind: ExamKindSlug) {
  return commentsByKind.value[kind]?.trim() ?? ''
}

function selectConsultation() {
  activePanel.value = 'consultation'
  if (consultationAlreadyPrescribed.value) return
  const specialty = [...(examsByKind.value.specialty ?? [])]
  if (!specialty.includes(CLINICAL_CONSULTATION_EXAM_LABEL)) {
    updateKind('specialty', [...specialty, CLINICAL_CONSULTATION_EXAM_LABEL])
  }
}

function clearConsultation() {
  updateKind(
    'specialty',
    (examsByKind.value.specialty ?? []).filter((label) => label !== CLINICAL_CONSULTATION_EXAM_LABEL),
  )
  if (activePanel.value === 'consultation') {
    activePanel.value = specialtyTabs.value[0]
      ? `specialty:${specialtyTabs.value[0].id}`
      : (visibleKinds.value[0] ?? 'examen')
  }
}

function selectKind(kind: ExamKindSlug) {
  activePanel.value = kind
}

function selectSpecialtyService(serviceId: string) {
  activePanel.value = `specialty:${serviceId}`
}

const KIND_SERVICE_NAME_HINTS: Partial<Record<ExamKindSlug, string[]>> = {
  examen: ['Laboratoire', 'Labo'],
  radio: ['Imagerie', 'Radio'],
  echo: ['Echographie', 'Échographie', 'Écho', 'Echo'],
  odonto: ['Odontologie', 'Odonto'],
  operation: ['Bloc opératoire', 'Opération'],
}

function emitActiveService() {
  const specialtyId = activeSpecialtyClinicServiceId.value
  if (specialtyId) {
    const tab = specialtyTabs.value.find((svc) => svc.id === specialtyId)
    emit('active-service-change', {
      kind: specialtyTabUsesOperations(tab ?? null) ? 'operation' : 'specialty',
      clinicServiceId: specialtyId,
      clinicServiceName: tab?.name ?? null,
    })
    return
  }
  if (activePanel.value === 'consultation') {
    emit('active-service-change', {
      kind: 'consultation',
      clinicServiceId: null,
      clinicServiceName: 'Consultation',
    })
    return
  }
  const kind = activePanel.value as ExamKindSlug
  emit('active-service-change', {
    kind,
    clinicServiceId: null,
    clinicServiceName: KIND_SERVICE_NAME_HINTS[kind]?.[0] ?? EXAM_KIND_LABELS[kind] ?? null,
  })
}

watch(
  () => [activePanel.value, specialtyTabs.value, catalogEpoch.value] as const,
  () => {
    emitActiveService()
  },
  { immediate: true },
)

function updateSpecialtyForActiveService(selected: string[]) {
  const serviceId = activeSpecialtyClinicServiceId.value
  if (!serviceId) {
    updateKind(
      'specialty',
      [
        ...(consultationSelected.value ? [CLINICAL_CONSULTATION_EXAM_LABEL] : []),
        ...selected.filter((label) => label !== CLINICAL_CONSULTATION_EXAM_LABEL),
      ],
    )
    return
  }
  const serviceLabels = new Set(
    getCatalogForKind('specialty', props.doctorId, props.serviceId, serviceId).map((e) => e.label),
  )
  const kept = specialtySummaryExams.value.filter((label) => !serviceLabels.has(label))
  updateKind('specialty', [
    ...(consultationSelected.value ? [CLINICAL_CONSULTATION_EXAM_LABEL] : []),
    ...kept,
    ...selected.filter((label) => label !== CLINICAL_CONSULTATION_EXAM_LABEL),
  ])
}

function updateOperationForActiveService(selected: string[]) {
  const serviceId = activeSpecialtyClinicServiceId.value
  if (!serviceId) {
    updateKind('operation', selected)
    return
  }
  const serviceLabels = new Set(
    getCatalogForKind('operation', props.doctorId, props.serviceId, serviceId).map((e) => e.label),
  )
  const kept = (examsByKind.value.operation ?? []).filter((label) => !serviceLabels.has(label))
  updateKind('operation', [...kept, ...selected])
}

function onActivePickerUpdate(selected: string[]) {
  if (String(activePanel.value).startsWith('specialty:')) {
    if (specialtyTabUsesOperations(activeSpecialtyTab())) {
      updateOperationForActiveService(selected)
      return
    }
    updateSpecialtyForActiveService(selected)
    return
  }
  updateKind(activeKind.value, selected)
}

type DoctorOption = { id: string; firstName: string; lastName: string }
type AssistantInputMode = 'select' | 'custom'

const assistantDoctors = ref<DoctorOption[]>([])
const assistantSaving = ref(false)
const assistantMessage = ref('')
const assistantMessageType = ref<'success' | 'error'>('success')
const assistantForm = ref({
  withAssistant: true,
  percent: '10',
  doctorId: '',
  name: '',
  mode: 'select' as AssistantInputMode,
})

const selectedOperationExam = computed<CatalogExam | null>(() => {
  void catalogEpoch.value
  if (activeKind.value !== 'operation') return null
  const labels =
    String(activePanel.value).startsWith('specialty:')
      ? activeSpecialtyCart.value
      : (examsByKind.value.operation ?? [])
  const label = labels[0]
  if (!label) return null
  const serviceId = activeSpecialtyClinicServiceId.value
  return (
    getCatalogForKind('operation', props.doctorId, props.serviceId, serviceId).find(
      (exam) => exam.label === label,
    ) ?? null
  )
})

/** Opération retenue dans le panier (tous onglets) — pour le prix et les parts. */
const cartOperationExam = computed<CatalogExam | null>(() => {
  void catalogEpoch.value
  const label = (examsByKind.value.operation ?? [])[0]
  if (!label) return null
  const serviceId = activeSpecialtyClinicServiceId.value
  return (
    getCatalogForKind('operation', props.doctorId, props.serviceId, serviceId).find(
      (exam) => exam.label === label,
    ) ??
    getCatalogForKind('operation', props.doctorId, props.serviceId).find(
      (exam) => exam.label === label,
    ) ??
    null
  )
})

const showOperationPricePanel = computed(() => !!cartOperationExam.value)

const showOperationAssistantPanel = computed(
  () => props.showConsultation && !!selectedOperationExam.value,
)

const operationAmountDraft = ref('')
const lastSyncedOperationLabel = ref<string | null>(null)

function emitOperationAmount(raw: string | number | null) {
  if (raw == null || raw === '') {
    emit('update:operationAmountFcfa', null)
    return
  }
  const n = Math.max(0, Math.round(Number(raw)))
  if (!Number.isFinite(n)) {
    emit('update:operationAmountFcfa', null)
    return
  }
  emit('update:operationAmountFcfa', n)
}

function onOperationAmountInput(value: string | number) {
  const raw = String(value ?? '').trim()
  operationAmountDraft.value = raw
  emitOperationAmount(raw === '' ? null : raw)
}

const operationSharePreview = computed(() => {
  const exam = cartOperationExam.value
  const total = Math.max(0, Math.round(Number(operationAmountDraft.value) || 0))
  if (!exam || total <= 0) return null
  const surgeonPct = Math.min(100, Math.max(0, Math.round(exam.surgeonPercent ?? 0)))
  const assistantPct = Math.min(
    100,
    Math.max(0, Math.round(exam.anesthesiologistPercent ?? 0)),
  )
  const clinicPct = clinicPercentFromSplits(surgeonPct, assistantPct)
  const surgeonShareFcfa = Math.round((total * surgeonPct) / 100)
  const assistantShareFcfa =
    assistantPct > 0 ? Math.round((total * assistantPct) / 100) : 0
  const clinicShareFcfa = total - surgeonShareFcfa - assistantShareFcfa
  return {
    total,
    surgeonPct,
    assistantPct,
    clinicPct,
    surgeonShareFcfa,
    assistantShareFcfa,
    clinicShareFcfa,
    hasAssistant: assistantPct > 0,
  }
})

function doctorOptionLabel(doctor: DoctorOption) {
  return `Dr ${doctor.firstName} ${doctor.lastName}`.trim()
}

async function loadAssistantDoctors() {
  if (!props.showConsultation) return
  try {
    const { data } = await api.get<DoctorOption[]>('/consultation/operation-types/doctors')
    assistantDoctors.value = Array.isArray(data) ? data : []
  } catch {
    assistantDoctors.value = []
  }
}

function syncAssistantFormFromSelection() {
  const exam = selectedOperationExam.value
  if (!exam) return
  const hasAssistant = !!exam.hasAssistant
  assistantForm.value = {
    withAssistant: true,
    percent: String(exam.anesthesiologistPercent && exam.anesthesiologistPercent > 0
      ? exam.anesthesiologistPercent
      : 10),
    doctorId: exam.anesthesiologistId ?? '',
    name: exam.anesthesiologistId ? '' : (exam.anesthesiologistName ?? ''),
    mode: exam.anesthesiologistId || !exam.anesthesiologistName ? 'select' : 'custom',
  }
  if (!hasAssistant) {
    assistantForm.value.withAssistant = true
  }
  assistantMessage.value = ''
}

async function saveOperationAssistant() {
  const exam = selectedOperationExam.value
  if (!exam) return

  if (!assistantForm.value.withAssistant) {
    assistantSaving.value = true
    assistantMessage.value = ''
    try {
      await api.put(`/consultation/operation-types/${exam.id}`, {
        anesthesiologistPercent: 0,
        anesthesiologistId: null,
        anesthesiologistName: null,
      })
      invalidateExamCatalogCache()
      await refreshCatalogState()
      assistantMessageType.value = 'success'
      assistantMessage.value = uiText('Assistant retiré de cette opération.')
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } }
      assistantMessageType.value = 'error'
      assistantMessage.value =
        err.response?.data?.error || uiText('Impossible de mettre à jour l’assistant.')
    } finally {
      assistantSaving.value = false
    }
    return
  }

  const percent = Number(assistantForm.value.percent)
  if (!Number.isFinite(percent) || percent < 1 || percent > 99) {
    assistantMessageType.value = 'error'
    assistantMessage.value = uiText('Le % assistant doit être entre 1 et 99.')
    return
  }

  const hasDoctor = assistantForm.value.mode === 'select' && assistantForm.value.doctorId
  const hasName =
    assistantForm.value.mode === 'custom' && assistantForm.value.name.trim().length >= 2
  if (!hasDoctor && !hasName) {
    assistantMessageType.value = 'error'
    assistantMessage.value = uiText(
      "Liez un médecin ou saisissez le nom de l'assistant chirurgie (2 caractères min.).",
    )
    return
  }

  assistantSaving.value = true
  assistantMessage.value = ''
  try {
    await api.put(`/consultation/operation-types/${exam.id}`, {
      anesthesiologistPercent: percent,
      anesthesiologistId: hasDoctor ? assistantForm.value.doctorId : null,
      anesthesiologistName: hasName ? assistantForm.value.name.trim() : null,
    })
    invalidateExamCatalogCache()
    await refreshCatalogState()
    assistantMessageType.value = 'success'
    assistantMessage.value = uiText('Assistant lié à cette opération.')
  } catch (error: unknown) {
    const err = error as { response?: { data?: { error?: string } } }
    assistantMessageType.value = 'error'
    assistantMessage.value =
      err.response?.data?.error || uiText('Impossible de lier l’assistant.')
  } finally {
    assistantSaving.value = false
  }
}

onMounted(async () => {
  window.addEventListener(examCatalogInvalidateEventName(), onCatalogInvalidate)
  await Promise.all([refreshCatalogState(), loadAssistantDoctors()])
})

onUnmounted(() => {
  window.removeEventListener(examCatalogInvalidateEventName(), onCatalogInvalidate)
})

function onCatalogInvalidate() {
  void refreshCatalogState()
}

watch(
  () => [props.doctorId, props.serviceId] as const,
  async () => {
    await refreshCatalogState()
  },
)

watch(
  selectedOperationExam,
  () => {
    syncAssistantFormFromSelection()
  },
  { immediate: true },
)

watch(
  cartOperationExam,
  (exam) => {
    if (!exam) {
      lastSyncedOperationLabel.value = null
      operationAmountDraft.value = ''
      emit('update:operationAmountFcfa', null)
      return
    }
    const sameLabel = lastSyncedOperationLabel.value === exam.label
    lastSyncedOperationLabel.value = exam.label
    if (sameLabel && props.operationAmountFcfa != null && props.operationAmountFcfa >= 0) {
      operationAmountDraft.value = String(props.operationAmountFcfa)
      return
    }
    const fromParent =
      props.operationAmountFcfa != null && Number.isFinite(props.operationAmountFcfa)
        ? Math.max(0, Math.round(props.operationAmountFcfa))
        : null
    const amount = fromParent ?? Math.max(0, Math.round(exam.priceFcfa || 0))
    operationAmountDraft.value = String(amount)
    emit('update:operationAmountFcfa', amount)
  },
  { immediate: true },
)

watch(
  () => props.operationAmountFcfa,
  (amount) => {
    if (!cartOperationExam.value) return
    if (amount == null) {
      if (operationAmountDraft.value !== '') return
      return
    }
    const next = String(Math.max(0, Math.round(amount)))
    if (operationAmountDraft.value !== next) {
      operationAmountDraft.value = next
    }
  },
)

watch(
  consultationSelected,
  (selected) => {
    if (selected && props.showConsultation && !props.hideConsultationTab) {
      activePanel.value = 'consultation'
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="multi-exam-picker">
    <div class="multi-exam-picker__summary">
      <div class="multi-exam-picker__summary-head">
        <ShoppingBag :size="16" />
        <span>{{ uiText('Examens sélectionnés') }}</span>
        <strong>{{ totalCount }}</strong>
      </div>

      <p v-if="!totalCount && !showComments" class="multi-exam-picker__summary-empty">
        {{ uiText('Aucun examen pour l’instant — choisissez une catégorie ci-dessous.') }}
      </p>
      <p
        v-else-if="
          !totalCount &&
          showComments &&
          !summaryKinds.length
        "
        class="multi-exam-picker__summary-empty"
      >
        {{ uiText('Aucun examen pour l’instant — choisissez une catégorie ci-dessous.') }}
      </p>

      <div v-else class="multi-exam-picker__sections">
        <section v-if="consultationSelected" class="multi-exam-picker__section">
          <h4>{{ uiText('Consultation') }}</h4>
          <div class="multi-exam-picker__chips">
            <button
              type="button"
              class="multi-exam-picker__chip"
              :disabled="hideConsultationTab"
              :title="
                hideConsultationTab
                  ? uiText('Consultation en cours')
                  : uiText('Retirer')
              "
              @click="clearConsultation"
            >
              <span>{{ uiText(CLINICAL_CONSULTATION_EXAM_LABEL) }}</span>
              <X v-if="!hideConsultationTab" :size="13" aria-hidden="true" />
            </button>
          </div>
        </section>
        <section
          v-for="kind in summaryKinds"
          :key="`summary-${kind}`"
          class="multi-exam-picker__section"
        >
          <h4>{{ kindLabel(kind) }}</h4>
          <div v-if="kindCount(kind)" class="multi-exam-picker__chips">
            <button
              v-for="group in kindSummaryGroups(kind)"
              :key="`${kind}-${group.panel}`"
              type="button"
              class="multi-exam-picker__chip multi-exam-picker__chip--panel"
              :title="
                formatPanelGroupDetails(group) ||
                (group.items.length > 1
                  ? group.items.map((item) => item.chip).join(' · ')
                  : uiText('Retirer'))
              "
              @click="removePanelGroup(kind, group.items.map((item) => item.raw))"
            >
              <span>{{ uiText(group.panel) }} ({{ group.items.length }})</span>
              <X :size="13" aria-hidden="true" />
            </button>
          </div>
          <p v-if="showCommentForKind(kind) && kindComment(kind)" class="multi-exam-picker__summary-comment">
            <MessageSquare :size="13" />
            {{ kindComment(kind) }}
          </p>
        </section>
      </div>
    </div>

    <div class="multi-exam-picker__tabs" role="tablist" :aria-label="uiText('Types d\'examens')">
      <button
        v-if="showConsultation && !hideConsultationTab"
        type="button"
        class="multi-exam-picker__tab multi-exam-picker__tab--consultation"
        :class="{ 'multi-exam-picker__tab--active': activePanel === 'consultation' }"
        role="tab"
        :aria-selected="activePanel === 'consultation'"
        :disabled="consultationAlreadyPrescribed && !consultationSelected"
        @click="selectConsultation"
      >
        <ClipboardList :size="15" />
        {{ uiText('Consultation') }}
        <span v-if="consultationSelected" class="multi-exam-picker__badge">1</span>
        <span
          v-else-if="consultationAlreadyPrescribed"
          class="multi-exam-picker__badge multi-exam-picker__badge--muted"
          :title="uiText('Déjà prescrite')"
        >
          ✓
        </span>
      </button>

      <button
        v-for="svc in specialtyTabs"
        :key="`specialty-${svc.id}`"
        type="button"
        class="multi-exam-picker__tab"
        :class="{ 'multi-exam-picker__tab--active': activePanel === `specialty:${svc.id}` }"
        role="tab"
        :aria-selected="activePanel === `specialty:${svc.id}`"
        @click="selectSpecialtyService(svc.id)"
      >
        <component
          :is="specialtyTabUsesOperations(svc) ? Scissors : Stethoscope"
          :size="15"
        />
        {{ uiText(svc.name) }}
        <span v-if="specialtyServiceCount(svc.id)" class="multi-exam-picker__badge">
          {{ specialtyServiceCount(svc.id) }}
        </span>
      </button>

      <button
        v-for="kind in visibleKinds"
        :key="kind"
        type="button"
        class="multi-exam-picker__tab"
        :class="{ 'multi-exam-picker__tab--active': activePanel === kind }"
        role="tab"
        :aria-selected="activePanel === kind"
        @click="selectKind(kind)"
      >
        <component :is="kindIcons[kind]" :size="15" />
        {{ kindLabel(kind) }}
        <span v-if="kindCount(kind)" class="multi-exam-picker__badge">{{ kindCount(kind) }}</span>
        <span
          v-else-if="showCommentForKind(kind) && kindComment(kind)"
          class="multi-exam-picker__comment-dot"
          :title="uiText('Commentaire saisi')"
        />
      </button>
    </div>

    <div v-if="!catalogReady" class="multi-exam-picker__loading">{{ uiText('Chargement des catalogues…') }}</div>

    <template v-else>
      <div
        v-if="
          activeSpecialtyClinicServiceId &&
          activeSpecialtyTab() &&
          !activeSpecialtyTab()!.hasExams &&
          !activeSpecialtyTab()!.hasOperations
        "
        class="multi-exam-picker__empty-service"
      >
        <p class="multi-exam-picker__consultation-title">{{ uiText(activeSpecialtyTab()!.name) }}</p>
        <p class="multi-exam-picker__consultation-hint">
          {{
            uiText(
              'Aucune nomenclature liée pour l’instant. Ajoutez des examens (nomenclature médecin) ou des types d’opérations pour ce service.',
            )
          }}
        </p>
      </div>

      <div v-else-if="activePanel === 'consultation'" class="multi-exam-picker__consultation">
        <p class="multi-exam-picker__consultation-title">{{ uiText('Consultation clinique') }}</p>
        <p class="multi-exam-picker__consultation-hint">
          {{ uiText('Notes cliniques et ordonnance — sans envoi labo.') }}
        </p>
        <button
          v-if="consultationSelected && !consultationAlreadyPrescribed"
          type="button"
          class="multi-exam-picker__consultation-clear"
          @click="clearConsultation"
        >
          {{ uiText('Retirer la consultation') }}
        </button>
        <p v-else-if="consultationAlreadyPrescribed" class="multi-exam-picker__consultation-hint">
          {{ uiText('Une consultation est déjà enregistrée sur ce dossier.') }}
        </p>
      </div>

      <ExamPrescriptionPicker
        v-else
        :key="`${activePanel}-${activeKind}-${doctorId ?? ''}-${serviceId ?? ''}`"
        :kind="activeKind"
        :model-value="
          String(activePanel).startsWith('specialty:')
            ? activeSpecialtyCart
            : activeKind === 'specialty'
              ? specialtySummaryExams
              : examsByKind[activeKind]
        "
        :exclude-labels="[
          ...(excludeByKind?.[activeKind] ?? []),
          ...(activeKind === 'specialty' ? [CLINICAL_CONSULTATION_EXAM_LABEL] : []),
        ]"
        :hospitalisation-days="prescribedHospitalisationDays"
        :doctor-id="doctorId"
        :service-id="serviceId"
        :clinic-service-id="activeSpecialtyClinicServiceId"
        @update:model-value="onActivePickerUpdate"
        @update:hospitalisation-days="prescribedHospitalisationDays = $event"
      />

      <section
        v-if="showOperationPricePanel && cartOperationExam"
        class="multi-exam-picker__price"
      >
        <header class="multi-exam-picker__price-head">
          <h4>{{ uiText('Montant de l’opération') }}</h4>
          <p>
            {{
              translateTemplate('Prix modifiable pour « {op} » — les parts appliquent les % définis.', {
                op: cartOperationExam.label,
              })
            }}
          </p>
        </header>

        <UiInput
          :model-value="operationAmountDraft"
          :label="uiText('Montant (FCFA)')"
          type="number"
          min="0"
          step="1"
          @update:model-value="onOperationAmountInput"
        />

        <ul v-if="operationSharePreview" class="multi-exam-picker__shares">
          <li>
            <span>
              {{ uiText('Part chirurgien') }}
              ({{ operationSharePreview.surgeonPct }} %)
            </span>
            <strong dir="ltr">{{ formatFcfa(operationSharePreview.surgeonShareFcfa) }}</strong>
          </li>
          <li v-if="operationSharePreview.hasAssistant">
            <span>
              {{ uiText('Part assistant') }}
              ({{ operationSharePreview.assistantPct }} %)
            </span>
            <strong dir="ltr">{{ formatFcfa(operationSharePreview.assistantShareFcfa) }}</strong>
          </li>
          <li>
            <span>
              {{ uiText('Part clinique') }}
              ({{ operationSharePreview.clinicPct }} %)
            </span>
            <strong dir="ltr">{{ formatFcfa(operationSharePreview.clinicShareFcfa) }}</strong>
          </li>
        </ul>
      </section>

      <section
        v-if="showOperationAssistantPanel && selectedOperationExam"
        class="multi-exam-picker__assistant"
      >
        <header class="multi-exam-picker__assistant-head">
          <h4>{{ uiText('Assistant chirurgie') }}</h4>
          <p>
            {{
              selectedOperationExam.hasAssistant
                ? translateTemplate('Déjà lié à « {op} » — vous pouvez modifier.', {
                    op: selectedOperationExam.label,
                  })
                : translateTemplate('Aucun assistant sur « {op} » — liez-en un maintenant.', {
                    op: selectedOperationExam.label,
                  })
            }}
          </p>
        </header>

        <p v-if="selectedOperationExam.hasAssistant" class="multi-exam-picker__assistant-current">
          {{
            selectedOperationExam.anesthesiologistName
              ? translateTemplate('Actuel : {name} ({pct} %)', {
                  name: selectedOperationExam.anesthesiologistName,
                  pct: selectedOperationExam.anesthesiologistPercent ?? 0,
                })
              : translateTemplate('Actuel : assistant ({pct} %)', {
                  pct: selectedOperationExam.anesthesiologistPercent ?? 0,
                })
          }}
        </p>

        <label class="multi-exam-picker__assistant-toggle">
          <input v-model="assistantForm.withAssistant" type="checkbox" />
          {{ uiText('Inclure un assistant chirurgie pour cette opération') }}
        </label>

        <template v-if="assistantForm.withAssistant">
          <div class="multi-exam-picker__assistant-modes">
            <button
              type="button"
              class="multi-exam-picker__assistant-mode"
              :class="{
                'multi-exam-picker__assistant-mode--active': assistantForm.mode === 'select',
              }"
              @click="assistantForm.mode = 'select'; assistantForm.name = ''"
            >
              {{ uiText('Médecin enregistré') }}
            </button>
            <button
              type="button"
              class="multi-exam-picker__assistant-mode"
              :class="{
                'multi-exam-picker__assistant-mode--active': assistantForm.mode === 'custom',
              }"
              @click="assistantForm.mode = 'custom'; assistantForm.doctorId = ''"
            >
              {{ uiText('Autre (saisie libre)') }}
            </button>
          </div>
          <div class="multi-exam-picker__assistant-grid">
            <UiSelect
              v-if="assistantForm.mode === 'select'"
              v-model="assistantForm.doctorId"
              :label="uiText('Assistant chirurgie')"
            >
              <option value="">{{ uiText('— Sélectionner —') }}</option>
              <option v-for="doctor in assistantDoctors" :key="doctor.id" :value="doctor.id">
                {{ doctorOptionLabel(doctor) }}
              </option>
            </UiSelect>
            <UiInput
              v-else
              v-model="assistantForm.name"
              :label="uiText('Nom assistant chirurgie')"
              placeholder="Nom de l'assistant"
            />
            <UiInput
              v-model="assistantForm.percent"
              :label="uiText('% Assistant chirurgie')"
              type="number"
              min="1"
              max="99"
            />
          </div>
        </template>

        <p
          v-if="assistantMessage"
          class="multi-exam-picker__assistant-msg"
          :class="`multi-exam-picker__assistant-msg--${assistantMessageType}`"
        >
          {{ assistantMessage }}
        </p>

        <UiButton
          type="button"
          size="sm"
          variant="secondary"
          :loading="assistantSaving"
          @click="saveOperationAssistant"
        >
          {{
            assistantForm.withAssistant
              ? uiText('Enregistrer l’assistant sur cette opération')
              : uiText('Retirer l’assistant')
          }}
        </UiButton>
      </section>

      <UiTextarea
        v-if="activePanel !== 'consultation' && showCommentForKind(activeKind)"
        v-model="activeComment"
        class="multi-exam-picker__comment"
        :label="activeCommentLabel"
        :rows="2"
        :placeholder="activeCommentPlaceholder"
      />
    </template>
  </div>
</template>

<style scoped>
.multi-exam-picker {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.multi-exam-picker__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.25rem;
  border-radius: 10px;
  background: var(--surface-muted);
  border: 1px solid var(--primary-100);
  max-height: 7.5rem;
  overflow-y: auto;
}

.multi-exam-picker__tab {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.7rem;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.multi-exam-picker__tab:hover:not(:disabled) {
  background: var(--primary-50);
  color: var(--primary-800);
}

.multi-exam-picker__tab:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.multi-exam-picker__tab--active {
  background: #fff;
  color: var(--primary-800);
  border-color: var(--primary-200);
  box-shadow: 0 1px 4px rgba(94, 16, 27, 0.08);
}

.multi-exam-picker__tab--consultation.multi-exam-picker__tab--active {
  border-color: var(--brand-red);
  color: var(--brand-red);
}

.multi-exam-picker__badge {
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.3rem;
  border-radius: 999px;
  background: var(--brand-red-700, #b71c1c);
  color: #fff;
  font-size: 0.6875rem;
  line-height: 1.25rem;
  text-align: center;
  font-weight: 700;
}

.multi-exam-picker__badge--muted {
  background: var(--text-light);
}

.multi-exam-picker__comment-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: var(--accent-500);
}

.multi-exam-picker__loading {
  font-size: 0.875rem;
  color: var(--text-muted);
  padding: 0.5rem 0;
}

.multi-exam-picker__consultation {
  padding: 0.85rem 1rem;
  border: 1px dashed var(--primary-200);
  border-radius: var(--radius-sm);
  background: linear-gradient(180deg, var(--primary-50), #fff);
}

.multi-exam-picker__consultation-title {
  margin: 0 0 0.35rem;
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--primary-800);
}

.multi-exam-picker__consultation-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.45;
}

.multi-exam-picker__consultation-clear {
  margin-top: 0.65rem;
  border: 1px solid var(--primary-200);
  border-radius: 8px;
  background: #fff;
  color: var(--primary-800);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  padding: 0.4rem 0.7rem;
  cursor: pointer;
}

.multi-exam-picker__comment :deep(.ui-field) {
  margin-bottom: 0;
}

.multi-exam-picker__summary {
  border: 1.5px solid var(--primary-200);
  border-radius: var(--radius-sm);
  background: linear-gradient(180deg, var(--primary-50), #fff);
  padding: 0.75rem 0.85rem;
  border-left: 3px solid var(--brand-red);
}

.multi-exam-picker__summary-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.55rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--primary-800);
}

.multi-exam-picker__summary-head strong {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  height: 1.5rem;
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--primary-600);
  color: #fff;
  font-size: 0.75rem;
}

.multi-exam-picker__summary-empty {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.45;
}

.multi-exam-picker__sections {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.multi-exam-picker__section h4 {
  margin: 0 0 0.35rem;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-light);
}

.multi-exam-picker__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.multi-exam-picker__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: 100%;
  padding: 0.4rem 0.55rem 0.4rem 0.7rem;
  border: 1px solid var(--primary-200);
  border-radius: 999px;
  background: #fff;
  color: var(--primary-800);
  font: inherit;
  font-size: 0.75rem;
  font-weight: 650;
  line-height: 1.25;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.multi-exam-picker__chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 14rem;
}

.multi-exam-picker__chip-qty {
  flex-shrink: 0;
  min-width: 1.2rem;
  height: 1.2rem;
  padding: 0 0.3rem;
  border-radius: 999px;
  background: var(--primary-600);
  color: #fff;
  font-style: normal;
  font-size: 0.6875rem;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.multi-exam-picker__chip svg {
  flex-shrink: 0;
  opacity: 0.65;
}

.multi-exam-picker__chip:hover:not(:disabled) {
  background: var(--primary-100);
  border-color: var(--primary-300);
}

.multi-exam-picker__chip:hover:not(:disabled) svg {
  opacity: 1;
  color: var(--danger, #b91c1c);
}

.multi-exam-picker__chip:disabled {
  cursor: default;
  padding-right: 0.7rem;
  opacity: 0.9;
}

.multi-exam-picker__summary-comment {
  display: flex;
  align-items: flex-start;
  gap: 0.35rem;
  margin: 0.35rem 0 0;
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  background: var(--accent-50);
  border: 1px solid var(--accent-100);
  font-size: 0.8125rem;
  color: var(--text);
  line-height: 1.45;
}

.multi-exam-picker__summary-comment svg {
  color: var(--accent-600);
  flex-shrink: 0;
  margin-top: 0.1rem;
}

.multi-exam-picker__price {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  border: 1px solid rgba(14, 116, 74, 0.16);
  background: linear-gradient(180deg, rgba(14, 116, 74, 0.05), #fff);
}

.multi-exam-picker__price-head h4 {
  margin: 0 0 0.25rem;
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--text);
}

.multi-exam-picker__price-head p {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.4;
}

.multi-exam-picker__shares {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.multi-exam-picker__shares li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.8125rem;
  color: var(--text);
}

.multi-exam-picker__shares strong {
  font-weight: 700;
  white-space: nowrap;
}

.multi-exam-picker__assistant {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  border: 1px solid rgba(27, 79, 156, 0.14);
  background: linear-gradient(180deg, rgba(27, 79, 156, 0.04), #fff);
}

.multi-exam-picker__assistant-head h4 {
  margin: 0 0 0.25rem;
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--text);
}

.multi-exam-picker__assistant-head p {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.4;
}

.multi-exam-picker__assistant-current {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--primary-700, #1b4f9c);
}

.multi-exam-picker__assistant-toggle {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}

.multi-exam-picker__assistant-modes {
  display: inline-flex;
  gap: 0.35rem;
  padding: 0.2rem;
  border-radius: 10px;
  background: rgba(15, 40, 80, 0.05);
  width: fit-content;
}

.multi-exam-picker__assistant-mode {
  border: 0;
  background: transparent;
  border-radius: 8px;
  padding: 0.4rem 0.7rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
}

.multi-exam-picker__assistant-mode--active {
  background: #fff;
  color: var(--text);
  box-shadow: 0 1px 3px rgba(15, 40, 80, 0.12);
}

.multi-exam-picker__assistant-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.multi-exam-picker__assistant-msg {
  margin: 0;
  font-size: 0.8125rem;
}

.multi-exam-picker__assistant-msg--success {
  color: #15803d;
}

.multi-exam-picker__assistant-msg--error {
  color: #b91c1c;
}

@media (max-width: 639px) {
  .multi-exam-picker__assistant-grid {
    grid-template-columns: 1fr;
  }
}
</style>
