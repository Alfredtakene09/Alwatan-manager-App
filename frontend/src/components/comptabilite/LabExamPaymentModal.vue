<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  MessageSquare,
  X,
  Banknote,
  ScanLine,
  FlaskConical,
  Waves,
  Smile,
  Scissors,
  BedDouble,
  User,
  Phone,
  Stethoscope,
  Calendar,
  ChevronDown,
} from '@lucide/vue'
import { formatFcfa, fullName } from '@/lib/roles'
import { EXAM_KIND_LABELS, type ExamKindSlug } from '@/lib/exam-catalog/types'
import {
  buildExamSheetsFromBlocks,
  computeExamNetFromBlocks,
  emptyExamReductionsByKind,
  examsByKindFromLines,
  isPaymentModalExcludedKind,
  type ExamReductionsByKind,
} from '@/lib/exam-billing'
import { INVOICE_EXAM_COMMENT_KINDS } from '@/lib/exam-catalog/types'
import { parsePrescribedExamCommentsByKind } from '@/lib/lab-notes'
import {
  initLabExamReductionsByKind,
  normalizeLabExamPendingItem,
  EXAM_KIND_REDUCTION_LABELS,
  resolveSingleExamInvoiceDocTitle,
  type LabExamPendingItem,
} from '@/lib/lab-exam-pending'
import { loadExamCatalog } from '@/lib/exam-catalog/store'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'

export type LabExamPaymentItem = LabExamPendingItem

export type LabExamPaymentConfirmPayload = {
  consultationId: string
  kinds: ExamKindSlug[]
  reductionFcfa: number
  reductionsByKind: ExamReductionsByKind
}

const props = defineProps<{
  item: LabExamPaymentItem | null
  submitting?: boolean
  submittingKind?: ExamKindSlug | null
}>()

const emit = defineEmits<{
  close: []
  confirm: [payload: LabExamPaymentConfirmPayload]
}>()

const payingKind = ref<ExamKindSlug | null>(null)

const reductionsByKind = ref<ExamReductionsByKind>(emptyExamReductionsByKind())

const normalizedItem = computed(() =>
  props.item ? normalizeLabExamPendingItem(props.item) : null,
)

watch(
  () => props.item,
  async (item) => {
    if (item) await loadExamCatalog()
    reductionsByKind.value = initLabExamReductionsByKind()
    payingKind.value = null
  },
  { immediate: true },
)

const paidKindSet = computed(() => new Set(normalizedItem.value?.paidKinds ?? []))

const kindCards = computed(() => {
  if (!normalizedItem.value) return []
  const sourceBlocks =
    normalizedItem.value.allExamsByKind &&
    Object.values(normalizedItem.value.allExamsByKind).some((block) => block.lines.length > 0)
      ? normalizedItem.value.allExamsByKind
      : normalizedItem.value.examsByKind

  return buildExamSheetsFromBlocks(sourceBlocks, reductionsByKind.value)
    .filter((sheet) => !isPaymentModalExcludedKind(sheet.kind))
    .map((sheet) => ({
      ...sheet,
      isPaid: paidKindSet.value.has(sheet.kind),
      kindLabel: EXAM_KIND_LABELS[sheet.kind],
      reductionLabel: EXAM_KIND_REDUCTION_LABELS[sheet.kind],
      docTitle: resolveSingleExamInvoiceDocTitle(sheet.kind),
      examCount: sheet.lines.length,
      hasExams: true,
      comment: examCommentsByKind.value[sheet.kind]?.trim() ?? '',
    }))
})

const payableKinds = computed(() =>
  kindCards.value.filter((card) => !card.isPaid).map((card) => card.kind),
)

const examCommentsByKind = computed(() =>
  parsePrescribedExamCommentsByKind(normalizedItem.value?.clinicalNotes),
)

const hasUnpaidHospitalisation = computed(
  () => (normalizedItem.value?.unpaidKinds ?? []).includes('hospitalisation'),
)

const payableExamsByKind = computed(() => {
  if (!normalizedItem.value) {
    return examsByKindFromLines([])
  }
  const blocks = { ...normalizedItem.value.examsByKind }
  for (const kind of Object.keys(blocks) as ExamKindSlug[]) {
    if (isPaymentModalExcludedKind(kind)) {
      blocks[kind] = { lines: [], grossFcfa: 0 }
    }
  }
  return blocks
})

const grossFcfa = computed(() =>
  kindCards.value
    .filter((card) => !card.isPaid)
    .reduce((sum, card) => sum + card.grossFcfa, 0),
)
const totalReductionFcfa = computed(() =>
  kindCards.value
    .filter((card) => !card.isPaid)
    .reduce((sum, card) => sum + card.reductionFcfa, 0),
)
const netFcfa = computed(() =>
  normalizedItem.value
    ? computeExamNetFromBlocks(payableExamsByKind.value, reductionsByKind.value)
    : 0,
)
const activeTypeCount = computed(() => payableKinds.value.length)
const canConfirm = computed(() => payableKinds.value.length > 0 && grossFcfa.value >= 0)

const patientInfo = computed(() => {
  if (!props.item) return null
  const patient = props.item.visit.patient
  return {
    name: fullName(patient.firstName, patient.lastName),
    code: patient.code,
    phone: patient.phone?.trim() || '—',
    doctor: props.item.doctor
      ? `Dr ${fullName(props.item.doctor.firstName, props.item.doctor.lastName)}`
      : 'Patient externe — réception',
    date: new Date(props.item.updatedAt).toLocaleString('fr-FR'),
  }
})

const kindIcons: Record<ExamKindSlug, typeof FlaskConical> = {
  examen: FlaskConical,
  radio: ScanLine,
  echo: Waves,
  odonto: Smile,
  operation: Scissors,
  hospitalisation: BedDouble,
}

function buildPayableReductions(kinds: ExamKindSlug[]): ExamReductionsByKind {
  const reductions = emptyExamReductionsByKind()
  for (const kind of kinds) {
    reductions[kind] = reductionsByKind.value[kind] ?? 0
  }
  return reductions
}

function close() {
  emit('close')
}

function confirmAll() {
  if (!props.item || !canConfirm.value || props.submitting) return
  const kinds = payableKinds.value
  if (!kinds.length) return
  const reductions = buildPayableReductions(kinds)
  const reductionFcfa = kinds.reduce((sum, kind) => sum + (reductions[kind] ?? 0), 0)
  payingKind.value = null
  emit('confirm', {
    consultationId: props.item.id,
    kinds,
    reductionFcfa,
    reductionsByKind: reductions,
  })
}

function confirmKind(kind: ExamKindSlug) {
  if (!props.item) return
  const card = kindCards.value.find((row) => row.kind === kind)
  if (!card?.hasExams || card.isPaid) return
  payingKind.value = kind
  emit('confirm', {
    consultationId: props.item.id,
    kinds: [kind],
    reductionFcfa: reductionsByKind.value[kind] ?? 0,
    reductionsByKind: {
      ...emptyExamReductionsByKind(),
      [kind]: reductionsByKind.value[kind] ?? 0,
    },
  })
}

function kindFollowUpLabel(kind: ExamKindSlug) {
  if (kind === 'operation') return 'Opérations en attente'
  if (kind === 'examen' || kind === 'radio' || kind === 'echo' || kind === 'odonto') return 'Laboratoire'
  return null
}

function updateReduction(kind: ExamKindSlug, value: string | number, max: number) {
  const parsed = Math.min(Math.max(0, Number(value) || 0), max)
  reductionsByKind.value = { ...reductionsByKind.value, [kind]: parsed }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="item && patientInfo" class="modal-overlay" @click.self="close">
      <div class="invoice-modal" role="dialog" aria-modal="true" aria-labelledby="lab-invoice-title">
        <header class="invoice-modal__header">
          <div class="invoice-modal__header-main">
            <p id="lab-invoice-title" class="invoice-modal__title">Encaissement des examens</p>
            <p class="invoice-modal__subtitle">
              Encaissez type par type, ou validez tout en une fois en bas de la fenêtre
            </p>
          </div>
          <button type="button" class="invoice-modal__close" aria-label="Fermer" @click="close">
            <X :size="20" />
          </button>
        </header>

        <div class="invoice-modal__scroll-hint" aria-hidden="true">
          <ChevronDown :size="16" />
          <span>Faites défiler pour voir tous les examens et saisir les réductions par type</span>
        </div>

        <div class="invoice-modal__scroll">
          <section class="patient-panel">
            <div class="patient-panel__item">
              <User :size="16" class="patient-panel__icon" />
              <div>
                <span class="patient-panel__label">Patient</span>
                <strong class="patient-panel__value">{{ patientInfo.name }}</strong>
              </div>
            </div>
            <div class="patient-panel__item">
              <span class="patient-panel__label">Matricule</span>
              <strong class="patient-panel__value patient-panel__value--code">{{ patientInfo.code }}</strong>
            </div>
            <div class="patient-panel__item">
              <Phone :size="16" class="patient-panel__icon" />
              <div>
                <span class="patient-panel__label">Téléphone</span>
                <strong class="patient-panel__value">{{ patientInfo.phone }}</strong>
              </div>
            </div>
            <div class="patient-panel__item">
              <Stethoscope :size="16" class="patient-panel__icon" />
              <div>
                <span class="patient-panel__label">Prescrit par</span>
                <strong class="patient-panel__value">{{ patientInfo.doctor }}</strong>
              </div>
            </div>
            <div class="patient-panel__item">
              <Calendar :size="16" class="patient-panel__icon" />
              <div>
                <span class="patient-panel__label">Date prescription</span>
                <strong class="patient-panel__value">{{ patientInfo.date }}</strong>
              </div>
            </div>
          </section>

          <p v-if="hasUnpaidHospitalisation" class="invoice-modal__hosp-note">
            L'hospitalisation est gérée via le bouton dédié
            <BedDouble :size="14" aria-hidden="true" />
            dans la liste (attribution de salle et admission).
          </p>

          <p v-if="!canConfirm" class="invoice-modal__empty">
            Aucun examen facturable trouvé pour ce dossier.
          </p>

          <article
            v-for="card in kindCards"
            :key="card.kind"
            class="exam-card"
            :class="[
              `exam-card--${card.kind}`,
              { 'exam-card--inactive': card.isPaid },
            ]"
          >
            <header class="exam-card__head">
              <div class="exam-card__head-left">
                <span class="exam-card__kind">
                  <component :is="kindIcons[card.kind]" :size="18" />
                  {{ card.kindLabel }}
                  <span v-if="card.isPaid" class="exam-card__paid-badge">Déjà payé</span>
                </span>
                <span class="exam-card__doc-title">{{ card.docTitle }}</span>
                <span class="exam-card__count">{{ card.examCount }} examen(s)</span>
              </div>
            </header>

            <div class="exam-card__table-wrap">
              <table class="exam-card__table">
                <thead>
                  <tr>
                    <th>Examen</th>
                    <th>Montant (FCFA)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="line in card.lines" :key="`${card.kind}-${line.label}`">
                    <td>{{ line.label }}</td>
                    <td>{{ formatFcfa(line.unitPriceFcfa) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p
              v-if="INVOICE_EXAM_COMMENT_KINDS.includes(card.kind) && card.comment"
              class="exam-card__comment"
            >
              <MessageSquare :size="14" />
              <span>
                <strong>Commentaire — {{ card.kindLabel }}</strong>
                {{ card.comment }}
              </span>
            </p>

            <div class="exam-card__footer">
              <div class="exam-card__amounts">
                <div class="exam-card__amount">
                  <span>{{ card.isPaid ? 'Montant réglé' : 'Sous-total' }}</span>
                  <strong>{{ formatFcfa(card.grossFcfa) }}</strong>
                </div>
                <div v-if="!card.isPaid" class="exam-card__amount exam-card__amount--net">
                  <span>Net à payer</span>
                  <strong>{{ formatFcfa(card.netFcfa) }}</strong>
                </div>
              </div>

              <div
                v-if="!card.isPaid"
                class="exam-card__reduction"
                :class="`exam-card__reduction--${card.kind}`"
              >
                <UiInput
                  :model-value="reductionsByKind[card.kind]"
                  :label="card.reductionLabel"
                  type="number"
                  min="0"
                  :max="card.grossFcfa"
                  placeholder="0"
                  @update:model-value="updateReduction(card.kind, $event, card.grossFcfa)"
                />
                <p v-if="card.reductionFcfa > 0" class="exam-card__reduction-hint">
                  Réduction appliquée : - {{ formatFcfa(card.reductionFcfa) }}
                </p>
              </div>
              <div v-if="!card.isPaid" class="exam-card__pay">
                <UiButton
                  variant="success"
                  size="sm"
                  :icon="Banknote"
                  :disabled="submitting || (submittingKind != null && submittingKind !== card.kind)"
                  @click="confirmKind(card.kind)"
                >
                  {{
                    submitting && (submittingKind === card.kind || payingKind === card.kind)
                      ? 'Validation…'
                      : `Encaisser ${card.kindLabel}`
                  }}
                </UiButton>
                <p v-if="kindFollowUpLabel(card.kind)" class="exam-card__pay-hint">
                  Après paiement → {{ kindFollowUpLabel(card.kind) }}
                </p>
              </div>
            </div>
          </article>
        </div>

        <footer class="invoice-modal__footer">
          <div class="invoice-modal__totals">
            <div class="invoice-modal__totals-row">
              <span>Types en attente</span>
              <strong>{{ activeTypeCount }}</strong>
            </div>
            <div class="invoice-modal__totals-row">
              <span>Total brut (reste à payer)</span>
              <strong>{{ formatFcfa(grossFcfa) }}</strong>
            </div>
            <div class="invoice-modal__totals-row">
              <span>Réductions saisies</span>
              <strong class="invoice-modal__negative">- {{ formatFcfa(totalReductionFcfa) }}</strong>
            </div>
            <div class="invoice-modal__totals-row invoice-modal__totals-row--net">
              <span>Net restant</span>
              <strong>{{ formatFcfa(netFcfa) }}</strong>
            </div>
          </div>
          <div class="invoice-modal__actions">
            <UiButton variant="ghost" size="md" @click="close">Fermer</UiButton>
            <UiButton
              v-if="payableKinds.length >= 1"
              variant="success"
              size="md"
              :icon="Banknote"
              :disabled="submitting || !canConfirm"
              @click="confirmAll"
            >
              {{
                submitting && !submittingKind
                  ? 'Validation en cours…'
                  : `Valider tout (${activeTypeCount} type${activeTypeCount > 1 ? 's' : ''} — ${formatFcfa(netFcfa)})`
              }}
            </UiButton>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.75rem;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(4px);
}

.invoice-modal {
  width: 100%;
  max-width: 44rem;
  height: min(88dvh, 760px);
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.invoice-modal__header {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1.25rem;
  padding: 1rem 1.25rem 0.85rem;
  border-bottom: 1px solid var(--border);
  background: #fff;
}

.invoice-modal__title {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--primary-800);
}

.invoice-modal__subtitle {
  margin: 0.3rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.45;
}

.invoice-modal__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border: 0;
  border-radius: 8px;
  background: #f1f5f9;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.invoice-modal__scroll-hint {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.45rem 1rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  background: #f8fafc;
  border-bottom: 1px solid var(--border);
}

.invoice-modal__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: scroll;
  padding: 0.85rem 1.25rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

.invoice-modal__empty {
  margin: 0;
  padding: 1rem;
  text-align: center;
  color: var(--text-muted);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
}

.invoice-modal__hosp-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  margin: 0;
  padding: 0.65rem 0.85rem;
  font-size: 0.8125rem;
  color: #9a3412;
  background: #fff7ed;
  border: 1px solid #fdba74;
  border-radius: var(--radius-sm);
  line-height: 1.45;
}

.patient-panel {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.75rem 1rem;
  padding: 0.9rem 1rem;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.patient-panel__item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  min-width: 0;
}

.patient-panel__icon {
  flex-shrink: 0;
  margin-top: 0.12rem;
  color: var(--primary-700);
}

.patient-panel__label {
  display: block;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  margin-bottom: 0.12rem;
}

.patient-panel__value {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text);
  line-height: 1.35;
  word-break: break-word;
}

.patient-panel__value--code {
  font-family: ui-monospace, monospace;
  color: var(--primary-800);
}

.exam-card {
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: #fff;
}

.exam-card--examen { border-left: 5px solid #2e7d32; }
.exam-card--radio { border-left: 5px solid #1565c0; }
.exam-card--echo { border-left: 5px solid #c2185b; }
.exam-card--odonto { border-left: 5px solid #e65100; }

.exam-card--inactive {
  opacity: 0.88;
}

.exam-card--inactive .exam-card__head {
  background: #f6f8fa;
}

.exam-card--inactive .exam-card__kind {
  color: var(--text-muted);
}

.exam-card__paid-badge {
  margin-left: 0.35rem;
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
  font-size: 0.625rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  background: #e2e8f0;
  color: #475569;
}

.exam-card__head {
  padding: 0.85rem 1.1rem 0.75rem;
  border-bottom: 1px solid var(--border);
  background: #fafcfd;
}

.exam-card__head-left {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.exam-card__kind {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.875rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.exam-card--examen .exam-card__kind { color: #2e7d32; }
.exam-card--radio .exam-card__kind { color: #1565c0; }
.exam-card--echo .exam-card__kind { color: #c2185b; }
.exam-card--odonto .exam-card__kind { color: #e65100; }

.exam-card__doc-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text);
}

.exam-card__count {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.exam-card__comment {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  margin: 0 1.1rem;
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-sm);
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--text);
}

.exam-card__comment svg {
  flex-shrink: 0;
  margin-top: 0.1rem;
  color: var(--primary-700);
}

.exam-card__comment strong {
  display: block;
  margin-bottom: 0.2rem;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.exam-card__table-wrap {
  padding: 0 1.1rem;
  overflow-x: auto;
}

.exam-card__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.exam-card__table th,
.exam-card__table td {
  padding: 0.6rem 0.45rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.exam-card__table th {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
  background: #f8fafc;
}

.exam-card__table th:last-child,
.exam-card__table td:last-child {
  text-align: right;
  white-space: nowrap;
}

.exam-card__empty-row {
  text-align: center !important;
  color: var(--text-muted);
  font-style: italic;
  padding: 0.85rem !important;
}

.exam-card__footer {
  display: grid;
  grid-template-columns: 1fr 1.35fr;
  gap: 0.85rem;
  padding: 0.95rem 1.1rem 1.1rem;
  border-top: 1px dashed var(--border);
  background: #fafcfd;
}

@media (max-width: 640px) {
  .exam-card__footer {
    grid-template-columns: 1fr;
  }
}

.exam-card__pay {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0 1.1rem 1.1rem;
}

.exam-card__pay-hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.exam-card__amounts {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.35rem;
}

.exam-card__amount {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.exam-card__amount strong {
  color: var(--text);
  font-size: 0.9375rem;
}

.exam-card__amount--net {
  padding-top: 0.35rem;
  margin-top: 0.15rem;
  border-top: 1px solid var(--border);
  font-weight: 600;
}

.exam-card__amount--net span,
.exam-card__amount--net strong {
  color: var(--primary-800);
  font-size: 1rem;
}

.exam-card__reduction {
  padding: 0.75rem 0.9rem;
  border-radius: var(--radius-sm);
  border: 2px solid var(--border);
}

.exam-card__reduction--examen { background: #f1f8f1; border-color: #81c784; }
.exam-card__reduction--radio { background: #eef5fc; border-color: #64b5f6; }
.exam-card__reduction--echo { background: #fdf2f6; border-color: #f06292; }
.exam-card__reduction--odonto { background: #fff8f0; border-color: #ffb74d; }

.exam-card__reduction :deep(.ui-field) {
  margin-bottom: 0;
}

.exam-card__reduction :deep(.ui-field__label) {
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--text);
}

.exam-card__reduction :deep(.ui-field__input) {
  padding: 0.7rem 0.85rem;
  font-size: 1rem;
  font-weight: 600;
}

.exam-card__reduction-hint {
  margin: 0.45rem 0 0;
  font-size: 0.75rem;
  color: #e65100;
  font-weight: 600;
}

.exam-card__reduction-hint--muted {
  color: var(--text-muted);
  font-weight: 500;
}

.invoice-modal__footer {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.5rem 1.2rem;
  border-top: 1px solid var(--border);
  background: #f0f4f8;
}

.invoice-modal__totals {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 13rem;
}

.invoice-modal__totals-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1.5rem;
  font-size: 0.9rem;
  color: var(--text-muted);
}

.invoice-modal__totals-row strong {
  color: var(--text);
  font-size: 0.975rem;
}

.invoice-modal__negative {
  color: #e65100 !important;
}

.invoice-modal__totals-row--net {
  padding-top: 0.45rem;
  margin-top: 0.2rem;
  border-top: 2px solid var(--border);
  font-weight: 700;
}

.invoice-modal__totals-row--net span,
.invoice-modal__totals-row--net strong {
  color: var(--primary-800);
  font-size: 1.0625rem;
}

.invoice-modal__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.65rem;
  margin-left: auto;
}
</style>
