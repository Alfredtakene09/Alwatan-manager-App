<script setup lang="ts">
import { computed } from 'vue'
import { History, Banknote, ListOrdered, User } from '@lucide/vue'
import '@/assets/gestionnaire-page.css'
import '@/assets/gestionnaire-form-modal.css'
import { formatFcfa } from '@/lib/roles'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

export type DisburseHistoryRow = {
  id: string
  settledAt: string
  registerLabel: string
  cashierName: string
  amountFcfa: number
  transactionCount: number
  gestionnaireName: string
  comment?: string | null
  shiftLabel?: string
}

export type DisburseHistoryDetail = DisburseHistoryRow & {
  businessDate?: string
  transactions?: Array<{
    id: string
    invoiceNumber: string
    typeLabel: string
    amountFcfa: number
  }>
}

const props = defineProps<{
  open: boolean
  mode?: 'view' | 'edit'
  row: DisburseHistoryRow | null
  detail: DisburseHistoryDetail | null
  loading?: boolean
  saving?: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { uiText, dateTimeText } = useAppI18n()

const display = computed(() => props.detail ?? props.row)
</script>

<template>
  <UiFormModal
    v-if="open && display"
    title-id="gestionnaire-disburse-history-modal"
    :title="'Détail du décaissement'"
    :subtitle="dateTimeText(display.settledAt)"
    :icon="History"
    size="wide"
    @close="emit('close')"
  >
    <div v-if="loading" class="history-modal__loading">{{ uiText('Chargement du détail…') }}</div>

    <template v-else>
      <div class="history-modal__hero">
        <div>
          <p class="history-modal__eyebrow">{{ display.registerLabel }}</p>
          <p class="history-modal__amount">{{ formatFcfa(display.amountFcfa) }}</p>
          <p v-if="display.shiftLabel" class="history-modal__meta">{{ display.shiftLabel }}</p>
        </div>
        <span class="history-modal__pill">
          <ListOrdered :size="12" />
          {{ translateTemplate('{n} transaction(s)', { n: display.transactionCount }) }}
        </span>
      </div>

      <div class="history-modal__facts">
        <div class="history-modal__fact">
          <User :size="14" />
          <span>{{ uiText('Caissier') }} : <strong>{{ display.cashierName }}</strong></span>
        </div>
        <div class="history-modal__fact">
          <Banknote :size="14" />
          <span>{{ uiText('Gestionnaire') }} : <strong>{{ display.gestionnaireName }}</strong></span>
        </div>
      </div>

      <section v-if="detail?.transactions?.length" class="form-panel gestionnaire-form-panel">
        <h3 class="form-panel__title">{{ uiText('Transactions incluses') }}</h3>
        <ul class="history-modal__tx-list">
          <li v-for="tx in detail.transactions" :key="tx.id">
            <span>{{ tx.invoiceNumber }} — {{ tx.typeLabel }}</span>
            <strong>{{ formatFcfa(tx.amountFcfa) }}</strong>
          </li>
        </ul>
      </section>

      <section class="form-panel gestionnaire-form-panel">
        <h3 class="form-panel__title">{{ uiText('Commentaire') }}</h3>
        <p v-if="!display.comment" class="history-modal__empty">{{ uiText('Aucun commentaire') }}</p>
        <p v-else class="history-modal__comment">{{ display.comment }}</p>
      </section>
    </template>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Fermer</UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.history-modal__loading {
  padding: 2rem 1rem;
  text-align: center;
  color: #78716c;
  font-size: 0.875rem;
}

.history-modal__hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.1rem;
  border-radius: 14px;
  background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 48%, #fff 100%);
  border: 1px solid rgba(217, 119, 6, 0.22);
  margin-bottom: 0.75rem;
}

.history-modal__eyebrow {
  margin: 0 0 0.15rem;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #92400e;
}

.history-modal__amount {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 800;
  color: #b45309;
  font-variant-numeric: tabular-nums;
}

.history-modal__meta {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: #78716c;
}

.history-modal__pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.65rem;
  border-radius: 999px;
  background: #fff;
  border: 1px solid rgba(217, 119, 6, 0.2);
  color: #92400e;
  font-size: 0.75rem;
  font-weight: 700;
  white-space: nowrap;
}

.history-modal__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.history-modal__fact {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid rgba(15, 23, 42, 0.06);
  font-size: 0.8125rem;
  color: #475569;
}

.history-modal__tx-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.history-modal__tx-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  background: #fff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  font-size: 0.8125rem;
}

.history-modal__empty {
  margin: 0;
  font-size: 0.8125rem;
  color: #94a3b8;
}

.history-modal__comment {
  margin: 0;
  font-size: 0.875rem;
  color: #334155;
  white-space: pre-wrap;
}

@media (max-width: 640px) {
  .history-modal__facts {
    grid-template-columns: 1fr;
  }
}
</style>
