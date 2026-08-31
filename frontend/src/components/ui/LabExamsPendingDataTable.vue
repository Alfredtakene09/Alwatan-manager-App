<script setup lang="ts">
import { computed } from 'vue'
import { Banknote, BedDouble, Eye, AlertCircle, Printer } from '@lucide/vue'
import { formatFcfa, fullName } from '@/lib/roles'
import { sortByCreatedAtNewestFirst } from '@/lib/patient-sort'
import { formatExamLinesSummary, type LabExamPendingItem } from '@/lib/lab-exam-pending'
import { useAppI18n } from '@/i18n/useAppI18n'
import '@/assets/simple-table.css'

const { uiText, localeCode, isArabic } = useAppI18n()
const dateLocale = computed(() => (isArabic.value ? 'ar-TD' : 'fr-FR'))

export type LabExamPendingRow = LabExamPendingItem

const props = withDefaults(
  defineProps<{
    items: LabExamPendingRow[]
    loading?: boolean
    fill?: boolean
    mode?: 'pending' | 'paid'
    printableIds?: Set<string>
  }>(),
  { mode: 'pending' },
)

const emit = defineEmits<{
  pay: [id: string]
  print: [id: string]
  reclaim: [id: string]
  view: [id: string]
  hospitalize: [visitId: string]
}>()

const isPaidMode = computed(() => props.mode === 'paid')

type TableRow = {
  id: string
  visitId: string
  hasHospitalisation: boolean
  code: string
  patientName: string
  patientPhone: string
  doctorName: string
  examLines: string[]
  examCount: number
  gross: string
  collected: string
  remaining: string
  date: string
  time: string
  canPrint: boolean
}

const rows = computed<TableRow[]>(() => {
  void localeCode.value
  return sortByCreatedAtNewestFirst(
    props.items.map((item) => ({
      ...item,
      createdAt: isPaidMode.value ? (item.paidAt ?? item.updatedAt) : item.updatedAt,
    })),
  ).map((item) => {
    const referenceDate = new Date(isPaidMode.value ? (item.paidAt ?? item.updatedAt) : item.updatedAt)
    const netFcfa = item.grossFcfa - (item.labExamReductionFcfa ?? 0)
    const examCount = item.examLines?.length ?? 0
    const examsFull = formatExamLinesSummary(item.examLines ?? [])
    const collectedFromPartials = Object.values(item.partialPaymentsByKind ?? {}).reduce(
      (sum, row) => sum + Math.max(0, row?.paidFcfa ?? 0),
      0,
    )
    const remainingFromPartials = Object.values(item.partialPaymentsByKind ?? {}).reduce(
      (sum, row) => sum + Math.max(0, row?.remainingFcfa ?? 0),
      0,
    )
    const collectedFromInvoices = Object.values(item.invoicesByKind ?? {}).reduce((sum, inv) => {
      if (!inv) return sum
      if (inv.paidFcfa != null) return sum + Math.max(0, inv.paidFcfa)
      return sum + Math.max(0, inv.netFcfa)
    }, 0)
    const remainingFromInvoices = Object.values(item.invoicesByKind ?? {}).reduce(
      (sum, inv) => sum + Math.max(0, inv?.remainingFcfa ?? 0),
      0,
    )
    const collectedFcfa =
      item.collectedFcfa != null
        ? item.collectedFcfa
        : Math.max(collectedFromInvoices, collectedFromPartials)
    const remainingFromPayments =
      item.remainingFcfa != null
        ? item.remainingFcfa
        : Math.max(remainingFromInvoices, remainingFromPartials)

    let pendingDueFcfa = item.grossFcfa
    if (!isPaidMode.value) {
      const unpaidKinds = item.unpaidKinds ?? []
      const partials = item.partialPaymentsByKind ?? {}
      if (unpaidKinds.length) {
        pendingDueFcfa = unpaidKinds.reduce((sum, kind) => {
          const partial = partials[kind]
          if (partial) return sum + Math.max(0, partial.remainingFcfa)
          return sum + Math.max(0, item.examsByKind?.[kind]?.grossFcfa ?? 0)
        }, 0)
      } else if (remainingFromPayments > 0) {
        pendingDueFcfa = remainingFromPayments
      }
    }

    const remainingFcfa = isPaidMode.value ? remainingFromPayments : pendingDueFcfa
    const displayNetFcfa = isPaidMode.value
      ? collectedFcfa > 0
        ? collectedFcfa
        : netFcfa
      : pendingDueFcfa
    const showPartialBreakdown = collectedFcfa > 0 && remainingFcfa > 0

    return {
      id: item.id,
      visitId: item.visitId ?? '',
      hasHospitalisation: (item.unpaidKinds ?? []).includes('hospitalisation'),
      code: item.visit.patient.code,
      patientName: fullName(item.visit.patient.firstName, item.visit.patient.lastName),
      patientPhone: item.visit.patient.phone || '',
      doctorName: item.doctor
        ? `Dr ${fullName(item.doctor.firstName, item.doctor.lastName)}`
        : uiText('Patient externe — Réception'),
      examLines: (examsFull || '—').split(' · ').filter(Boolean),
      examCount,
      gross: formatFcfa(displayNetFcfa),
      collected: showPartialBreakdown ? formatFcfa(collectedFcfa) : '',
      remaining:
        showPartialBreakdown || (isPaidMode.value && remainingFcfa > 0)
          ? formatFcfa(remainingFcfa)
          : '',
      date: referenceDate.toLocaleDateString(dateLocale.value),
      time: referenceDate.toLocaleTimeString(dateLocale.value, {
        hour: '2-digit',
        minute: '2-digit',
      }),
      canPrint: props.printableIds?.has(item.id) ?? true,
    }
  })
})

function onHospitalize(row: TableRow) {
  if (row.visitId) emit('hospitalize', row.visitId)
}

function onPrint(row: TableRow) {
  if (isPaidMode.value && props.printableIds && !props.printableIds.has(row.id)) return
  emit('print', row.id)
}
</script>

<template>
  <div
    class="simple-table-shell"
    :class="{ 'simple-table-shell--fill': fill }"
  >
    <div
      v-if="loading"
      class="simple-table-overlay" role="status"
      aria-live="polite"
    >
      <span class="simple-table-spinner" aria-hidden="true" />
      {{
        isPaidMode
          ? uiText('Chargement des examens payés…')
          : uiText('Chargement des examens en attente…')
      }}
    </div>

    <div class="simple-table-scroll">
      <p v-if="!loading && !rows.length" class="simple-table__empty">
        {{
          isPaidMode
            ? uiText('Aucun examen payé pour le moment')
            : uiText('Aucune prescription en attente de paiement')
        }}
      </p>
      <div v-else class="simple-table-wrap">
        <table class="simple-table">
          <thead>
            <tr>
              <th class="simple-table__num">#</th>
              <th>{{ uiText('Matricule') }}</th>
              <th>{{ uiText('Patient') }}</th>
              <th>{{ uiText('Médecin') }}</th>
              <th class="simple-table__exam">{{ uiText('Examens') }}</th>
              <th>{{ uiText(isPaidMode ? 'Net payé' : 'Montant') }}</th>
              <th v-if="!isPaidMode">{{ uiText('Prescrit le') }}</th>
              <th class="simple-table__actions-head">{{ uiText('Actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in rows" :key="row.id">
              <td class="simple-table__num">{{ index + 1 }}</td>
              <td>
                <span class="st-badge">{{ row.code }}</span>
              </td>
              <td>
                <span class="st-name">{{ row.patientName }}</span>
                <span v-if="row.patientPhone" class="st-sub">{{ row.patientPhone }}</span>
              </td>
              <td>
                <span class="st-sub">{{ row.doctorName }}</span>
              </td>
              <td class="simple-table__exam">
                <div class="st-exam-full">
                  <span v-if="row.examCount > 0" class="st-exam-count">{{ row.examCount }}</span>
                  <div class="st-exam-full__list">
                    <span
                      v-for="(line, i) in row.examLines"
                      :key="`${row.id}-exam-${i}`"
                      class="st-exam-line"
                    >{{ line }}</span>
                  </div>
                </div>
              </td>
              <td class="st-amount-col">
                <div v-if="isPaidMode" class="st-amount-stack">
                  <strong class="st-amount" dir="ltr">{{ row.gross }}</strong>
                  <span v-if="row.remaining" class="st-amount-remaining" dir="ltr">
                    {{ uiText('Reste') }} {{ row.remaining }}
                  </span>
                </div>
                <div v-else-if="row.collected && row.remaining" class="st-amount-stack">
                  <strong class="st-amount st-amount--due" dir="ltr">
                    {{ uiText('Reste') }} {{ row.remaining }}
                  </strong>
                  <span class="st-amount-collected" dir="ltr">
                    {{ uiText('Déjà encaissé') }} {{ row.collected }}
                  </span>
                </div>
                <div v-else class="st-amount-stack">
                  <strong class="st-amount" dir="ltr">{{ row.gross }}</strong>
                </div>
              </td>
              <td v-if="!isPaidMode">
                <span class="st-date">{{ row.date }}</span>
                <span class="st-sub">{{ row.time }}</span>
              </td>
              <td class="simple-table__actions">
                <div v-if="isPaidMode" class="st-actions st-actions--wrap">
                  <button
                    type="button"
                    class="st-btn st-btn--soft"
                    :title="uiText('Voir')"
                    :aria-label="uiText('Voir')"
                    @click="emit('view', row.id)"
                  >
                    <Eye :size="15" />
                  </button>
                  <button
                    type="button"
                    class="st-btn"
                    :title="uiText('Réclamation')"
                    :aria-label="uiText('Réclamation')"
                    @click="emit('reclaim', row.id)"
                  >
                    <AlertCircle :size="15" />
                  </button>
                  <button
                    type="button"
                    class="st-btn"
                    :title="
                      row.canPrint
                        ? uiText('Imprimer les factures')
                        : uiText('Aucune facture payée à imprimer')
                    "
                    :aria-label="
                      row.canPrint
                        ? uiText('Imprimer les factures')
                        : uiText('Aucune facture payée à imprimer')
                    "
                    :disabled="!row.canPrint"
                    @click="onPrint(row)"
                  >
                    <Printer :size="15" />
                  </button>
                </div>
                <div v-else class="st-actions">
                  <button
                    type="button"
                    class="st-btn st-btn--pay"
                    title="Encaisser"
                    aria-label="Encaisser"
                    @click="emit('pay', row.id)"
                  >
                    <Banknote :size="16" />
                  </button>
                  <button
                    v-if="row.hasHospitalisation"
                    type="button"
                    class="st-btn st-btn--hosp"
                    title="Hospitalisation — attribuer un lit"
                    aria-label="Hospitalisation"
                    @click="onHospitalize(row)"
                  >
                    <BedDouble :size="15" />
                  </button>
                  <button
                    type="button"
                    class="st-btn"
                    title="Aperçu factures"
                    aria-label="Aperçu factures"
                    @click="onPrint(row)"
                  >
                    <Printer :size="15" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
