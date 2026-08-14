<script setup lang="ts">
import { computed } from 'vue'
import { Banknote, Check, Calendar, Undo2 } from '@lucide/vue'
import { fullName, formatFcfa } from '@/lib/roles'
import { type SurgeryCaseRow, formatSurgeryDate } from '@/lib/surgery-case'
import {
  computeOperationShares,
  formatAssistantLabel,
  surgeryCompletedAtIso,
} from '@/lib/surgery-shares'
import {
  formatSharePaymentLine,
  getApplicableShareKinds,
  getUnpaidShareKinds,
  hasAnySharePaid,
  isFullyPaid,
} from '@/lib/surgery-share-payments'
import { isPatientPaymentInProgress } from '@/lib/surgery-status'
import '@/assets/simple-table.css'

const props = defineProps<{
  surgeries: SurgeryCaseRow[]
  loading?: boolean
  fill?: boolean
  busyId?: string | null
}>()

const emit = defineEmits<{
  revert: [id: string]
  postpone: [id: string]
  payShares: [id: string]
  encaisser: [id: string]
}>()

const rows = computed(() =>
  [...props.surgeries]
    .sort(
      (a, b) =>
        new Date(surgeryCompletedAtIso(b)).getTime() - new Date(surgeryCompletedAtIso(a)).getTime(),
    )
    .map((surgery) => {
      const shares = computeOperationShares(surgery)
      const assistant = formatAssistantLabel(surgery)
      const completedAt = surgery.completedAt ?? surgery.operationScheduledAt ?? surgery.updatedAt
      const completedDate = new Date(completedAt)
      const shareParts = getApplicableShareKinds(surgery).map((kind) =>
        formatSharePaymentLine(surgery, kind),
      )
      const unpaidCount = getUnpaidShareKinds(surgery).length
      const fullyPaid = isFullyPaid(surgery)
      const anyPaid = hasAnySharePaid(surgery)
      const paymentInProgress = isPatientPaymentInProgress(surgery)
      const collectedFcfa = surgery.invoice?.paidAmountFcfa ?? 0
      const billedFcfa = surgery.invoice?.amountFcfa ?? surgery.totalCostFcfa

      let paymentStatusLabel: string
      let paymentStatusVariant: 'warning' | 'success'
      if (paymentInProgress) {
        paymentStatusLabel = `Paiement en cours · ${formatFcfa(collectedFcfa)} / ${formatFcfa(billedFcfa)}`
        paymentStatusVariant = 'warning'
      } else if (fullyPaid) {
        paymentStatusLabel = 'Tout réglé'
        paymentStatusVariant = 'success'
      } else if (anyPaid) {
        paymentStatusLabel = `${unpaidCount} part(s) restante(s)`
        paymentStatusVariant = 'warning'
      } else {
        paymentStatusLabel = 'À régler'
        paymentStatusVariant = 'warning'
      }

      return {
        id: surgery.id,
        patientName: fullName(surgery.visit.patient.firstName, surgery.visit.patient.lastName),
        intervention: surgery.interventionType.label,
        surgeonName: `Dr ${fullName(surgery.surgeon.firstName, surgery.surgeon.lastName)}`,
        assistantLabel: assistant,
        totalAmount: formatFcfa(shares.totalFcfa),
        shareBreakdown: shareParts.join(' · '),
        paymentStatusLabel,
        paymentStatusVariant,
        fullyPaid,
        anyPaid,
        paymentInProgress,
        completed: surgery.status === 'COMPLETED',
        hasUnpaidShares: unpaidCount > 0,
        completedDate: completedDate.toLocaleDateString('fr-FR'),
        completedTime: completedDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        scheduledLabel: formatSurgeryDate(surgery.operationScheduledAt ?? surgery.completedAt),
        busy: props.busyId === surgery.id,
      }
    }),
)

function onAction(action: 'revert' | 'postpone' | 'payShares' | 'encaisser', id: string) {
  if (props.busyId) return
  if (action === 'revert') emit('revert', id)
  else if (action === 'postpone') emit('postpone', id)
  else if (action === 'payShares') emit('payShares', id)
  else if (action === 'encaisser') emit('encaisser', id)
}
</script>

<template>
  <div
    class="simple-table-shell"
    :class="{ 'simple-table-shell--fill': fill !== false }"
  >
    <div
      v-if="loading"
      class="simple-table-overlay" role="status"
      aria-live="polite"
    >
      <span class="simple-table-spinner" aria-hidden="true" />
      Chargement des opérations effectuées…
    </div>

    <div class="simple-table-scroll">
      <p v-if="!loading && !rows.length" class="simple-table__empty">
        Aucune opération effectuée
      </p>
      <div v-else class="simple-table-wrap">
        <table class="simple-table">
          <thead>
            <tr>
              <th class="simple-table__num">#</th>
              <th>Patient</th>
              <th>Intervention</th>
              <th>Équipe</th>
              <th>Montant &amp; répartition</th>
              <th>Date prévue</th>
              <th>Effectuée le</th>
              <th class="simple-table__actions-head">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in rows" :key="row.id">
              <td class="simple-table__num">{{ index + 1 }}</td>
              <td>
                <span class="st-name">{{ row.patientName }}</span>
              </td>
              <td>
                <span class="st-name">{{ row.intervention }}</span>
              </td>
              <td>
                <span class="st-name">{{ row.surgeonName }}</span>
                <span v-if="row.assistantLabel" class="st-team-sub">Asst. {{ row.assistantLabel }}</span>
                <span v-else class="st-team-sub st-muted">Sans assistant</span>
              </td>
              <td>
                <span class="st-amount">{{ row.totalAmount }}</span>
                <span class="st-share-breakdown">{{ row.shareBreakdown }}</span>
                <span class="st-badge" :class="`st-badge--${row.paymentStatusVariant}`">
                  {{ row.paymentStatusLabel }}
                </span>
              </td>
              <td>
                <span class="st-date">{{ row.scheduledLabel }}</span>
              </td>
              <td>
                <template v-if="row.paymentInProgress">
                  <span class="st-badge st-badge--warning">Paiement en cours</span>
                  <span class="st-sub">Patient non soldé</span>
                </template>
                <template v-else>
                  <span class="st-badge st-badge--success">{{ row.completedDate }}</span>
                  <span class="st-sub">{{ row.completedTime }}</span>
                </template>
              </td>
              <td class="simple-table__actions">
                <div class="st-actions">
                  <template v-if="row.paymentInProgress || !row.completed">
                    <button
                      type="button"
                      class="st-btn st-btn--pay"
                      title="Encaisser"
                      aria-label="Encaisser"
                      :disabled="row.busy"
                      @click="onAction('encaisser', row.id)"
                    >
                      <Banknote :size="15" />
                    </button>
                  </template>
                  <template v-else>
                    <span
                      v-if="row.fullyPaid"
                      class="st-btn st-btn--paid"
                      title="Réglé"
                      aria-label="Réglé"
                    >
                      <Check :size="15" />
                    </span>
                    <button
                      v-else-if="row.hasUnpaidShares"
                      type="button"
                      class="st-btn st-btn--accent"
                      title="Enregistrer un paiement"
                      aria-label="Enregistrer un paiement"
                      :disabled="row.busy"
                      @click="onAction('payShares', row.id)"
                    >
                      <Banknote :size="15" />
                    </button>
                    <template v-if="!row.anyPaid">
                      <button
                        type="button"
                        class="st-btn st-btn--soft"
                        title="Repousser"
                        aria-label="Repousser"
                        :disabled="row.busy"
                        @click="onAction('postpone', row.id)"
                      >
                        <Calendar :size="15" />
                      </button>
                      <button
                        type="button"
                        class="st-btn st-btn--soft"
                        title="Retour en attente"
                        aria-label="Retour en attente"
                        :disabled="row.busy"
                        @click="onAction('revert', row.id)"
                      >
                        <Undo2 :size="15" />
                      </button>
                    </template>
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
.st-share-breakdown {
  display: block;
  font-size: 0.75rem;
  color: var(--text-muted);
  max-width: 16rem;
}

.st-team-sub {
  display: block;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.st-btn--paid {
  opacity: 0.85;
  pointer-events: none;
  background: #ecfdf5;
  border-color: #6ee7b7;
  color: #047857;
}
</style>
