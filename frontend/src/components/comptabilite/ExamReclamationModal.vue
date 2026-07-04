<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import axios from 'axios'
import { AlertCircle, CheckCircle2 } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import { EXAM_KIND_LABELS, EXAM_KIND_ORDER, type ExamKindSlug } from '@/lib/exam-catalog/types'
import {
  EXAM_RECLAMATION_REASON_LABELS,
  EXAM_RECLAMATION_STATUS_LABELS,
  type ExamReclamationReason,
  type ExamReclamationRow,
} from '@/lib/exam-reclamation'
import { normalizeLabExamPendingItem, type LabExamPendingItem } from '@/lib/lab-exam-pending'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiAlert from '@/components/ui/UiAlert.vue'

const props = defineProps<{
  item: LabExamPendingItem | null
}>()

const emit = defineEmits<{
  close: []
  submitted: [row: ExamReclamationRow]
}>()

const open = defineModel<boolean>('open', { default: false })

const selectedKeys = ref<Set<string>>(new Set())
const reason = ref<ExamReclamationReason>('EXAM_MISSING')
const reasonDetail = ref('')
const submitting = ref(false)
const error = ref('')
const success = ref(false)
const createdReclamation = ref<ExamReclamationRow | null>(null)

const normalized = computed(() => (props.item ? normalizeLabExamPendingItem(props.item) : null))

type ExamOption = {
  key: string
  kind: ExamKindSlug
  label: string
  unitPriceFcfa: number
}

const examOptions = computed<ExamOption[]>(() => {
  if (!normalized.value) return []
  const options: ExamOption[] = []
  const paidKinds = props.item?.paidKinds?.length
    ? props.item.paidKinds
    : EXAM_KIND_ORDER.filter((kind) => (normalized.value!.examsByKind[kind]?.lines.length ?? 0) > 0)

  for (const kind of paidKinds) {
    const lines =
      normalized.value.allExamsByKind?.[kind]?.lines ??
      normalized.value.examsByKind[kind]?.lines ??
      []
    for (const line of lines) {
      options.push({
        key: `${kind}::${line.label}`,
        kind,
        label: line.label,
        unitPriceFcfa: line.unitPriceFcfa,
      })
    }
  }
  return options
})

const selectedExams = computed(() =>
  examOptions.value.filter((option) => selectedKeys.value.has(option.key)),
)

const selectedTotalFcfa = computed(() =>
  selectedExams.value.reduce((sum, exam) => sum + exam.unitPriceFcfa, 0),
)

const allSelected = computed(
  () => examOptions.value.length > 0 && selectedKeys.value.size === examOptions.value.length,
)

const patientLabel = computed(() => {
  if (!props.item) return ''
  const p = props.item.visit.patient
  return `${fullName(p.firstName, p.lastName)} — ${p.code}`
})

const reasonOptions = computed(() =>
  (Object.entries(EXAM_RECLAMATION_REASON_LABELS) as [ExamReclamationReason, string][]).map(
    ([value, label]) => ({ value, label }),
  ),
)

function resetForm() {
  selectedKeys.value = new Set()
  reason.value = 'EXAM_MISSING'
  reasonDetail.value = ''
  error.value = ''
  success.value = false
  createdReclamation.value = null
}

watch(
  () => [open.value, props.item?.id] as const,
  ([isOpen]) => {
    if (!isOpen || !props.item) return
    resetForm()
  },
)

function toggleExam(key: string) {
  const next = new Set(selectedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedKeys.value = next
}

function toggleSelectAll() {
  if (allSelected.value) {
    selectedKeys.value = new Set()
    return
  }
  selectedKeys.value = new Set(examOptions.value.map((option) => option.key))
}

async function submit() {
  if (!props.item || submitting.value || success.value) return
  if (!selectedExams.value.length) {
    error.value = 'Sélectionnez au moins un examen concerné.'
    return
  }

  submitting.value = true
  error.value = ''
  try {
    const exams = selectedExams.value.map((exam) => ({
      examKind: exam.kind,
      examLabel: exam.label.trim(),
      unitPriceFcfa: Math.floor(Number(exam.unitPriceFcfa) || 0),
    }))
    if (exams.some((exam) => !exam.examLabel || exam.unitPriceFcfa < 0)) {
      error.value = 'Montant ou libellé manquant pour un examen sélectionné.'
      return
    }

    const { data } = await api.post<ExamReclamationRow>('/comptabilite/exam-reclamations', {
      consultationId: props.item.id,
      exams,
      reason: reason.value,
      reasonDetail: reasonDetail.value.trim() || undefined,
    })
    createdReclamation.value = data
    success.value = true
    emit('submitted', data)
  } catch (e) {
    if (axios.isAxiosError(e)) {
      if (!e.response) {
        error.value =
          'Serveur inaccessible. Vérifiez que le backend est démarré (port 4000).'
        return
      }
      error.value =
        typeof e.response.data?.error === 'string'
          ? e.response.data.error
          : `Envoi impossible (erreur ${e.response.status}).`
      return
    }
    error.value = 'Envoi impossible. Vérifiez les champs et réessayez.'
  } finally {
    submitting.value = false
  }
}

function formatDate(value: string) {
  const date = new Date(value)
  return `${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}

function closeModal() {
  emit('close')
}
</script>

<template>
  <UiFormModal
    v-if="open && item"
    title="Réclamation"
    :subtitle="patientLabel"
    :icon="AlertCircle"
    size="wide"
    @close="closeModal"
  >
    <template v-if="success && createdReclamation">
      <div class="success-block">
        <CheckCircle2 :size="36" class="success-block__icon" />
        <p class="success-block__title">Remboursement appliqué</p>
        <p class="success-block__meta">
          {{ createdReclamation.examLines.length }} examen(s)
          · {{ formatFcfa(createdReclamation.totalFcfa) }} déduit(s)
          · {{ EXAM_RECLAMATION_STATUS_LABELS[createdReclamation.status] }}
        </p>
        <p class="success-block__meta">{{ formatDate(createdReclamation.createdAt) }}</p>
        <p class="success-block__hint">
          Les montants ont été soustraits des factures et les examens retirés du dossier payé.
          Consultez l'historique pour le détail.
        </p>
      </div>
    </template>

    <template v-else>
      <UiAlert v-if="error" type="error" :message="error" />

      <form class="reclamation-form" @submit.prevent="submit">
        <section class="exam-picker">
          <div class="exam-picker__head">
            <span class="exam-picker__title">Examens concernés</span>
            <button
              v-if="examOptions.length > 1"
              type="button"
              class="exam-picker__select-all"
              @click="toggleSelectAll"
            >
              {{ allSelected ? 'Tout désélectionner' : 'Tout sélectionner' }}
            </button>
          </div>

          <p v-if="!examOptions.length" class="exam-picker__empty">Aucun examen payé disponible.</p>

          <div v-else class="exam-picker__table-wrap">
            <table class="exam-picker__table">
              <thead>
                <tr>
                  <th class="exam-picker__col-check" />
                  <th>Examen</th>
                  <th>Type</th>
                  <th class="exam-picker__col-amount">Montant unitaire</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="option in examOptions"
                  :key="option.key"
                  class="exam-picker__row"
                  :class="{ 'exam-picker__row--selected': selectedKeys.has(option.key) }"
                  @click="toggleExam(option.key)"
                >
                  <td class="exam-picker__col-check">
                    <input
                      type="checkbox"
                      :checked="selectedKeys.has(option.key)"
                      :aria-label="`Sélectionner ${option.label}`"
                      @click.stop
                      @change="toggleExam(option.key)"
                    />
                  </td>
                  <td>{{ option.label }}</td>
                  <td class="exam-picker__kind">{{ EXAM_KIND_LABELS[option.kind] }}</td>
                  <td class="exam-picker__col-amount">{{ formatFcfa(option.unitPriceFcfa) }}</td>
                </tr>
              </tbody>
              <tfoot v-if="selectedExams.length">
                <tr class="exam-picker__total-row">
                  <td colspan="3">
                    Total sélectionné ({{ selectedExams.length }} examen{{ selectedExams.length > 1 ? 's' : '' }})
                  </td>
                  <td class="exam-picker__col-amount exam-picker__total">
                    {{ formatFcfa(selectedTotalFcfa) }}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <fieldset class="reason-fieldset">
          <legend>Motif</legend>
          <div class="reason-chips">
            <button
              v-for="option in reasonOptions"
              :key="option.value"
              type="button"
              class="reason-chip"
              :class="{ 'reason-chip--active': reason === option.value }"
              @click="reason = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </fieldset>

        <UiInput
          v-model="reasonDetail"
          label="Commentaire (optionnel)"
          placeholder="Précisez le problème rencontré…"
        />
      </form>
    </template>

    <template #footer>
      <UiButton variant="ghost" @click="closeModal">
        {{ success ? 'Fermer' : 'Annuler' }}
      </UiButton>
      <UiButton
        v-if="!success"
        variant="primary"
        :disabled="submitting || !selectedExams.length"
        @click="submit"
      >
        {{
          submitting
            ? 'Envoi…'
            : `Envoyer (${selectedExams.length} — ${formatFcfa(selectedTotalFcfa)})`
        }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.reclamation-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.exam-picker__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.exam-picker__title {
  font-size: 0.8125rem;
  font-weight: 700;
}

.exam-picker__select-all {
  border: 0;
  background: none;
  padding: 0;
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  color: #0f766e;
  cursor: pointer;
  text-decoration: underline;
}

.exam-picker__empty {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.exam-picker__table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.exam-picker__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.exam-picker__table th,
.exam-picker__table td {
  padding: 0.5rem 0.65rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
}

.exam-picker__table th {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  background: #f8fafc;
}

.exam-picker__col-check {
  width: 2.25rem;
  text-align: center;
}

.exam-picker__col-amount {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.exam-picker__kind {
  color: var(--text-muted);
  font-size: 0.75rem;
}

.exam-picker__row {
  cursor: pointer;
  transition: background 0.12s ease;
}

.exam-picker__row:hover {
  background: #f8fafc;
}

.exam-picker__row--selected {
  background: #f0fdfa;
}

.exam-picker__total-row td {
  font-weight: 700;
  background: #f8fafc;
  border-bottom: 0;
}

.exam-picker__total {
  color: #0f766e;
}

.reason-fieldset {
  margin: 0;
  padding: 0;
  border: 0;
}

.reason-fieldset legend {
  margin-bottom: 0.45rem;
  font-size: 0.8125rem;
  font-weight: 600;
}

.reason-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.reason-chip {
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.reason-chip:hover {
  border-color: #99f6e4;
  color: #0f766e;
}

.reason-chip--active {
  border-color: #0f766e;
  background: #f0fdfa;
  color: #0f766e;
}

.success-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.35rem;
  padding: 0.5rem 0;
}

.success-block__icon {
  color: #16a34a;
}

.success-block__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
}

.success-block__meta {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.success-block__hint {
  margin: 0.5rem 0 0;
  max-width: 28rem;
  font-size: 0.8125rem;
  color: var(--text);
  line-height: 1.45;
}
</style>
