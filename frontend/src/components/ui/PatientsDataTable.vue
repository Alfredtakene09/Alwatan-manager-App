<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ChevronDown, Pencil, RefreshCw, Trash2, Banknote, Printer } from '@lucide/vue'
import { fullName, formatFcfa, isDirectionOrGestionnaire } from '@/lib/roles'
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
    /** Services proposés dans le filtre d’en-tête (noms bruts). */
    serviceOptions?: string[]
    /** Service actuellement filtré ('' = tous). */
    serviceFilter?: string
  }>(),
  {
    showDelete: true,
    showReceptionist: false,
    showPrint: false,
    printingPatientId: null,
    serviceOptions: () => [],
    serviceFilter: '',
  },
)

const emit = defineEmits<{
  edit: [patient: PatientRow]
  reconsult: [patient: PatientRow]
  delete: [patient: PatientRow]
  pay: [patient: PatientRow]
  print: [patient: PatientRow]
  'update:serviceFilter': [service: string]
}>()

const { uiText, clinicServiceText, localeCode, dateText } = useAppI18n()
const auth = useAuthStore()
const { canSeeUiAction } = useUiActionVisibility()
const showPayButton = computed(() =>
  (props.showPay ?? Boolean(auth.user && isDirectionOrGestionnaire(auth.user.role))) &&
  canSeeUiAction('reception.pay_consultation'),
)
const showPrintButton = computed(() => props.showPrint)
const showEditButton = computed(() => canSeeUiAction('reception.edit_patient'))
const showReconsultButton = computed(() => canSeeUiAction('reception.reconsult'))
const canForceDelete = computed(() => Boolean(auth.user && isDirectionOrGestionnaire(auth.user.role)))
const allowDelete = computed(() => props.showDelete && canSeeUiAction('reception.delete_patient'))

const serviceMenuOpen = ref(false)
const serviceHeaderRef = ref<HTMLElement | null>(null)

const serviceChoices = computed(() => {
  const fromProps = props.serviceOptions.map((name) => name.trim()).filter(Boolean)
  const fromRows = props.patients
    .map((patient) => patient.service?.trim() || '')
    .filter(Boolean)
  return [...new Set([...fromProps, ...fromRows])].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  )
})

const serviceFilterEnabled = computed(() => serviceChoices.value.length > 0)
const activeServiceLabel = computed(() => {
  void localeCode.value
  const selected = props.serviceFilter?.trim()
  if (!selected) return uiText('Service')
  return clinicServiceText(selected)
})

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
  const amount = formatFcfa(payment.amountFcfa)
  if (payment.status === 'PAID' || (payment.remainingFcfa <= 0 && payment.paidAmountFcfa > 0)) {
    return { label: amount, variant: 'success' as const }
  }
  if (
    payment.status === 'PARTIALLY_PAID' ||
    (payment.paidAmountFcfa > 0 && payment.remainingFcfa > 0)
  ) {
    return {
      label: `${uiText('Partiel')} · ${formatFcfa(payment.remainingFcfa)}`,
      variant: 'warning' as const,
    }
  }
  if (payment.payable || payment.status === 'PENDING' || payment.status === 'DRAFT') {
    return { label: amount, variant: 'danger' as const }
  }
  return { label: amount || '—', variant: 'default' as const }
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

function toggleServiceMenu() {
  if (!serviceFilterEnabled.value) return
  serviceMenuOpen.value = !serviceMenuOpen.value
}

function selectService(service: string) {
  emit('update:serviceFilter', service)
  serviceMenuOpen.value = false
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!serviceMenuOpen.value) return
  const target = event.target as Node | null
  if (target && serviceHeaderRef.value?.contains(target)) return
  serviceMenuOpen.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
})
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
              <th class="simple-table__service-head">
                <div
                  ref="serviceHeaderRef"
                  class="st-service-filter"
                  :class="{
                    'st-service-filter--active': Boolean(serviceFilter),
                    'st-service-filter--open': serviceMenuOpen,
                    'st-service-filter--disabled': !serviceFilterEnabled,
                  }"
                >
                  <button
                    type="button"
                    class="st-service-filter__trigger"
                    :disabled="!serviceFilterEnabled"
                    :aria-expanded="serviceMenuOpen"
                    :aria-haspopup="serviceFilterEnabled ? 'listbox' : undefined"
                    :title="uiText('Filtrer par service')"
                    @click="toggleServiceMenu"
                  >
                    <span class="st-service-filter__label">{{ activeServiceLabel }}</span>
                    <ChevronDown
                      v-if="serviceFilterEnabled"
                      :size="12"
                      class="st-service-filter__chevron"
                    />
                  </button>
                  <div
                    v-if="serviceMenuOpen"
                    class="st-service-filter__menu"
                    role="listbox"
                    :aria-label="uiText('Filtrer par service')"
                  >
                    <button
                      type="button"
                      class="st-service-filter__option"
                      :class="{ 'st-service-filter__option--active': !serviceFilter }"
                      role="option"
                      :aria-selected="!serviceFilter"
                      @click="selectService('')"
                    >
                      {{ uiText('Tous les services') }}
                    </button>
                    <button
                      v-for="service in serviceChoices"
                      :key="service"
                      type="button"
                      class="st-service-filter__option"
                      :class="{ 'st-service-filter__option--active': serviceFilter === service }"
                      role="option"
                      :aria-selected="serviceFilter === service"
                      @click="selectService(service)"
                    >
                      {{ serviceLabel(service) }}
                    </button>
                  </div>
                </div>
              </th>
              <th>{{ uiText('Téléphone') }}</th>
              <th>{{ uiText('Genre') }}</th>
              <th>{{ uiText("Date d'inscription") }}</th>
              <th v-if="showReceptionist">{{ uiText('Réceptionniste') }}</th>
              <th>{{ uiText('Paiement') }}</th>
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
                <button
                  v-if="row.service && serviceFilterEnabled"
                  type="button"
                  class="st-service-cell"
                  :class="{ 'st-service-cell--active': serviceFilter === row.service }"
                  :title="uiText('Filtrer par ce service')"
                  @click="selectService(serviceFilter === row.service ? '' : row.service)"
                >
                  {{ serviceLabel(row.service) }}
                </button>
                <span v-else-if="row.service" class="st-date">{{ serviceLabel(row.service) }}</span>
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

<style scoped>
.simple-table__service-head {
  position: relative;
  overflow: visible;
}

.st-service-filter {
  position: relative;
  display: inline-flex;
  max-width: 100%;
}

.st-service-filter__trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: inherit;
  font-weight: inherit;
  text-transform: inherit;
  letter-spacing: inherit;
  cursor: pointer;
}

.st-service-filter__trigger:disabled {
  cursor: default;
}

.st-service-filter__trigger:not(:disabled):hover .st-service-filter__label,
.st-service-filter--active .st-service-filter__label {
  color: var(--primary-700, #0f766e);
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

.st-service-filter__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.st-service-filter__chevron {
  flex-shrink: 0;
  opacity: 0.7;
  transition: transform 0.15s ease;
}

.st-service-filter--open .st-service-filter__chevron {
  transform: rotate(180deg);
}

.st-service-filter__menu {
  position: absolute;
  top: calc(100% + 0.35rem);
  inset-inline-start: 0;
  z-index: 20;
  min-width: 11rem;
  max-width: min(18rem, 70vw);
  max-height: 14rem;
  overflow: auto;
  padding: 0.3rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 0.5rem);
  background: var(--bg-card, #fff);
  box-shadow: var(--shadow-md, 0 10px 24px rgb(15 23 42 / 0.12));
}

.st-service-filter__option {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0.4rem 0.55rem;
  border: 0;
  border-radius: 0.35rem;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  text-align: start;
  text-transform: none;
  letter-spacing: normal;
  cursor: pointer;
}

.st-service-filter__option:hover {
  background: var(--surface-soft, #f6f8fb);
}

.st-service-filter__option--active {
  background: color-mix(in srgb, var(--primary-500, #14b8a6) 14%, transparent);
  color: var(--primary-800, #115e59);
}

.st-service-cell {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  text-align: start;
  cursor: pointer;
}

.st-service-cell:hover,
.st-service-cell--active {
  color: var(--primary-700, #0f766e);
  text-decoration: underline;
  text-underline-offset: 0.12em;
}
</style>
