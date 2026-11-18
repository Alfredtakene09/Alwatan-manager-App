<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api/client'
import { currentMonthRangeToToday, parseDateKey } from '@/lib/date-filters'
import { formatFcfa, fullName } from '@/lib/roles'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiButton from '@/components/ui/UiButton.vue'
import '@/assets/simple-table.css'

type Settlement = {
  id: string
  kind: 'CONSULTATION' | 'OPERATION_SURGEON' | 'OPERATION_ASSISTANT'
  amountFcfa: number
  businessDate: string
  settledAt: string
  status: 'SETTLED_CASH' | 'SETTLED_PAYROLL'
  doctorUser: { firstName: string; lastName: string }
  settledBy: { firstName: string; lastName: string } | null
  patient: { firstName: string; lastName: string; code: string } | null
}

const { uiText, dateText, dateTimeText } = useAppI18n()
const initialRange = currentMonthRangeToToday()
const from = ref(initialRange.from)
const to = ref(initialRange.to)
const rows = ref<Settlement[]>([])
const appliedRange = ref<{ from: string; to: string } | null>(null)
const loading = ref(false)
const error = ref('')
const total = computed(() => rows.value.reduce((sum, row) => sum + row.amountFcfa, 0))
let loadSequence = 0

async function load() {
  const sequence = ++loadSequence
  error.value = ''
  if (!from.value || !to.value || from.value > to.value) {
    rows.value = []
    appliedRange.value = null
    loading.value = false
    error.value = uiText('Choisissez une période de règlement valide.')
    return
  }
  const range = { from: from.value, to: to.value }
  loading.value = true
  rows.value = []
  appliedRange.value = null
  try {
    const { data } = await api.get<{ rows: Settlement[] }>('/doctor-shares/settlements', { params: range })
    if (sequence !== loadSequence) return
    rows.value = data.rows
    appliedRange.value = range
  } catch {
    if (sequence !== loadSequence) return
    rows.value = []
    appliedRange.value = null
    error.value = uiText('Impossible de charger l’historique des règlements.')
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

function kindLabel(kind: Settlement['kind']) {
  if (kind === 'CONSULTATION') return uiText('Consultation')
  if (kind === 'OPERATION_ASSISTANT') return uiText('Opération — anesthésiste')
  return uiText('Opération — chirurgien')
}

onMounted(load)
defineExpose({ reload: load })
</script>

<template>
  <section class="share-history" :aria-label="uiText('Historique des règlements médecins')">
    <h4>{{ uiText('Historique des règlements médecins') }}</h4>
    <form class="share-history__filters" @submit.prevent="load">
      <label>
        <span>{{ uiText('Règlements du') }}</span>
        <input v-model="from" type="date" required />
      </label>
      <label>
        <span>{{ uiText('Au') }}</span>
        <input v-model="to" type="date" required />
      </label>
      <UiButton type="submit" size="sm" :loading="loading">{{ uiText('Appliquer') }}</UiButton>
    </form>
    <p v-if="error" class="share-history__error" role="alert">{{ error }}</p>
    <p v-else-if="loading">{{ uiText('Chargement…') }}</p>
    <template v-else-if="appliedRange">
      <p class="share-history__summary">
        {{ dateText(parseDateKey(appliedRange.from)) }} – {{ dateText(parseDateKey(appliedRange.to)) }}
        · {{ uiText('Total réglé') }} : <strong>{{ formatFcfa(total) }}</strong>
      </p>
      <p v-if="!rows.length">{{ uiText('Aucun règlement sur cette période.') }}</p>
      <div v-else class="simple-table-scroll">
        <table class="simple-table">
          <thead>
            <tr>
              <th>{{ uiText('Date de règlement') }}</th>
              <th>{{ uiText('Médecin') }}</th>
              <th>{{ uiText('Patient') }}</th>
              <th>{{ uiText('Type') }}</th>
              <th>{{ uiText('Date de prestation') }}</th>
              <th>{{ uiText('Mode de règlement') }}</th>
              <th>{{ uiText('Réglé par') }}</th>
              <th>{{ uiText('Montant') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td>{{ dateTimeText(row.settledAt) }}</td>
              <td>{{ fullName(row.doctorUser.firstName, row.doctorUser.lastName) }}</td>
              <td>{{ row.patient ? `${fullName(row.patient.firstName, row.patient.lastName)} (${row.patient.code})` : '—' }}</td>
              <td>{{ kindLabel(row.kind) }}</td>
              <td>{{ dateText(parseDateKey(row.businessDate.slice(0, 10))) }}</td>
              <td>{{ uiText(row.status === 'SETTLED_CASH' ? 'Espèces' : 'Paie') }}</td>
              <td>{{ row.settledBy ? fullName(row.settledBy.firstName, row.settledBy.lastName) : '—' }}</td>
              <td>{{ formatFcfa(row.amountFcfa) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.share-history {
  min-width: 0;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border);
}
.share-history h4 { margin: 0 0 0.75rem; }
.share-history__filters { display: flex; flex-wrap: wrap; align-items: end; gap: 0.65rem; }
.share-history__filters label { display: grid; gap: 0.35rem; font-size: 0.8125rem; font-weight: 600; }
.share-history__filters input {
  min-height: var(--app-control-height);
  padding: var(--density-control-pad-y) var(--density-control-pad-x);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  font: inherit;
}
.share-history__summary { margin: 0.75rem 0; }
.share-history__error { color: #be123c; }
</style>
