<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  Clock,
  Scissors,
  RefreshCw,
  CalendarDays,
  CheckCircle2,
  Phone,
} from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import {
  type SurgeryCaseRow,
  formatSurgeryDate,
  operationDateInputFromIso,
  todayDateInputValue,
} from '@/lib/surgery-case'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import { confirmAppModal } from '@/lib/api-modal-helper'

const surgeries = ref<SurgeryCaseRow[]>([])
const loading = ref(false)
const actionId = ref<string | null>(null)
const actionType = ref<'complete' | 'operation-date' | 'programming-date' | null>(null)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const operationDates = reactive<Record<string, string>>({})
const programmingDates = reactive<Record<string, string>>({})

const stats = computed(() => {
  const scheduled = surgeries.value.filter((s) => !!s.operationScheduledAt).length
  return { total: surgeries.value.length, scheduled }
})

async function load() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<SurgeryCaseRow[]>('/surgeries', {
      params: { scope: 'awaiting' },
    })
    surgeries.value = data
    for (const surgery of data) {
      if (!surgery.operationScheduledAt) {
        operationDates[surgery.id] = operationDates[surgery.id] ?? todayDateInputValue()
      } else {
        programmingDates[surgery.id] =
          programmingDates[surgery.id] ?? operationDateInputFromIso(surgery.operationScheduledAt)
      }
    }
  } catch {
    message.value = 'Impossible de charger les opérations en attente.'
    messageType.value = 'error'
    surgeries.value = []
  } finally {
    loading.value = false
  }
}

async function completeNow(id: string) {
  const ok = await confirmAppModal({
    title: 'Marquer comme effectuée',
    message: 'Confirmer que cette opération a bien été réalisée ? Elle passera dans Opérations effectuées.',
    confirmLabel: 'Confirmer',
    variant: 'primary',
  })
  if (!ok) return

  actionId.value = id
  actionType.value = 'complete'
  message.value = ''
  try {
    await api.post(`/surgeries/${id}/complete`)
    message.value = 'Opération enregistrée comme effectuée — visible dans Opérations effectuées.'
    messageType.value = 'success'
    await load()
  } catch {
    message.value = 'Erreur lors de la clôture de l\'opération.'
    messageType.value = 'error'
  } finally {
    actionId.value = null
    actionType.value = null
  }
}

async function saveOperationDate(id: string) {
  const operationDate = operationDates[id]
  if (!operationDate) {
    message.value = 'Indiquez la date d\'opération.'
    messageType.value = 'error'
    return
  }

  actionId.value = id
  actionType.value = 'operation-date'
  message.value = ''
  try {
    const { data } = await api.post<SurgeryCaseRow>(`/surgeries/${id}/schedule`, {
      operationDate,
    })
    if (data.status === 'COMPLETED') {
      message.value =
        'Date d\'opération dépassée — opération passée en effectuées (voir Opérations effectuées).'
    } else {
      message.value = `Date d'opération enregistrée : ${formatSurgeryDate(data.operationScheduledAt)}.`
    }
    messageType.value = 'success'
    await load()
  } catch {
    message.value = 'Erreur lors de l\'enregistrement de la date d\'opération.'
    messageType.value = 'error'
  } finally {
    actionId.value = null
    actionType.value = null
  }
}

async function saveProgrammingDate(id: string) {
  const operationDate = programmingDates[id]
  if (!operationDate) {
    message.value = 'Indiquez la date de programmation.'
    messageType.value = 'error'
    return
  }

  actionId.value = id
  actionType.value = 'programming-date'
  message.value = ''
  try {
    const { data } = await api.post<SurgeryCaseRow>(`/surgeries/${id}/schedule`, {
      operationDate,
    })
    if (data.status === 'COMPLETED') {
      message.value =
        'Date dépassée — opération passée en effectuées (voir Opérations effectuées).'
    } else {
      message.value = `Programmation mise à jour : ${formatSurgeryDate(data.operationScheduledAt)}.`
    }
    messageType.value = 'success'
    await load()
  } catch {
    message.value = 'Erreur lors de la mise à jour de la programmation.'
    messageType.value = 'error'
  } finally {
    actionId.value = null
    actionType.value = null
  }
}

function formatPaidAt(value?: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function isBusy(id: string, type: typeof actionType.value) {
  return actionId.value === id && actionType.value === type
}

onMounted(load)
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Opérations en attente"
        subtitle="Saisir la date d'opération · Ajuster la date de programmation si report"
        :icon="Clock"
      />
      <UiAlert v-if="message" :type="messageType" :message="message" />

      <div class="stats-grid ops-stats">
        <UiStatCard mini label="En attente" :value="stats.total" :icon="Scissors" variant="amber" />
        <UiStatCard mini label="Programmées" :value="stats.scheduled" :icon="Clock" variant="teal" />
      </div>
    </section>

    <section class="page-with-table__body">
      <UiCard
        title="File des opérations payées"
        class="ui-card--table-panel"
        :icon="Scissors"
        icon-variant="amber"
      >
        <template #actions>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="load">
            Actualiser
          </UiButton>
        </template>

        <p v-if="!loading && !surgeries.length" class="ops-empty">
          Aucune opération en attente
        </p>

        <div v-else class="ops-table-wrap">
          <table class="ops-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Intervention</th>
                <th>Chirurgien</th>
                <th>Montant</th>
                <th>Payée le</th>
                <th>Date d'opération</th>
                <th>Date de programmation</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="surgery in surgeries" :key="surgery.id">
                <td class="ops-table__patient">
                  <strong>{{ fullName(surgery.visit.patient.firstName, surgery.visit.patient.lastName) }}</strong>
                  <span class="ops-table__code">{{ surgery.visit.patient.code }}</span>
                  <span v-if="surgery.visit.patient.phone" class="ops-table__phone">
                    <Phone :size="12" />
                    {{ surgery.visit.patient.phone }}
                  </span>
                </td>
                <td>{{ surgery.interventionType.label }}</td>
                <td>Dr {{ fullName(surgery.surgeon.firstName, surgery.surgeon.lastName) }}</td>
                <td>{{ formatFcfa(surgery.totalCostFcfa) }}</td>
                <td>{{ formatPaidAt(surgery.paidAt ?? surgery.authorizedAt) }}</td>
                <td class="ops-table__date">
                  <UiInput
                    v-if="!surgery.operationScheduledAt"
                    v-model="operationDates[surgery.id]"
                    type="date"
                    label="Date d'opération"
                    :disabled="!!actionId"
                  />
                  <strong v-else>{{ formatSurgeryDate(surgery.operationScheduledAt) }}</strong>
                </td>
                <td class="ops-table__date">
                  <span v-if="!surgery.operationScheduledAt" class="ops-table__muted">—</span>
                  <UiInput
                    v-else
                    v-model="programmingDates[surgery.id]"
                    type="date"
                    label="Date de programmation"
                    :disabled="!!actionId"
                  />
                </td>
                <td class="ops-table__actions">
                  <template v-if="!surgery.operationScheduledAt">
                    <UiButton
                      variant="primary"
                      size="sm"
                      :icon="CalendarDays"
                      :disabled="!!actionId"
                      @click="saveOperationDate(surgery.id)"
                    >
                      {{ isBusy(surgery.id, 'operation-date') ? '…' : 'Valider la date' }}
                    </UiButton>
                  </template>
                  <template v-else>
                    <UiButton
                      variant="primary"
                      size="sm"
                      :icon="CalendarDays"
                      :disabled="!!actionId"
                      @click="saveProgrammingDate(surgery.id)"
                    >
                      {{ isBusy(surgery.id, 'programming-date') ? '…' : 'Mettre à jour' }}
                    </UiButton>
                  </template>
                  <UiButton
                    variant="success"
                    size="sm"
                    :icon="CheckCircle2"
                    :disabled="!!actionId"
                    @click="completeNow(surgery.id)"
                  >
                    {{ isBusy(surgery.id, 'complete') ? '…' : 'Effectuée' }}
                  </UiButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiCard>
    </section>
  </div>
</template>

<style scoped>
.ops-stats {
  margin-top: 0.35rem;
}

.ops-table-wrap {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  padding-bottom: 0.5rem;
  scrollbar-gutter: stable;
}

.ops-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.ops-table th,
.ops-table td {
  padding: 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

.ops-table th {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  background: #f8fafc;
  white-space: nowrap;
}

.ops-table__patient strong {
  display: block;
  margin-bottom: 0.15rem;
}

.ops-table__code {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--warning);
}

.ops-table__phone {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.ops-table__date {
  min-width: 11rem;
}

.ops-table__date :deep(.ui-input-wrap) {
  margin: 0;
}

.ops-table__muted {
  color: var(--text-muted);
}

.ops-table__actions {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 10rem;
}

.ops-empty {
  text-align: center;
  color: var(--text-light);
  padding: 2rem 1rem;
  font-size: 0.875rem;
}
</style>
