<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { FlaskConical, ScanLine, Waves, Smile, ShoppingBag, MessageSquare, Scissors, BedDouble } from '@lucide/vue'
import ExamPrescriptionPicker from '@/components/ExamPrescriptionPicker.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import {
  EXAM_KIND_LABELS,
  EXAM_KIND_ORDER,
  INVOICE_EXAM_COMMENT_KINDS,
  countExamsByKind,
  emptyExamCommentsByKind,
  loadExamCatalog,
  type ExamCommentsByKind,
  type ExamKindSlug,
  type ExamsByKind,
} from '@/lib/exam-catalog'

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
  }>(),
  {
    comments: () => emptyExamCommentsByKind(),
    showComments: true,
    commentKinds: () => INVOICE_EXAM_COMMENT_KINDS,
    hospitalisationDays: null,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: ExamsByKind]
  'update:comments': [value: ExamCommentsByKind]
  'update:hospitalisationDays': [value: number | null]
}>()

const activeKind = ref<ExamKindSlug>('examen')
const catalogReady = ref(false)

const visibleKinds = computed(() => props.kinds ?? EXAM_KIND_ORDER)

const examsByKind = computed({
  get: () => props.modelValue,
  set: (value: ExamsByKind) => emit('update:modelValue', value),
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
  return examsByKind.value[kind]?.length ?? 0
}

function kindComment(kind: ExamKindSlug) {
  return commentsByKind.value[kind]?.trim() ?? ''
}

onMounted(async () => {
  await loadExamCatalog()
  catalogReady.value = true
  if (!visibleKinds.value.includes(activeKind.value)) {
    activeKind.value = visibleKinds.value[0] ?? 'examen'
  }
})
</script>

<template>
  <div class="multi-exam-picker">
    <div class="multi-exam-picker__tabs" role="tablist" aria-label="Types d'examens">
      <button
        v-for="kind in visibleKinds"
        :key="kind"
        type="button"
        class="multi-exam-picker__tab"
        :class="{ 'multi-exam-picker__tab--active': activeKind === kind }"
        role="tab"
        :aria-selected="activeKind === kind"
        @click="activeKind = kind"
      >
        <component :is="kindIcons[kind]" :size="15" />
        {{ EXAM_KIND_LABELS[kind] }}
        <span v-if="kindCount(kind)" class="multi-exam-picker__badge">{{ kindCount(kind) }}</span>
        <span v-else-if="showCommentForKind(kind) && kindComment(kind)" class="multi-exam-picker__comment-dot" title="Commentaire saisi" />
      </button>
    </div>

    <div v-if="!catalogReady" class="multi-exam-picker__loading">Chargement des catalogues…</div>

    <template v-else>
      <ExamPrescriptionPicker
        :key="activeKind"
        :kind="activeKind"
        :model-value="examsByKind[activeKind]"
        :exclude-labels="excludeByKind?.[activeKind] ?? []"
        :hospitalisation-days="prescribedHospitalisationDays"
        @update:model-value="updateKind(activeKind, $event)"
        @update:hospitalisation-days="prescribedHospitalisationDays = $event"
      />

      <UiTextarea
        v-if="showCommentForKind(activeKind)"
        v-model="activeComment"
        class="multi-exam-picker__comment"
        :label="`Commentaire — ${EXAM_KIND_LABELS[activeKind]}`"
        :rows="2"
        :placeholder="`Indications ou remarques pour les examens ${EXAM_KIND_LABELS[activeKind].toLowerCase()}…`"
      />
    </template>

    <div class="multi-exam-picker__summary">
      <div class="multi-exam-picker__summary-head">
        <ShoppingBag :size="16" />
        <span>Panier global</span>
        <strong>{{ totalCount }}</strong>
      </div>

      <p v-if="!totalCount && !showComments" class="multi-exam-picker__summary-empty">
        Aucun examen sélectionné — choisissez par type : laboratoire, radio, écho, odonto, opération ou hospitalisation.
      </p>
      <p
        v-else-if="!totalCount && showComments && !visibleKinds.some((kind) => showCommentForKind(kind) && kindComment(kind))"
        class="multi-exam-picker__summary-empty"
      >
        Aucun examen sélectionné — choisissez par type : laboratoire, radio, écho, odonto, opération ou hospitalisation.
      </p>

      <div v-else class="multi-exam-picker__sections">
        <section
          v-for="kind in visibleKinds"
          :key="`summary-${kind}`"
          v-show="kindCount(kind) || (showCommentForKind(kind) && kindComment(kind))"
        >
          <h4>{{ EXAM_KIND_LABELS[kind] }}</h4>
          <ul v-if="kindCount(kind)">
            <li v-for="exam in examsByKind[kind]" :key="`${kind}-${exam}`">{{ exam }}</li>
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

.multi-exam-picker__tab:hover {
  background: var(--primary-50);
  color: var(--primary-800);
}

.multi-exam-picker__tab--active {
  background: #fff;
  color: var(--primary-800);
  border-color: var(--primary-200);
  box-shadow: 0 1px 4px rgba(94, 16, 27, 0.08);
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
