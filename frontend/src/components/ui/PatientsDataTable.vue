<script setup lang="ts">
import { computed } from 'vue'
import { Pencil, RefreshCw, Trash2, Banknote, Printer } from '@lucide/vue'
import { fullName, isDirectionOrGestionnaire } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth'
import { useUiActionVisibility } from '@/composables/useUiActionVisibility'
import { sortPatientsNewestFirst } from '@/lib/patient-sort'
import { useAppI18n } from '@/i18n/useAppI18n'
import '@/assets/simple-table.css'

export type ConsultationPaymentInfo = {
  invoiceId: string
  invoiceNumber: string
  status: string
  amountFcfa: number
  paidAmountFcfa: number
  remainingFcfa: number
  payable: boolean
}

export type PatientRow = {
  id: string
  code: string
  firstName: string
  lastName: string
  phone?: string
  service?: string | null
  gender?: string
  createdAt?: string
  /** false = déjà envoyé / consulté (ou données liées) — bouton masqué sauf pour l’admin */
  canDelete?: boolean
  createdBy?: { id: string; firstName: string; lastName: string } | null
  consultationPayment?: ConsultationPaymentInfo | null
}

const props = withDefaults(
  defineProps<{
    patients: PatientRow[]
    loading?: boolean
    fill?: boolean
    showDelete?: boolean
    showReceptionist?: boolean
    /** Si omis : visible pour admin / gestionnaire / direction, masqué pour les réceptionnistes. */
    showPay?: boolean
    showPrint?: boolean
    printingPatientId?: string | null
  }>(),
  { showDelete: true, showReceptionist: false, showPrint: false, printingPatientId: null },
)

const emit = defineEmits<{
  edit: [patient: PatientRow]
  reconsult: [patient: PatientRow]
  delete: [patient: PatientRow]
  pay: [patient: PatientRow]
  print: [patient: PatientRow]
}>()

const { uiText, clinicServiceText, localeCode, dateText } = useAppI18n()
const auth = useAuthStore()
const { canSeeUiAction } = useUiActionVisibility()
const showPayButton = computed(() =>
  (props.showPay ?? Boolean(auth.user && isDirectionOrGestionnaire(auth.user.role))) &&
  canSeeUiAction('reception.pay_consultation'),
)
const showPrintButton = computed(
  () => props.showPrint && canSeeUiAction('reception.print_receipt'),
)
const showEditButton = computed(() => canSeeUiAction('reception.edit_patient'))
const showReconsultButton = computed(() => canSeeUiAction('reception.reconsult'))
const canForceDelete = computed(() => Boolean(auth.user && isDirectionOrGestionnaire(auth.user.role)))
const allowDelete = computed(() => props.showDelete && canSeeUiAction('reception.delete_patient'))

const rows = computed(() =>
  sortPatientsNewestFirst(props.patients).map((p) => ({
    patient: p,
    code: p.code,
    fullName: fullName(p.firstName, p.lastName),
    service: p.service?.trim() || '',
    phone: p.phone || '',
    gender: p.gender,
    createdAt: formatDate(p.createdAt),
    receptionistName: p.createdBy
      ? fullName(p.createdBy.firstName, p.createdBy.lastName)
      : '',
    canDelete: allowDelete.value && (canForceDelete.value || p.canDelete !== false),
    forceDelete: canForceDelete.value && p.canDelete === false,
    payable: Boolean(p.consultationPayment?.payable),
    paid: p.consultationPayment?.status === 'PAID',
    payment: consultationPaymentMark(p.consultationPayment),
  })),
)

function consultationPaymentMark(payment: ConsultationPaymentInfo | null | undefined) {
  if (!payment) {
    return { label: '—', variant: 'default' as const }
  }
  if (payment.status === 'PAID' || (payment.remainingFcfa <= 0 && payment.paidAmountFcfa > 0)) {
    return { label: uiText('Payé'), variant: 'success' as const }
  }
  if (
    payment.status === 'PARTIALLY_PAID' ||
    (payment.paidAmountFcfa > 0 && payment.remainingFcfa > 0)
  ) {
    return { label: uiText('Partiel'), variant: 'warning' as const }
  }
  if (payment.payable || payment.status === 'PENDING' || payment.status === 'DRAFT') {
    return { label: uiText('Non payé'), variant: 'danger' as const }
  }
  return { label: '—', variant: 'default' as const }
}

function formatDate(iso?: string) {
  if (!iso) return '—'
  void localeCode.value
  return dateText(iso, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function serviceLabel(service: string) {
  void localeCode.value
  return service ? clinicServiceText(service) : ''
}

function genderLabel(gender?: string) {
  if (gender === 'F') return uiText('Féminin')
  if (gender === 'M') return uiText('Masculin')
  return '—'
}

function genderClass(gender?: string) {
  if (gender === 'F') return 'st-pill st-pill--f'
  if (gender === 'M') return 'st-pill st-pill--m'
  return 'st-pill st-pill--na'
}
</script>

<template>
  <div
    class="simple-table-shell"
    :class="{
      'simple-table-shell--fill': fill,
    }"
  >
    <div
      v-if="loading"
      class="simple-table-overlay" role="status"
      aria-live="polite"
    >
      <span class="simple-table-spinner" aria-hidden="true" />
      {{ uiText('Chargement des dossiers…') }}
    </div>

    <div class="simple-table-scroll">
      <p v-if="!loading && !rows.length" class="simple-table__empty">
        {{ uiText('Aucun patient à afficher') }}
      </p>
      <div v-else class="simple-table-wrap">
        <table class="simple-table">
          <thead>
            <tr>
              <th class="simple-table__num">#</th>
              <th>{{ uiText('Matricule') }}</th>
              <th>{{ uiText('Nom complet') }}</th>
              <th>{{ uiText('Service') }}</th>
              <th>{{ uiText('Téléphone') }}</th>
              <th>{{ uiText('Genre') }}</th>
              <th>{{ uiText("Date d'inscription") }}</th>
              <th v-if="showReceptionist">{{ uiText('Réceptionniste') }}</th>
              <th>{{ uiText('Paiement consultation') }}</th>
              <th class="simple-table__actions-head">{{ uiText('Actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in rows" :key="row.patient.id">
              <td class="simple-table__num">{{ index + 1 }}</td>
              <td>
                <span class="st-badge">{{ row.code }}</span>
              </td>
              <td>
                <span class="st-name">{{ row.fullName }}</span>
              </td>
              <td>
                <span v-if="row.service" class="st-date">{{ serviceLabel(row.service) }}</span>
                <span v-else class="st-muted">—</span>
              </td>
              <td>
                <a
                  v-if="row.phone"
                  class="st-phone"
                  :href="`tel:${row.phone}`"
                >{{ row.phone }}</a>
                <span v-else class="st-muted">—</span>
              </td>
              <td>
                <span :class="genderClass(row.gender)">{{ genderLabel(row.gender) }}</span>
              </td>
              <td>
                <span class="st-date">{{ row.createdAt }}</span>
              </td>
              <td v-if="showReceptionist">
                <span v-if="row.receptionistName" class="st-date">{{ row.receptionistName }}</span>
                <span v-else class="st-muted">—</span>
              </td>
              <td>
                <span class="st-badge" :class="`st-badge--${row.payment.variant}`">
                  {{ row.payment.label }}
                </span>
              </td>
              <td class="simple-table__actions">
                <div class="st-actions">
                  <button
                    v-if="showPrintButton"
                    type="button"
                    class="st-btn st-btn--accent"
                    :disabled="printingPatientId === row.patient.id"
                    :title="uiText('Réimprimer le reçu')"
                    :aria-label="uiText('Réimprimer le reçu')"
                    @click="emit('print', row.patient)"
                  >
                    <Printer :size="15" />
                  </button>
                  <button
                    v-if="showPayButton"
                    type="button"
                    class="st-btn"
                    :class="row.payable ? 'st-btn--pay' : 'st-btn--soft'"
                    :title="
                      row.payable
                        ? uiText('Paiement — à régler chez le gestionnaire')
                        : row.paid
                          ? uiText('Paiement — soldé')
                          : uiText('Paiement')
                    "
                    :aria-label="uiText('Paiement')"
                    @click="emit('pay', row.patient)"
                  >
                    <Banknote :size="15" />
                  </button>
                  <button
                    v-if="showEditButton"
                    type="button"
                    class="st-btn st-btn--edit"
                    title="Modifier le dossier"
                    aria-label="Modifier le dossier"
                    @click="emit('edit', row.patient)"
                  >
                    <Pencil :size="15" />
                  </button>
                  <button
                    v-if="showReconsultButton"
                    type="button"
                    class="st-btn st-btn--accent"
                    title="Reconsultation"
                    aria-label="Reconsultation"
                    @click="emit('reconsult', row.patient)"
                  >
                    <RefreshCw :size="15" />
                  </button>
                  <template v-if="row.canDelete">
                    <span class="st-sep" aria-hidden="true" />
                    <button
                      type="button"
                      class="st-btn st-btn--delete"
                      :title="
                        row.forceDelete
                          ? uiText('Supprimer le dossier (admin, même après consultation)')
                          : uiText('Supprimer le dossier')
                      "
                      :aria-label="
                        row.forceDelete
                          ? uiText('Supprimer le dossier (admin, même après consultation)')
                          : uiText('Supprimer le dossier')
                      "
                      @click="emit('delete', row.patient)"
                    >
                      <Trash2 :size="15" />
                    </button>
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
