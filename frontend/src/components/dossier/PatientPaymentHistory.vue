<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Banknote } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

type PaymentRow = {
  id: string
  amountFcfa: number
  paidAt: string
  recordedByName: string
  note?: string | null
}

type PaymentGroup = {
  id: string
  invoiceNumber: string
  groupTitle: string
  label: string
  totalFcfa: number
  paidFcfa: number
  remainingFcfa: number
  status: string
  payments: PaymentRow[]
}

type PaymentHistoryResponse = {
  groups: PaymentGroup[]
  totals: { totalFcfa: number; paidFcfa: number; remainingFcfa: number }
}

const props = defineProps<{
  patientId: string | null
  compact?: boolean
}>()

const { uiText, dateTimeText, localeCode } = useAppI18n()
const loading = ref(false)
const groups = ref<PaymentGroup[]>([])
const totals = ref<PaymentHistoryResponse['totals'] | null>(null)

const hasData = computed(() => groups.value.length > 0)

function formatDate(iso: string) {
  void localeCode.value
  return dateTimeText(iso, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(status: string) {
  void localeCode.value
  if (status === 'PARTIALLY_PAID') return uiText('En cours')
  if (status === 'PAID') return uiText('Soldé')
  return status
}

async function load() {
  if (!props.patientId) {
    groups.value = []
    totals.value = null
    return
  }
  loading.value = true
  try {
    const { data } = await api.get<PaymentHistoryResponse>(
      `/patient-dossiers/${props.patientId}/payment-history`,
    )
    groups.value = data.groups
    totals.value = data.totals
  } finally {
    loading.value = false
  }
}

watch(() => props.patientId, load, { immediate: true })
onMounted(load)

defineExpose({ reload: load })
</script>

<template>
  <div class="payment-history" :class="{ 'payment-history--compact': compact }">
    <div v-if="loading" class="payment-history__empty">{{ uiText("Chargement de l'historique…") }}</div>
    <div v-else-if="!hasData" class="payment-history__empty">
      {{ uiText('Aucun paiement enregistré pour ce patient.') }}
    </div>
    <template v-else>
      <div v-if="totals && !compact" class="payment-history__totals">
        <div>
          <span>{{ uiText('Total facturé') }}</span>
          <strong>{{ formatFcfa(totals.totalFcfa) }}</strong>
        </div>
        <div>
          <span>{{ uiText('Encaissé') }}</span>
          <strong>{{ formatFcfa(totals.paidFcfa) }}</strong>
        </div>
        <div>
          <span>{{ uiText('Reste à payer') }}</span>
          <strong>{{ formatFcfa(totals.remainingFcfa) }}</strong>
        </div>
      </div>

      <article v-for="group in groups" :key="group.id" class="payment-history__group">
        <header class="payment-history__group-head">
          <div>
            <h4>{{ group.groupTitle }}</h4>
            <p>{{ group.invoiceNumber }}</p>
          </div>
          <span
            class="payment-history__status"
            :class="{
              'payment-history__status--partial': group.status === 'PARTIALLY_PAID',
              'payment-history__status--paid': group.status === 'PAID',
            }"
          >
            {{ statusLabel(group.status) }}
          </span>
        </header>

        <div class="payment-history__amounts">
          <span>{{ translateTemplate('Total {amount}', { amount: formatFcfa(group.totalFcfa) }) }}</span>
          <span>{{ translateTemplate('Payé {amount}', { amount: formatFcfa(group.paidFcfa) }) }}</span>
          <span v-if="group.remainingFcfa > 0">
            {{ translateTemplate('Reste {amount}', { amount: formatFcfa(group.remainingFcfa) }) }}
          </span>
        </div>

        <ul class="payment-history__payments">
          <li v-for="payment in group.payments" :key="payment.id">
            <Banknote :size="14" />
            <div>
              <strong>{{ formatFcfa(payment.amountFcfa) }}</strong>
              <span>{{ formatDate(payment.paidAt) }} — {{ payment.recordedByName }}</span>
            </div>
          </li>
        </ul>
      </article>
    </template>
  </div>
</template>

<style scoped>
.payment-history {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.payment-history__empty {
  padding: 1rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.payment-history__totals {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
}

.payment-history__totals div {
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.payment-history__totals span {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.payment-history__totals strong {
  font-size: 0.95rem;
}

.payment-history__group {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 0.75rem;
  background: #fff;
}

.payment-history__group-head {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: flex-start;
}

.payment-history__group-head h4 {
  margin: 0;
  font-size: 0.9rem;
}

.payment-history__group-head p {
  margin: 0.15rem 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.payment-history__status {
  font-size: 0.6875rem;
  font-weight: 700;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  background: #f1f5f9;
  color: #475569;
}

.payment-history__status--partial {
  background: #fffbeb;
  color: #b45309;
}

.payment-history__status--paid {
  background: #dcfce7;
  color: #166534;
}

.payment-history__amounts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 0.55rem 0 0.65rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.payment-history__payments {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.payment-history__payments li {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  font-size: 0.8125rem;
}

.payment-history__payments strong {
  display: block;
  color: var(--text);
}

.payment-history__payments span {
  color: var(--text-muted);
}

.payment-history--compact .payment-history__group {
  padding: 0.6rem;
}

@media (max-width: 700px) {
  .payment-history__totals {
    grid-template-columns: 1fr;
  }
}
</style>
