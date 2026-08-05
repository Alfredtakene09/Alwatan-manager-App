<script setup lang="ts">
import { computed } from 'vue'
import { Eye } from '@lucide/vue'
import { formatFcfa, fullName } from '@/lib/roles'
import { EXAM_KIND_LABELS, EXAM_KIND_ORDER, type ExamKindSlug } from '@/lib/exam-catalog/types'
import { normalizeLabExamPendingItem, type LabExamPendingItem } from '@/lib/lab-exam-pending'
import { formatPatientAge, normalizePatientAgeUnit } from '@/lib/patient-age'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { useAppI18n } from '@/i18n/useAppI18n'

const props = defineProps<{
  item: LabExamPendingItem | null
}>()

const emit = defineEmits<{ close: [] }>()
const open = defineModel<boolean>('open', { default: false })

const { uiText, isArabic } = useAppI18n()
const dateLocale = computed(() => (isArabic.value ? 'ar-TD' : 'fr-FR'))

const normalized = computed(() => (props.item ? normalizeLabExamPendingItem(props.item) : null))

const patient = computed(() => normalized.value?.visit.patient ?? null)
const patientName = computed(() =>
  patient.value ? fullName(patient.value.firstName, patient.value.lastName) : '—',
)
const doctorName = computed(() => {
  const doctor = normalized.value?.doctor
  if (!doctor) return uiText('Patient externe — Réception')
  return `Dr ${fullName(doctor.firstName, doctor.lastName)}`
})

const paidAt = computed(() => {
  const raw = props.item?.paidAt ?? props.item?.updatedAt
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return {
    date: d.toLocaleDateString(dateLocale.value, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    time: d.toLocaleTimeString(dateLocale.value, { hour: '2-digit', minute: '2-digit' }),
  }
})

const ageLabel = computed(() => {
  if (!patient.value) return null
  return formatPatientAge(patient.value.age, normalizePatientAgeUnit(patient.value.ageUnit))
})

const netFcfa = computed(() => {
  if (!normalized.value) return 0
  return normalized.value.grossFcfa - (props.item?.labExamReductionFcfa ?? 0)
})

type ExamDetailLine = { kind: ExamKindSlug; kindLabel: string; label: string; amountFcfa: number }

const examDetails = computed<ExamDetailLine[]>(() => {
  if (!normalized.value) return []
  const lines: ExamDetailLine[] = []
  for (const kind of EXAM_KIND_ORDER) {
    const blockLines =
      normalized.value.allExamsByKind?.[kind]?.lines ??
      normalized.value.examsByKind[kind]?.lines ??
      []
    for (const line of blockLines) {
      lines.push({
        kind,
        kindLabel: EXAM_KIND_LABELS[kind],
        label: line.label,
        amountFcfa: line.unitPriceFcfa,
      })
    }
  }
  return lines
})

const invoiceRows = computed(() => {
  const invoices = props.item?.invoicesByKind
  if (!invoices) return []
  return EXAM_KIND_ORDER.flatMap((kind) => {
    const inv = invoices[kind]
    if (!inv) return []
    return [
      {
        kind,
        kindLabel: EXAM_KIND_LABELS[kind],
        invoiceNumber: inv.invoiceNumber,
        grossFcfa: inv.grossFcfa,
        reductionFcfa: inv.reductionFcfa,
        netFcfa: inv.netFcfa,
      },
    ]
  })
})

function close() {
  open.value = false
  emit('close')
}
</script>

<template>
  <UiFormModal
    :open="open"
    title="Détail de l'encaissement"
    :subtitle="patient ? `${patient.code} — ${patientName}` : undefined"
    :icon="Eye"
    size="wide"
    @close="close"
  >
    <div v-if="normalized && patient" class="paid-detail">
      <section class="paid-detail__section">
        <h3>{{ uiText('Patient') }}</h3>
        <dl class="paid-detail__grid">
          <div>
            <dt>{{ uiText('Matricule') }}</dt>
            <dd>{{ patient.code }}</dd>
          </div>
          <div>
            <dt>{{ uiText('Patient') }}</dt>
            <dd>{{ patientName }}</dd>
          </div>
          <div v-if="patient.phone">
            <dt>{{ uiText('Tél.') }}</dt>
            <dd dir="ltr">{{ patient.phone }}</dd>
          </div>
          <div v-if="ageLabel">
            <dt>{{ uiText('Âge') }}</dt>
            <dd>{{ ageLabel }}</dd>
          </div>
          <div>
            <dt>{{ uiText('Médecin') }}</dt>
            <dd>{{ doctorName }}</dd>
          </div>
        </dl>
      </section>

      <section class="paid-detail__section">
        <h3>{{ uiText('Paiement') }}</h3>
        <dl class="paid-detail__grid">
          <div>
            <dt>{{ uiText('Payé le') }}</dt>
            <dd>{{ paidAt?.date ?? '—' }}</dd>
          </div>
          <div>
            <dt>{{ uiText('Heure') }}</dt>
            <dd dir="ltr">{{ paidAt?.time ?? '—' }}</dd>
          </div>
          <div v-if="item?.cashierName">
            <dt>{{ uiText('Encaissé par') }}</dt>
            <dd>{{ item.cashierName }}</dd>
          </div>
          <div>
            <dt>{{ uiText('Montant brut') }}</dt>
            <dd>{{ formatFcfa(normalized.grossFcfa) }}</dd>
          </div>
          <div v-if="(item?.labExamReductionFcfa ?? 0) > 0">
            <dt>{{ uiText('Réduction') }}</dt>
            <dd>− {{ formatFcfa(item?.labExamReductionFcfa ?? 0) }}</dd>
          </div>
          <div>
            <dt>{{ uiText('Net payé') }}</dt>
            <dd><strong>{{ formatFcfa(netFcfa) }}</strong></dd>
          </div>
        </dl>
      </section>

      <section class="paid-detail__section">
        <h3>{{ uiText('Examens') }}</h3>
        <ul v-if="examDetails.length" class="paid-detail__exams">
          <li v-for="(line, idx) in examDetails" :key="`${line.kind}-${line.label}-${idx}`">
            <span class="paid-detail__exam-kind">{{ uiText(line.kindLabel) }}</span>
            <span class="paid-detail__exam-label">{{ line.label }}</span>
            <strong dir="ltr">{{ formatFcfa(line.amountFcfa) }}</strong>
          </li>
        </ul>
        <p v-else class="paid-detail__empty">{{ uiText('Aucun examen') }}</p>
      </section>

      <section v-if="invoiceRows.length" class="paid-detail__section">
        <h3>{{ uiText('Factures') }}</h3>
        <ul class="paid-detail__invoices">
          <li v-for="inv in invoiceRows" :key="inv.kind">
            <span>{{ uiText(inv.kindLabel) }}</span>
            <span dir="ltr" class="paid-detail__invoice-no">{{ inv.invoiceNumber }}</span>
            <strong dir="ltr">{{ formatFcfa(inv.netFcfa) }}</strong>
          </li>
        </ul>
      </section>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="close">{{ uiText('Fermer') }}</UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.paid-detail {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.paid-detail__section h3 {
  margin: 0 0 0.65rem;
  font-size: 0.8125rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-light, #64748b);
}

.paid-detail__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem 1rem;
  margin: 0;
}

.paid-detail__grid dt {
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-light, #64748b);
}

.paid-detail__grid dd {
  margin: 0.15rem 0 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text, #0f172a);
}

.paid-detail__exams,
.paid-detail__invoices {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.paid-detail__exams li,
.paid-detail__invoices li {
  display: grid;
  grid-template-columns: 7.5rem 1fr auto;
  gap: 0.5rem 0.75rem;
  align-items: baseline;
  padding: 0.55rem 0.65rem;
  border-radius: 0.5rem;
  background: var(--surface-muted, #f8fafc);
  font-size: 0.8125rem;
}

.paid-detail__exam-kind,
.paid-detail__invoice-no {
  font-weight: 600;
  color: var(--brand-red-700, #b71c1c);
}

.paid-detail__exam-label {
  color: var(--text, #0f172a);
}

.paid-detail__empty {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-light, #64748b);
}

@media (max-width: 640px) {
  .paid-detail__grid {
    grid-template-columns: 1fr;
  }

  .paid-detail__exams li,
  .paid-detail__invoices li {
    grid-template-columns: 1fr;
  }
}
</style>
