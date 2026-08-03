<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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
} from '@lucide/vue'
import ExamPrescriptionPicker from '@/components/ExamPrescriptionPicker.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import {
  EXAM_KIND_LABELS,
  EXAM_KIND_ORDER,
  INVOICE_EXAM_COMMENT_KINDS,
  countExamsByKind,
  emptyExamCommentsByKind,
  getCatalogForKind,
  getSpecialtyServiceName,
  getSpecialtyServices,
  loadExamCatalog,
  type ExamCommentsByKind,
  type ExamKindSlug,
  type ExamsByKind,
  type SpecialtyServiceInfo,
} from '@/lib/exam-catalog'
import {
  CLINICAL_CONSULTATION_EXAM_LABEL,
  hasClinicalConsultationSelected,
} from '@/lib/lab-notes'
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
  }>(),
  {
    comments: () => emptyExamCommentsByKind(),
    showComments: true,
    commentKinds: () => INVOICE_EXAM_COMMENT_KINDS,
    hospitalisationDays: null,
    showConsultation: true,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: ExamsByKind]
  'update:comments': [value: ExamCommentsByKind]
  'update:hospitalisationDays': [value: number | null]
  'active-service-change': [
    payload: {
      kind: ExamKindSlug | 'consultation' | null
      clinicServiceId: string | null
      clinicServiceName: string | null
    },
  ]
}>()

const { uiText, localeCode } = useAppI18n()

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
  const tabs = props.showConsultation
    ? specialtyServiceTabs.value.filter((svc) => svc.hasExams || svc.hasOperations)
    : specialtyServiceTabs.value
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
  await loadExamCatalog({
    doctorId: props.doctorId,
    serviceId: props.serviceId,
    force: true,
  })
  specialtyExamCount.value = getCatalogForKind('specialty', props.doctorId, props.serviceId).filter(
    (exam) => exam.label !== CLINICAL_CONSULTATION_EXAM_LABEL,
  ).length
  specialtyServiceLabel.value = getSpecialtyServiceName(props.doctorId, props.serviceId)
  // Garder les services avec examens OU opérations (Tromatologie = ops seulement)
  specialtyServiceTabs.value = getSpecialtyServices(props.doctorId, props.serviceId)
  catalogEpoch.value += 1
  catalogReady.value = true

  if (activePanel.value === 'consultation') {
    if (!props.showConsultation) {
      activePanel.value = specialtyTabs.value[0]
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
  if (specialtyTabs.value.length > 0 && (activePanel.value === 'examen' || !props.showConsultation)) {
    if (activePanel.value === 'examen' || !visibleKinds.value.includes(activePanel.value as ExamKindSlug)) {
      activePanel.value = `specialty:${specialtyTabs.value[0].id}`
      return
    }
  }
  if (visibleKinds.value.includes('specialty') && activePanel.value === 'examen') {
    activePanel.value = 'specialty'
    return
  }
  if (
    !String(activePanel.value).startsWith('specialty:') &&
    !visibleKinds.value.includes(activePanel.value as ExamKindSlug)
  ) {
    if (visibleKinds.value[0]) {
      activePanel.value = visibleKinds.value[0]
    } else if (specialtyTabs.value[0]) {
      activePanel.value = `specialty:${specialtyTabs.value[0].id}`
    } else {
      activePanel.value = 'examen'
    }
  }
}

const emptyCartHint = computed(() => {
  void localeCode.value
  return uiText(
    'Aucun examen sélectionné — choisissez Consultation, ou un type : laboratoire, radio, écho…',
  )
})

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
  return examsByKind.value[kind]?.length ?? 0
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

onMounted(async () => {
  await refreshCatalogState()
})

watch(
  () => [props.doctorId, props.serviceId] as const,
  async () => {
    await refreshCatalogState()
  },
)

watch(
  consultationSelected,
  (selected) => {
    if (selected && props.showConsultation) activePanel.value = 'consultation'
  },
  { immediate: true },
)
</script>

<template>
  <div class="multi-exam-picker">
    <div class="multi-exam-picker__tabs" role="tablist" :aria-label="uiText('Types d\'examens')">
      <button
        v-if="showConsultation"
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
          {{
            uiText(
              'Paiement déjà effectué à la réception — aucun labo. Complétez les informations cliniques et l’ordonnance pharmacie ci-dessous.',
            )
          }}
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

      <UiTextarea
        v-if="activePanel !== 'consultation' && showCommentForKind(activeKind)"
        v-model="activeComment"
        class="multi-exam-picker__comment"
        :label="activeCommentLabel"
        :rows="2"
        :placeholder="activeCommentPlaceholder"
      />
    </template>

    <div class="multi-exam-picker__summary">
      <div class="multi-exam-picker__summary-head">
        <ShoppingBag :size="16" />
        <span>{{ uiText('Panier global') }}</span>
        <strong>{{ totalCount }}</strong>
      </div>

      <p v-if="!totalCount && !showComments" class="multi-exam-picker__summary-empty">
        {{ emptyCartHint }}
      </p>
      <p
        v-else-if="
          !totalCount &&
          showComments &&
          !visibleKinds.some((kind) => showCommentForKind(kind) && kindComment(kind))
        "
        class="multi-exam-picker__summary-empty"
      >
        {{ emptyCartHint }}
      </p>

      <div v-else class="multi-exam-picker__sections">
        <section v-if="consultationSelected">
          <h4>{{ uiText('Consultation') }}</h4>
          <ul>
            <li>{{ uiText(CLINICAL_CONSULTATION_EXAM_LABEL) }}</li>
          </ul>
        </section>
        <section
          v-for="kind in visibleKinds"
          :key="`summary-${kind}`"
          v-show="kindCount(kind) || (showCommentForKind(kind) && kindComment(kind))"
        >
          <h4>{{ kindLabel(kind) }}</h4>
          <ul v-if="kindCount(kind)">
            <li
              v-for="exam in kind === 'specialty' ? specialtySummaryExams : examsByKind[kind]"
              :key="`${kind}-${exam}`"
            >
              {{ uiText(exam) }}
            </li>
          </ul>
          <p v-if="showCommentForKind(kind) && kindComment(kind)" class="multi-exam-picker__summary-comment">
            <MessageSquare :size="13" />
            {{ kindComment(kind) }}
          </p>
        </section>
      </div>
    </div>
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
  background: var(--primary-600);
  color: #fff;
  font-size: 0.6875rem;
  line-height: 1.25rem;
  text-align: center;
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
  padding: 0.85rem 1rem;
  border-left: 3px solid var(--brand-red);
}

.multi-exam-picker__summary-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.65rem;
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
  gap: 0.65rem;
}

.multi-exam-picker__sections h4 {
  margin: 0 0 0.25rem;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-light);
}

.multi-exam-picker__sections ul {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.8125rem;
  color: var(--text);
}

.multi-exam-picker__sections li + li {
  margin-top: 0.15rem;
}

.multi-exam-picker__summary-comment {
  display: flex;
  align-items: flex-start;
  gap: 0.35rem;
  margin: 0.35rem 0 0;
  padding: 0.45rem 0.55rem;
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
</style>
