<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { Check, X, Banknote, RefreshCw } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import { confirmAppModal } from '@/lib/api-modal-helper'

type OvertimeRow = {
  id: string
  businessDate: string
  hoursWorked: number
  minutesWorked: number
  hourlyRateFcfa: number
  amountFcfa: number
  status: 'PENDING' | 'VALIDATED' | 'REJECTED' | 'PAID' | 'CANCELLED'
  comment: string | null
  rejectionReason: string | null
  employee: {
    id: string
    firstName: string
    lastName: string
    specialty: string | null
    overtimeHourlyRateFcfa: number | null
  }
}

const rows = ref<OvertimeRow[]>([])
const loading = ref(false)
const busyId = ref<string | null>(null)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const statusFilter = ref('PENDING')
const rateDraft = ref<Record<string, string>>({})

const filtered = computed(() => {
  if (!statusFilter.value) return rows.value
  return rows.value.filter((row) => row.status === statusFilter.value)
})

function statusLabel(status: string) {
  if (status === 'PENDING') return 'En attente'
  if (status === 'VALIDATED') return 'Validée'
  if (status === 'REJECTED') return 'Refusée'
  if (status === 'PAID') return 'Payée'
  if (status === 'CANCELLED') return 'Annulée'
  return status
}

function doctorName(row: OvertimeRow) {
  return fullName(row.employee.firstName, row.employee.lastName)
}

async function reload() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<OvertimeRow[]>('/doctor-overtime', {
      params: statusFilter.value ? { status: statusFilter.value } : undefined,
    })
    rows.value = Array.isArray(data) ? data : []
    for (const row of rows.value) {
      if (rateDraft.value[row.id] == null) {
        rateDraft.value[row.id] = String(
          row.hourlyRateFcfa || row.employee.overtimeHourlyRateFcfa || '',
        )
      }
    }
  } catch (error) {
    message.value = axios.isAxiosError(error)
      ? String(error.response?.data?.error ?? 'Chargement impossible.')
      : 'Chargement impossible.'
    messageType.value = 'error'
    rows.value = []
  } finally {
    loading.value = false
  }
}

async function validateRow(row: OvertimeRow) {
  const rate = Number(rateDraft.value[row.id])
  if (!Number.isFinite(rate) || rate <= 0) {
    message.value = 'Indiquez un taux horaire valide avant validation.'
    messageType.value = 'error'
    return
  }
  const amount = Math.round((row.minutesWorked / 60) * rate)
  const ok = await confirmAppModal({
    type: 'CONFIRM',
    title: 'Valider les heures supplémentaires',
    message: `Valider ${row.hoursWorked} h pour ${doctorName(row)} à ${formatFcfa(rate)}/h → ${formatFcfa(amount)} ?`,
    confirmLabel: 'Valider et calculer',
  })
  if (!ok) return

  busyId.value = row.id
  try {
    await api.patch(`/doctor-overtime/${row.id}/validate`, { hourlyRateFcfa: rate })
    message.value = `HS validées : ${formatFcfa(amount)}.`
    messageType.value = 'success'
    await reload()
  } catch (error) {
    message.value = axios.isAxiosError(error)
      ? String(error.response?.data?.error ?? 'Validation impossible.')
      : 'Validation impossible.'
    messageType.value = 'error'
  } finally {
    busyId.value = null
  }
}

async function rejectRow(row: OvertimeRow) {
  const reason = window.prompt(`Motif du refus pour ${doctorName(row)} :`, '')
  if (reason == null) return
  if (reason.trim().length < 3) {
    message.value = 'Justification requise (3 caractères min.).'
    messageType.value = 'error'
    return
  }
  busyId.value = row.id
  try {
    await api.patch(`/doctor-overtime/${row.id}/reject`, { reason: reason.trim() })
    message.value = 'Saisie refusée.'
    messageType.value = 'success'
    await reload()
  } catch (error) {
    message.value = axios.isAxiosError(error)
      ? String(error.response?.data?.error ?? 'Refus impossible.')
      : 'Refus impossible.'
    messageType.value = 'error'
  } finally {
    busyId.value = null
  }
}

async function payRow(row: OvertimeRow) {
  const ok = await confirmAppModal({
    type: 'CONFIRM',
    title: 'Payer les heures supplémentaires',
    message: `Marquer ${formatFcfa(row.amountFcfa)} comme payé pour ${doctorName(row)} ? (Sinon elles seront incluses automatiquement au paiement de la paie du mois.)`,
    confirmLabel: 'Marquer payé',
  })
  if (!ok) return
  busyId.value = row.id
  try {
    await api.post(`/doctor-overtime/${row.id}/pay`)
    message.value = 'HS marquées comme payées.'
    messageType.value = 'success'
    await reload()
  } catch (error) {
    message.value = axios.isAxiosError(error)
      ? String(error.response?.data?.error ?? 'Paiement impossible.')
      : 'Paiement impossible.'
    messageType.value = 'error'
  } finally {
    busyId.value = null
  }
}

defineExpose({ reload })

onMounted(reload)
</script>

<template>
  <div class="overtime-panel">
    <div class="overtime-panel__toolbar">
      <UiSelect v-model="statusFilter" label="Statut" @update:model-value="reload">
        <option value="PENDING">En attente</option>
        <option value="VALIDATED">Validées</option>
        <option value="PAID">Payées</option>
        <option value="REJECTED">Refusées</option>
        <option value="">Tous</option>
      </UiSelect>
      <UiButton variant="ghost" :icon="RefreshCw" :disabled="loading" @click="reload">
        Actualiser
      </UiButton>
    </div>

    <UiAlert v-if="message" :type="messageType" :message="message" />

    <p v-if="loading" class="muted">Chargement…</p>
    <p v-else-if="!filtered.length" class="muted">Aucune saisie pour ce filtre.</p>

    <div v-else class="overtime-table-wrap">
      <table class="overtime-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Médecin</th>
            <th>Durée</th>
            <th>Taux / h</th>
            <th>Montant</th>
            <th>Statut</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filtered" :key="row.id">
            <td>
              <strong>{{ row.businessDate }}</strong>
              <small v-if="row.comment">{{ row.comment }}</small>
              <small v-if="row.rejectionReason" class="reject">{{ row.rejectionReason }}</small>
            </td>
            <td>
              <strong>{{ doctorName(row) }}</strong>
              <small v-if="row.employee.specialty">{{ row.employee.specialty }}</small>
            </td>
            <td>{{ row.hoursWorked }} h</td>
            <td>
              <UiInput
                v-if="row.status === 'PENDING'"
                v-model="rateDraft[row.id]"
                label="Taux horaire"
                type="number"
                min="0"
                step="100"
                aria-label="Taux horaire"
              />
              <span v-else>{{ formatFcfa(row.hourlyRateFcfa) }}</span>
            </td>
            <td>
              <strong v-if="row.amountFcfa > 0">{{ formatFcfa(row.amountFcfa) }}</strong>
              <span v-else class="muted">À calculer</span>
            </td>
            <td>{{ statusLabel(row.status) }}</td>
            <td class="actions">
              <template v-if="row.status === 'PENDING'">
                <UiButton
                  size="sm"
                  variant="primary"
                  :icon="Check"
                  :disabled="busyId === row.id"
                  @click="validateRow(row)"
                >
                  Valider
                </UiButton>
                <UiButton
                  size="sm"
                  variant="danger"
                  :icon="X"
                  :disabled="busyId === row.id"
                  @click="rejectRow(row)"
                >
                  Refuser
                </UiButton>
              </template>
              <UiButton
                v-else-if="row.status === 'VALIDATED'"
                size="sm"
                variant="ghost"
                :icon="Banknote"
                :disabled="busyId === row.id"
                @click="payRow(row)"
              >
                Payer
              </UiButton>
              <span v-else class="muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.overtime-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.overtime-panel__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}

.muted {
  color: var(--text-muted);
  margin: 0;
}

.overtime-table-wrap {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.overtime-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.overtime-table th,
.overtime-table td {
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

.overtime-table th {
  background: rgba(15, 118, 110, 0.06);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.overtime-table small {
  display: block;
  margin-top: 0.2rem;
  color: var(--text-muted);
  font-size: 0.78rem;
}

.overtime-table .reject {
  color: #b91c1c;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
</style>
