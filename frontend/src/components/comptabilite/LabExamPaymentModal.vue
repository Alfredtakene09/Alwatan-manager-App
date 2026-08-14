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
import { formatAppDateTime } from '@/i18n/locale-format'
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
import { extractBasePanelLabel } from '@/lib/lab-prescribed-panels'
import { translateUi } from '@/i18n/translate'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import PatientPaymentHistory from '@/components/dossier/PatientPaymentHistory.vue'

export type LabExamPaymentItem = LabExamPendingItem

export type LabExamPaymentConfirmPayload = {
  consultationId: string
  kinds: ExamKindSlug[]
  reductionFcfa: number
  reductionsByKind: ExamReductionsByKind
  installmentAmountFcfa?: number
  installmentsByKind?: Partial<Record<ExamKindSlug, number>>
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

const { uiText, localeCode } = useAppI18n()

const payingKind = ref<ExamKindSlug | null>(null)
const installmentEnabledByKind = ref<Partial<Record<ExamKindSlug, boolean>>>({})
const installmentAmountByKind = ref<Partial<Record<ExamKindSlug, string>>>({})

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
    installmentEnabledByKind.value = {}
    installmentAmountByKind.value = {}
  },
  { immediate: true },
)

const paidKindSet = computed(() => new Set(normalizedItem.value?.paidKinds ?? []))

const kindCards = computed(() => {
  void localeCode.value
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
      kindLabel: uiText(EXAM_KIND_LABELS[sheet.kind]),
      reductionLabel: uiText(EXAM_KIND_REDUCTION_LABELS[sheet.kind]),
      docTitle: uiText(resolveSingleExamInvoiceDocTitle(sheet.kind)),
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
  void localeCode.value
  if (!props.item) return null
  const patient = props.item.visit.patient
  return {
    name: fullName(patient.firstName, patient.lastName),
    code: patient.code,
    phone: patient.phone?.trim() || '—',
    doctor: props.item.doctor
      ? `Dr ${fullName(props.item.doctor.firstName, props.item.doctor.lastName)}`
      : uiText('Patient externe — réception'),
    date: formatAppDateTime(props.item.updatedAt),
  }
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

function partialPayment(kind: ExamKindSlug) {
  return normalizedItem.value?.partialPaymentsByKind?.[kind] ?? null
}

function remainingForKind(kind: ExamKindSlug, netFcfa: number) {
  const partial = partialPayment(kind)
  return partial?.remainingFcfa ?? netFcfa
}

function toggleInstallment(kind: ExamKindSlug, enabled: boolean, netFcfa: number) {
  installmentEnabledByKind.value = { ...installmentEnabledByKind.value, [kind]: enabled }
  if (enabled && !installmentAmountByKind.value[kind]) {
    installmentAmountByKind.value = {
      ...installmentAmountByKind.value,
      [kind]: String(Math.max(1, Math.floor(netFcfa / 2))),
    }
  }
}

function resolveInstallmentAmount(kind: ExamKindSlug, netFcfa: number) {
  if (!installmentEnabledByKind.value[kind]) return undefined
  const remaining = remainingForKind(kind, netFcfa)
  const raw = String(installmentAmountByKind.value[kind] ?? '')
    .replace(/\s/g, '')
    .replace(',', '.')
  const parsed = Math.round(Number(raw))
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.min(remaining, parsed)
}

function installmentLabel(kind: ExamKindSlug, netFcfa: number) {
  void localeCode.value
  const amount = resolveInstallmentAmount(kind, netFcfa)
  if (amount == null) return uiText('Encaisser une tranche')
  return translateTemplate('Encaisser une tranche ({amount})', { amount: formatFcfa(amount) })
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

/** Affichage compact : « Biochimie (Formulaire principal: …) » → « Biochimie ». */
function formatExamLineLabel(label: string) {
  void localeCode.value
  const base = extractBasePanelLabel(label).trim() || label.trim()
  return translateUi(base)
}

function examCountLabel(count: number) {
  void localeCode.value
  return translateTemplate('{n} examen(s)', { n: String(count) })
}

function encaisserKindLabel(kindLabel: string) {
  void localeCode.value
  return translateTemplate('Encaisser {kind}', { kind: kindLabel })
}

function commentKindLabel(kindLabel: string) {
  void localeCode.value
  return translateTemplate('Commentaire — {kind} :', { kind: kindLabel })
}

function validateAllLabel() {
  void localeCode.value
  const template =
    activeTypeCount.value > 1
      ? 'Valider tout ({n} types — {amount})'
      : 'Valider tout ({n} type — {amount})'
  return translateTemplate(template, {
    n: String(activeTypeCount.value),
    amount: formatFcfa(netFcfa.value),
  })
}

function confirmAll() {
  if (!props.item || !canConfirm.value || props.submitting) return
  const kinds = payableKinds.value
  if (!kinds.length) return
  const reductions = buildPayableReductions(kinds)
  const reductionFcfa = kinds.reduce((sum, kind) => sum + (reductions[kind] ?? 0), 0)

  const installmentsByKind: Partial<Record<ExamKindSlug, number>> = {}
  for (const kind of kinds) {
    const card = kindCards.value.find((row) => row.kind === kind)
    if (!card) continue
    const amount = resolveInstallmentAmount(kind, card.netFcfa)
    if (amount != null) installmentsByKind[kind] = amount
  }
  const hasInstallments = Object.keys(installmentsByKind).length > 0

  payingKind.value = null
  emit('confirm', {
    consultationId: props.item.id,
    kinds,
    reductionFcfa,
    reductionsByKind: reductions,
    ...(hasInstallments
      ? {
          installmentsByKind,
          ...(kinds.length === 1
            ? { installmentAmountFcfa: installmentsByKind[kinds[0]!] }
            : {}),
        }
      : {}),
  })
}

function confirmKind(kind: ExamKindSlug) {
  if (!props.item) return
  const card = kindCards.value.find((row) => row.kind === kind)
  if (!card?.hasExams || card.isPaid) return
  const remaining = remainingForKind(kind, card.netFcfa)
  const installmentAmountFcfa = resolveInstallmentAmount(kind, card.netFcfa)
  if (
    installmentEnabledByKind.value[kind] &&
    (installmentAmountFcfa == null ||
      installmentAmountFcfa <= 0 ||
      installmentAmountFcfa > remaining)
  ) {
    return
  }
  payingKind.value = kind
  emit('confirm', {
    consultationId: props.item.id,
    kinds: [kind],
    reductionFcfa: reductionsByKind.value[kind] ?? 0,
    reductionsByKind: {
      ...emptyExamReductionsByKind(),
      [kind]: reductionsByKind.value[kind] ?? 0,
    },
    installmentAmountFcfa,
    ...(installmentAmountFcfa != null
      ? { installmentsByKind: { [kind]: installmentAmountFcfa } }
      : {}),
  })
}

function kindFollowUpLabel(kind: ExamKindSlug) {
  void localeCode.value
  if (kind === 'operation') return uiText('Opérations en attente')
  if (kind === 'examen' || kind === 'radio' || kind === 'echo' || kind === 'odonto') {
    return uiText('Laboratoire')
  }
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
            <p id="lab-invoice-title" class="invoice-modal__title">
              {{ uiText('Encaissement des examens') }}
            </p>
            <p class="invoice-modal__subtitle">
              {{
                uiText(
                  'Encaissez type par type, ou validez tout en une fois en bas de la fenêtre',
                )
              }}
            </p>
          </div>
          <button type="button" class="invoice-modal__close" :aria-label="uiText('Fermer')" @click="close">
            <X :size="20" />
          </button>
        </header>

        <div class="invoice-modal__scroll-hint" aria-hidden="true">
          <ChevronDown :size="16" />
          <span>{{
            uiText('Faites défiler pour voir tous les examens et saisir les réductions par type')
          }}</span>
        </div>

        <div class="invoice-modal__scroll">
          <section class="patient-panel" :aria-label="uiText('Informations patient')">
            <div class="patient-panel__item">
              <User :size="12" class="patient-panel__icon" aria-hidden="true" />
              <span class="patient-panel__label">{{ uiText('Patient') }}</span>
              <strong class="patient-panel__value">{{ patientInfo.name }}</strong>
            </div>
            <div class="patient-panel__item">
              <span class="patient-panel__label">{{ uiText('Matricule') }}</span>
              <strong class="patient-panel__value patient-panel__value--code">{{ patientInfo.code }}</strong>
            </div>
            <div class="patient-panel__item">
              <Phone :size="12" class="patient-panel__icon" aria-hidden="true" />
              <span class="patient-panel__label">{{ uiText('Tél.') }}</span>
              <strong class="patient-panel__value">{{ patientInfo.phone }}</strong>
            </div>
            <div class="patient-panel__item">
              <Stethoscope :size="12" class="patient-panel__icon" aria-hidden="true" />
              <span class="patient-panel__label">{{ uiText('Prescrit par') }}</span>
              <strong class="patient-panel__value">{{ patientInfo.doctor }}</strong>
            </div>
            <div class="patient-panel__item">
              <Calendar :size="12" class="patient-panel__icon" aria-hidden="true" />
              <span class="patient-panel__label">{{ uiText('Date') }}</span>
              <strong class="patient-panel__value">{{ patientInfo.date }}</strong>
            </div>
          </section>

          <p v-if="hasUnpaidHospitalisation" class="invoice-modal__hosp-note">
            {{
              uiText(
                "L'hospitalisation est gérée via le bouton dédié dans la liste (attribution de salle et admission).",
              )
            }}
          </p>

          <p v-if="!canConfirm" class="invoice-modal__empty">
            {{ uiText('Aucun examen facturable trouvé pour ce dossier.') }}
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
              <div class="exam-card__head-main">
                <span class="exam-card__kind">
                  <component :is="kindIcons[card.kind]" :size="14" />
                  {{ card.kindLabel }}
                  <span v-if="card.isPaid" class="exam-card__paid-badge">{{ uiText('Déjà payé') }}</span>
                </span>
                <span class="exam-card__doc-title">{{ card.docTitle }}</span>
                <span class="exam-card__count">{{ examCountLabel(card.examCount) }}</span>
              </div>
              <div v-if="!card.isPaid" class="exam-card__head-amounts">
                <span>
                  {{ uiText('Sous-total') }}
                  <strong>{{ formatFcfa(card.grossFcfa) }}</strong>
                </span>
                <span class="exam-card__head-net">
                  {{ uiText('Net') }}
                  <strong>{{ formatFcfa(remainingForKind(card.kind, card.netFcfa)) }}</strong>
                </span>
                <span v-if="partialPayment(card.kind)" class="exam-card__head-partial">
                  {{ uiText('Déjà réglé') }}
                  <strong>{{ formatFcfa(partialPayment(card.kind)!.paidFcfa) }}</strong>
                </span>
              </div>
              <div v-else class="exam-card__head-amounts">
                <span class="exam-card__head-net">
                  {{ uiText('Montant réglé') }}
                  <strong>{{ formatFcfa(card.grossFcfa) }}</strong>
                </span>
              </div>
            </header>

            <div class="exam-card__table-wrap">
              <table class="exam-card__table">
                <thead>
                  <tr>
                    <th>{{ uiText('Examen') }}</th>
                    <th>{{ uiText('Montant (FCFA)') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="line in card.lines" :key="`${card.kind}-${line.label}`">
                    <td class="exam-card__exam-name">{{ formatExamLineLabel(line.label) }}</td>
                    <td>{{ formatFcfa(line.unitPriceFcfa) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p
              v-if="INVOICE_EXAM_COMMENT_KINDS.includes(card.kind) && card.comment"
              class="exam-card__comment"
            >
              <MessageSquare :size="12" />
              <strong>{{ commentKindLabel(card.kindLabel) }}</strong>
              <span>{{ card.comment }}</span>
            </p>

            <div v-if="!card.isPaid" class="exam-card__actions">
              <label class="exam-card__installment-toggle">
                <input
                  type="checkbox"
                  :checked="Boolean(installmentEnabledByKind[card.kind])"
                  @change="toggleInstallment(card.kind, ($event.target as HTMLInputElement).checked, card.netFcfa)"
                />
                {{ uiText('Paiement en tranche') }}
              </label>
              <UiInput
                v-if="installmentEnabledByKind[card.kind]"
                class="exam-card__installment-input"
                :model-value="installmentAmountByKind[card.kind] ?? ''"
                :label="uiText('Tranche (FCFA)')"
                type="number"
                min="1"
                :max="remainingForKind(card.kind, card.netFcfa)"
                :placeholder="uiText('Ex. 50 000')"
                @update:model-value="installmentAmountByKind = { ...installmentAmountByKind, [card.kind]: String($event) }"
              />
              <div
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
              </div>
              <div class="exam-card__pay">
                <UiButton
                  variant="success"
                  size="sm"
                  :icon="Banknote"
                  :disabled="
                    submitting ||
                    (submittingKind != null && submittingKind !== card.kind) ||
                    (Boolean(installmentEnabledByKind[card.kind]) &&
                      resolveInstallmentAmount(card.kind, card.netFcfa) == null)
                  "
                  @click="confirmKind(card.kind)"
                >
                  {{
                    submitting && (submittingKind === card.kind || payingKind === card.kind)
                      ? uiText('Validation…')
                      : installmentEnabledByKind[card.kind]
                        ? installmentLabel(card.kind, card.netFcfa)
                        : encaisserKindLabel(card.kindLabel)
                  }}
                </UiButton>
                <span v-if="kindFollowUpLabel(card.kind)" class="exam-card__pay-hint">
                  → {{ kindFollowUpLabel(card.kind) }}
                </span>
              </div>
              <p v-if="card.reductionFcfa > 0" class="exam-card__reduction-hint">
                {{ translateTemplate('Réduction : - {amount}', { amount: formatFcfa(card.reductionFcfa) }) }}
              </p>
            </div>
          </article>

          <section v-if="item.visit.patient.id" class="invoice-modal__history">
            <h3 class="invoice-modal__history-title">
              {{ uiText('Historique des paiements du patient') }}
            </h3>
            <PatientPaymentHistory :patient-id="item.visit.patient.id" compact />
          </section>
        </div>

        <footer class="invoice-modal__footer">
          <div class="invoice-modal__totals" role="group" :aria-label="uiText('Résumé du paiement')">
            <div class="invoice-modal__totals-item">
              <span class="invoice-modal__totals-label">{{ uiText('Types') }}</span>
              <strong class="invoice-modal__totals-value">{{ activeTypeCount }}</strong>
            </div>
            <div class="invoice-modal__totals-item">
              <span class="invoice-modal__totals-label">{{ uiText('Brut') }}</span>
              <strong class="invoice-modal__totals-value">{{ formatFcfa(grossFcfa) }}</strong>
            </div>
            <div class="invoice-modal__totals-item">
              <span class="invoice-modal__totals-label">{{ uiText('Réduc.') }}</span>
              <strong class="invoice-modal__totals-value invoice-modal__negative"
                >- {{ formatFcfa(totalReductionFcfa) }}</strong
              >
            </div>
            <div class="invoice-modal__totals-item invoice-modal__totals-item--net">
              <span class="invoice-modal__totals-label">{{ uiText('Net') }}</span>
              <strong class="invoice-modal__totals-value">{{ formatFcfa(netFcfa) }}</strong>
            </div>
          </div>
          <div class="invoice-modal__actions">
            <UiButton variant="ghost" size="md" @click="close">{{ uiText('Fermer') }}</UiButton>
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
                  ? uiText('Validation en cours…')
                  : validateAllLabel()
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
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.65rem;
  padding: 0.4rem 0.65rem;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.patient-panel__item {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  max-width: 100%;
}

.patient-panel__icon {
  flex-shrink: 0;
  color: var(--primary-700);
  opacity: 0.85;
}

.patient-panel__label {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
  white-space: nowrap;
}

.patient-panel__label::after {
  content: ':';
}

.patient-panel__value {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 11rem;
}

.patient-panel__value--code {
  font-family: ui-monospace, monospace;
  color: var(--primary-800);
  max-width: none;
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
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem 0.75rem;
  padding: 0.45rem 0.75rem;
  border-bottom: 1px solid var(--border);
  background: #fafcfd;
}

.exam-card__head-main {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.55rem;
  min-width: 0;
}

.exam-card__kind {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
}

.exam-card--examen .exam-card__kind { color: #2e7d32; }
.exam-card--radio .exam-card__kind { color: #1565c0; }
.exam-card--echo .exam-card__kind { color: #c2185b; }
.exam-card--odonto .exam-card__kind { color: #e65100; }

.exam-card__doc-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text);
}

.exam-card__count {
  font-size: 0.6875rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.exam-card__head-amounts {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.75rem;
  font-size: 0.6875rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.exam-card__head-amounts strong {
  margin-inline-start: 0.25rem;
  font-size: 0.8125rem;
  color: var(--text);
}

.exam-card__head-net strong {
  color: var(--primary-800);
}

.exam-card__head-partial,
.exam-card__head-partial strong {
  color: #b45309;
}

.exam-card__comment {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.4rem;
  margin: 0;
  padding: 0.3rem 0.75rem;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  font-size: 0.75rem;
  line-height: 1.3;
  color: var(--text);
}

.exam-card__comment svg {
  flex-shrink: 0;
  color: var(--primary-700);
  align-self: center;
}

.exam-card__comment strong {
  font-size: 0.6875rem;
  font-weight: 700;
  color: var(--text-muted);
  white-space: nowrap;
}

.exam-card__table-wrap {
  padding: 0 0.75rem;
  overflow-x: auto;
}

.exam-card__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.exam-card__table th,
.exam-card__table td {
  padding: 0.3rem 0.35rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.exam-card__table th {
  font-size: 0.625rem;
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

.exam-card__exam-name {
  color: var(--brand-red, #c62828);
  font-weight: 700;
}

.exam-card__empty-row {
  text-align: center !important;
  color: var(--text-muted);
  font-style: italic;
  padding: 0.65rem !important;
}

.exam-card__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.45rem 0.65rem;
  padding: 0.5rem 0.75rem 0.6rem;
  border-top: 1px dashed var(--border);
  background: #fafcfd;
}

.exam-card__installment-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  white-space: nowrap;
  padding-bottom: 0.35rem;
}

.exam-card__installment-input {
  flex: 0 1 9rem;
  min-width: 7rem;
}

.exam-card__reduction {
  flex: 1 1 10rem;
  min-width: 8rem;
  max-width: 14rem;
  padding: 0.3rem 0.45rem;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--border);
}

.exam-card__reduction--examen { background: #f1f8f1; border-color: #81c784; }
.exam-card__reduction--radio { background: #eef5fc; border-color: #64b5f6; }
.exam-card__reduction--echo { background: #fdf2f6; border-color: #f06292; }
.exam-card__reduction--odonto { background: #fff8f0; border-color: #ffb74d; }

.exam-card__reduction :deep(.ui-field) {
  margin-bottom: 0;
}

.exam-card__reduction :deep(.ui-field__label),
.exam-card__installment-input :deep(.ui-field__label) {
  font-size: 0.625rem;
  font-weight: 700;
  margin-bottom: 0.15rem;
  color: var(--text);
}

.exam-card__reduction :deep(.ui-field__input),
.exam-card__installment-input :deep(.ui-field__input) {
  padding: 0.35rem 0.5rem;
  font-size: 0.8125rem;
  font-weight: 600;
}

.exam-card__pay {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.5rem;
  margin-inline-start: auto;
}

.exam-card__pay-hint {
  font-size: 0.6875rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.exam-card__reduction-hint {
  flex: 1 0 100%;
  margin: 0;
  font-size: 0.6875rem;
  color: #e65100;
  font-weight: 600;
}

.exam-card__reduction-hint--muted {
  color: var(--text-muted);
  font-weight: 500;
}

.invoice-modal__history {
  margin-top: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px dashed var(--border);
}

.invoice-modal__history-title {
  margin: 0 0 0.65rem;
  font-size: 0.875rem;
  color: var(--primary-800);
}

.invoice-modal__footer {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem 1rem;
  padding: 0.65rem 1rem;
  border-top: 1px solid var(--border);
  background: #f0f4f8;
}

.invoice-modal__totals {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.5rem;
  min-width: 0;
  flex: 1 1 auto;
}

.invoice-modal__totals-item {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: #fff;
  border: 1px solid var(--border);
  font-size: 0.75rem;
  line-height: 1.2;
  white-space: nowrap;
}

.invoice-modal__totals-label {
  color: var(--text-muted);
  font-weight: 600;
}

.invoice-modal__totals-value {
  color: var(--text);
  font-size: 0.8125rem;
  font-weight: 700;
}

.invoice-modal__negative {
  color: #e65100 !important;
}

.invoice-modal__totals-item--net {
  border-color: color-mix(in srgb, var(--primary-600) 35%, var(--border));
  background: color-mix(in srgb, var(--primary-50, #e8f0fe) 80%, #fff);
}

.invoice-modal__totals-item--net .invoice-modal__totals-label,
.invoice-modal__totals-item--net .invoice-modal__totals-value {
  color: var(--primary-800);
}

.invoice-modal__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-left: auto;
}
</style>
