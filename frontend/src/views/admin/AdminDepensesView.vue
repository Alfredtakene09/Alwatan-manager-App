<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Wallet, Plus } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { confirmAppModal } from '@/lib/api-modal-helper'
import type { AdminExpenseRow } from '@/lib/admin-dashboard'
import { EXPENSE_STATUS_VARIANT, formatShortDate } from '@/lib/admin-dashboard'
import AdminExpenseFormModal, {
  type AdminExpenseFormPayload,
} from '@/components/admin/AdminExpenseFormModal.vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'

const rows = ref<AdminExpenseRow[]>([])
const filter = ref<'all' | 'month' | 'pending'>('all')
const loading = ref(false)
const showExpenseModal = ref(false)
const showRejectModal = ref(false)
const rejectTarget = ref<AdminExpenseRow | null>(null)
const rejectReason = ref('')
const expenseSaving = ref(false)

async function loadRows() {
  loading.value = true
  try {
    const { data } = await api.get<AdminExpenseRow[]>(`/admin/expenses?filter=${filter.value}`)
    rows.value = data
  } finally {
    loading.value = false
  }
}

async function validateExpense(row: AdminExpenseRow) {
  const ok = await confirmAppModal({
    type: 'CONFIRM',
    title: 'Valider la dépense',
    message: `Confirmer la validation de « ${row.description} » ?`,
    confirmLabel: 'Valider',
  })
  if (!ok) return
  await api.patch(`/admin/expenses/${row.id}/validate`)
  await loadRows()
}

function openReject(row: AdminExpenseRow) {
  rejectTarget.value = row
  rejectReason.value = ''
  showRejectModal.value = true
}

async function submitReject() {
  if (!rejectTarget.value || rejectReason.value.trim().length < 3) return
  await api.patch(`/admin/expenses/${rejectTarget.value.id}/reject`, {
    reason: rejectReason.value.trim(),
  })
  showRejectModal.value = false
  rejectTarget.value = null
  await loadRows()
}

async function submitExpense(payload: AdminExpenseFormPayload) {
  expenseSaving.value = true
  try {
    await api.post('/admin/expenses', payload)
    showExpenseModal.value = false
    await loadRows()
  } finally {
    expenseSaving.value = false
  }
}

onMounted(loadRows)
</script>

<template>
  <div class="admin-page">
    <UiPageHeader title="Dépenses" subtitle="Gestion et validation des dépenses clinique" :icon="Wallet">
      <template #actions>
        <UiButton :icon="Plus" @click="showExpenseModal = true">Nouvelle dépense</UiButton>
      </template>
    </UiPageHeader>

    <UiCard title="Liste des dépenses" description="Filtres et actions de validation">
      <div class="filters">
        <UiButton size="sm" :variant="filter === 'all' ? 'primary' : 'ghost'" @click="filter = 'all'; loadRows()">
          Toutes
        </UiButton>
        <UiButton size="sm" :variant="filter === 'month' ? 'primary' : 'ghost'" @click="filter = 'month'; loadRows()">
          Ce mois
        </UiButton>
        <UiButton
          size="sm"
          :variant="filter === 'pending' ? 'primary' : 'ghost'"
          @click="filter = 'pending'; loadRows()"
        >
          En attente
        </UiButton>
      </div>

      <div v-if="loading" class="chart-empty">Chargement…</div>
      <div v-else-if="!rows.length" class="chart-empty">Aucune dépense</div>
      <table v-else class="admin-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Catégorie</th>
            <th>Description</th>
            <th>Montant</th>
            <th>Statut</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>{{ formatShortDate(row.date) }}</td>
            <td>{{ row.category }}</td>
            <td>{{ row.description }}</td>
            <td>{{ formatFcfa(row.amountFcfa) }}</td>
            <td>
              <span class="status-badge" :class="`status-badge--${EXPENSE_STATUS_VARIANT[row.status]}`">
                {{ row.statusLabel }}
              </span>
            </td>
            <td class="actions">
              <UiButton v-if="row.status === 'PENDING'" size="sm" variant="ghost" @click="validateExpense(row)">
                Valider
              </UiButton>
              <UiButton v-if="row.status === 'PENDING'" size="sm" variant="ghost" @click="openReject(row)">
                Rejeter
              </UiButton>
            </td>
          </tr>
        </tbody>
      </table>
    </UiCard>

    <AdminExpenseFormModal
      :open="showExpenseModal"
      :saving="expenseSaving"
      @close="showExpenseModal = false"
      @submit="submitExpense"
    />

    <UiFormModal
      v-if="showRejectModal"
      title="Rejeter la dépense"
      subtitle="Justification obligatoire"
      @close="showRejectModal = false"
    >
      <UiTextarea v-model="rejectReason" label="Motif du rejet" />
      <template #footer>
        <UiButton variant="ghost" @click="showRejectModal = false">Annuler</UiButton>
        <UiButton variant="danger" :disabled="rejectReason.trim().length < 3" @click="submitReject">
          Confirmer le rejet
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.admin-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.filters {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.admin-table th,
.admin-table td {
  padding: 0.6rem 0.5rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
}

.actions {
  display: flex;
  gap: 0.35rem;
}

.status-badge {
  display: inline-flex;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
}

.status-badge--green { background: #dcfce7; color: #166534; }
.status-badge--amber { background: #fef3c7; color: #b45309; }
.status-badge--rose { background: #ffe4e6; color: #be123c; }
</style>
