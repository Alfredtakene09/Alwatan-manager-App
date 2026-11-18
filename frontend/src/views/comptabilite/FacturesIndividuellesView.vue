<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { FileText, Receipt } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import { showApiErrorModal } from '@/lib/api-modal-helper'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import '@/assets/simple-table.css'

type InvoiceType =
  | 'SURGERY'
  | 'HOSPITALIZATION_DEPOSIT'
  | 'HOSPITALIZATION_FINAL'
  | 'PHARMACY'
  | 'CONSULTATION'
  | 'LAB_EXAM'

type InvoiceStatus = 'DRAFT' | 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED'

type InvoiceRow = {
  id: string
  invoiceNumber: string
  type: InvoiceType
  amountFcfa: number
  paidAmountFcfa: number
  status: InvoiceStatus
  createdAt: string
  patient: { code: string; firstName: string; lastName: string } | null
  issuedBy: { firstName: string; lastName: string }
}

const { uiText, localeCode, dateText } = useAppI18n()
const invoices = ref<InvoiceRow[]>([])
const loading = ref(false)
const message = ref('')
const search = ref('')
const statusFilter = ref<InvoiceStatus | ''>('')
const typeFilter = ref<InvoiceType | ''>('')
const typeOptions: { value: InvoiceType; label: string }[] = [
  { value: 'CONSULTATION', label: 'Consultation' },
  { value: 'LAB_EXAM', label: 'Examens' },
  { value: 'SURGERY', label: 'Opération' },
  { value: 'HOSPITALIZATION_DEPOSIT', label: 'Acompte hospitalisation' },
  { value: 'HOSPITALIZATION_FINAL', label: 'Solde hospitalisation' },
  { value: 'PHARMACY', label: 'Pharmacie' },
]
const statusOptions: { value: InvoiceStatus; label: string }[] = [
  { value: 'DRAFT', label: 'Brouillon' },
  { value: 'PENDING', label: 'En attente' },
  { value: 'PARTIALLY_PAID', label: 'Partiellement payée' },
  { value: 'PAID', label: 'Payée' },
  { value: 'CANCELLED', label: 'Annulée' },
]

const filteredInvoices = computed(() => {
  const query = search.value.trim().toLocaleLowerCase(localeCode.value)
  return invoices.value.filter((invoice) => {
    if (statusFilter.value && invoice.status !== statusFilter.value) return false
    if (typeFilter.value && invoice.type !== typeFilter.value) return false
    if (!query) return true
    const patientName = invoice.patient
      ? fullName(invoice.patient.firstName, invoice.patient.lastName)
      : ''
    return [invoice.invoiceNumber, invoice.patient?.code, patientName]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase(localeCode.value).includes(query))
  })
})

async function loadInvoices() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<InvoiceRow[]>('/factures', { params: { limit: 500 } })
    invoices.value = Array.isArray(data) ? data : []
  } catch (error) {
    message.value = 'Impossible de charger les factures.'
    await showApiErrorModal(error, message.value)
  } finally {
    loading.value = false
  }
}

function typeLabel(type: InvoiceType) {
  return typeOptions.find((option) => option.value === type)?.label ?? type
}

function statusLabel(status: InvoiceStatus) {
  return statusOptions.find((option) => option.value === status)?.label ?? status
}

function statusVariant(status: InvoiceStatus) {
  if (status === 'PAID') return 'success'
  if (status === 'PARTIALLY_PAID') return 'warning'
  if (status === 'CANCELLED') return 'danger'
  return 'default'
}

function patientLabel(invoice: InvoiceRow) {
  if (invoice.patient) {
    return `${fullName(invoice.patient.firstName, invoice.patient.lastName)} · ${invoice.patient.code}`
  }
  return uiText('Client externe')
}

function formatDate(value: string) {
  void localeCode.value
  return dateText(value, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

onMounted(loadInvoices)
</script>

<template>
  <div class="page-with-table invoice-page">
    <section class="page-with-table__head">
      <UiPageHeader
        :title="uiText('Factures')"
        :subtitle="uiText('Consulter et imprimer les factures de la clinique')"
        :icon="Receipt"
      />
    </section>

    <section class="page-with-table__body invoice-page__body">
      <UiAlert v-if="message" type="error" :message="uiText(message)" />
      <UiCard :title="uiText('Liste des factures')" :icon="FileText" icon-variant="blue">
        <template #actions>
          <UiButton variant="secondary" :disabled="loading" @click="loadInvoices">
            {{ uiText('Actualiser') }}
          </UiButton>
        </template>

        <div class="invoice-filters">
          <UiInput v-model="search" :label="uiText('Rechercher')" :placeholder="uiText('N° facture, patient, dossier')" />
          <UiSelect v-model="typeFilter" :label="uiText('Type de facture')">
            <option value="">{{ uiText('Tous les types') }}</option>
            <option v-for="option in typeOptions" :key="option.value" :value="option.value">
              {{ uiText(option.label) }}
            </option>
          </UiSelect>
          <UiSelect v-model="statusFilter" :label="uiText('Statut')">
            <option value="">{{ uiText('Tous les statuts') }}</option>
            <option v-for="option in statusOptions" :key="option.value" :value="option.value">
              {{ uiText(option.label) }}
            </option>
          </UiSelect>
        </div>

        <div class="simple-table-scroll">
          <table class="simple-table">
            <thead>
              <tr>
                <th>{{ uiText('N° facture') }}</th>
                <th>{{ uiText('Date') }}</th>
                <th>{{ uiText('Patient / client') }}</th>
                <th>{{ uiText('Type') }}</th>
                <th>{{ uiText('Montant') }}</th>
                <th>{{ uiText('Payé') }}</th>
                <th>{{ uiText('Statut') }}</th>
                <th>{{ uiText('Émise par') }}</th>
                <th>{{ uiText('PDF') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="invoice in filteredInvoices" :key="invoice.id">
                <td><span class="st-badge">{{ invoice.invoiceNumber }}</span></td>
                <td>{{ formatDate(invoice.createdAt) }}</td>
                <td>{{ patientLabel(invoice) }}</td>
                <td>{{ uiText(typeLabel(invoice.type)) }}</td>
                <td>{{ formatFcfa(invoice.amountFcfa) }}</td>
                <td>{{ formatFcfa(invoice.paidAmountFcfa) }}</td>
                <td>
                  <span class="st-badge" :class="`st-badge--${statusVariant(invoice.status)}`">
                    {{ uiText(statusLabel(invoice.status)) }}
                  </span>
                </td>
                <td>{{ fullName(invoice.issuedBy.firstName, invoice.issuedBy.lastName) }}</td>
                <td>
                  <a
                    class="invoice-pdf-link"
                    :href="`/api/factures/${encodeURIComponent(invoice.id)}/pdf`"
                    target="_blank"
                    rel="noopener"
                  >
                    <FileText :size="16" />
                    {{ uiText('Ouvrir') }}
                  </a>
                </td>
              </tr>
              <tr v-if="!loading && !filteredInvoices.length">
                <td colspan="9" class="invoice-empty">
                  {{ invoices.length ? uiText('Aucune facture ne correspond aux filtres.') : uiText('Aucune facture enregistrée.') }}
                </td>
              </tr>
              <tr v-if="loading && !invoices.length">
                <td colspan="9" class="invoice-empty">{{ uiText('Chargement…') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="invoice-count">
          {{ uiText('Factures affichées') }} : {{ filteredInvoices.length }} / {{ invoices.length }}
        </p>
      </UiCard>
    </section>
  </div>
</template>

<style scoped>
.invoice-page {
  min-height: 0;
}

.invoice-page__body {
  overflow: auto;
  padding-right: 0.25rem;
}

.invoice-filters {
  display: grid;
  grid-template-columns: minmax(12rem, 2fr) repeat(2, minmax(10rem, 1fr));
  align-items: end;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.invoice-pdf-link {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--primary-700);
  font-weight: 650;
  text-decoration: none;
  white-space: nowrap;
}

.invoice-pdf-link:hover {
  text-decoration: underline;
}

.invoice-empty {
  padding: 1.5rem;
  color: var(--text-muted);
  text-align: center;
}

.invoice-count {
  margin: 0.75rem 0 0;
  color: var(--text-muted);
  font-size: 0.8rem;
}

@media (max-width: 760px) {
  .invoice-filters {
    grid-template-columns: 1fr;
  }
}
</style>
