<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { formatShortDate } from '@/lib/admin-dashboard'
import UiCard from '@/components/ui/UiCard.vue'

type HistoryRow = {
  id: string
  year: number
  month: number
  grossFcfa: number
  paidAt: string | null
  employee: { fullName: string; jobTitle: string | null; service: string }
}

const rows = ref<HistoryRow[]>([])
const loading = ref(false)

function periodLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

async function loadHistory() {
  loading.value = true
  try {
    const { data } = await api.get<{ rows: HistoryRow[] }>('/admin/payroll/history')
    rows.value = data.rows
  } finally {
    loading.value = false
  }
}

onMounted(loadHistory)

defineExpose({ reload: loadHistory })
</script>

<template>
  <UiCard title="Paiements enregistrés" description="Les 100 derniers salaires payés">
    <div v-if="loading" class="chart-empty">Chargement…</div>
    <div v-else-if="!rows.length" class="chart-empty">Aucun paiement enregistré</div>
    <table v-else class="admin-table">
      <thead>
        <tr>
          <th>Date de paiement</th>
          <th>Période</th>
          <th>Employé</th>
          <th>Poste</th>
          <th>Service</th>
          <th>Montant</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td>{{ row.paidAt ? formatShortDate(row.paidAt) : '—' }}</td>
          <td>{{ periodLabel(row.year, row.month) }}</td>
          <td>{{ row.employee.fullName }}</td>
          <td>{{ row.employee.jobTitle ?? '—' }}</td>
          <td>{{ row.employee.service }}</td>
          <td>{{ formatFcfa(row.grossFcfa) }}</td>
        </tr>
      </tbody>
    </table>
  </UiCard>
</template>

<style scoped>
.admin-table {
  width: 100%;
  border-collapse: collapse;
}

.admin-table th,
.admin-table td {
  padding: 0.65rem 0.5rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
  font-size: 0.875rem;
}
</style>
