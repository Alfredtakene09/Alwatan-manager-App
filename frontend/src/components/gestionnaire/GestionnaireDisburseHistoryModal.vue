<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { History, Save, Banknote, ListOrdered, User } from '@lucide/vue'
import '@/assets/gestionnaire-page.css'
import '@/assets/gestionnaire-form-modal.css'
import { formatFcfa } from '@/lib/roles'
import { formatDateTimeFr } from '@/lib/gestionnaire-dashboard'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import UiButton from '@/components/ui/UiButton.vue'

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
  mode: 'view' | 'edit'
  row: DisburseHistoryRow | null
  detail: DisburseHistoryDetail | null
  loading?: boolean
  saving?: boolean
}>()

const emit = defineEmits<{
  close: []
  save: [comment: string]
  switchToEdit: []
}>()

const comment = ref('')

watch(
  () => [props.open, props.row, props.mode] as const,
  ([isOpen, row]) => {
    if (isOpen && row) {
      comment.value = row.comment ?? ''
    }
  },
  { immediate: true },
)

const modalTitle = computed(() =>
  props.mode === 'edit' ? 'Modifier le décaissement' : 'Détail du décaissement',
)

const display = computed(() => props.detail ?? props.row)
</script>

<template>
  <UiFormModal
    v-if="open && display"
    title-id="gestionnaire-disburse-history-modal"
    :title="modalTitle"
    :subtitle="formatDateTimeFr(display.settledAt)"
    :icon="History"
    size="wide"
    @close="emit('close')"
  >
    <div v-if="loading" class="history-modal__loading">Chargement du détail…</div>

    <template v-else>
      <div class="history-modal__hero">
        <div>
          <p class="history-modal__eyebrow">{{ display.registerLabel }}</p>
          <p class="history-modal__amount">{{ formatFcfa(display.amountFcfa) }}</p>
          <p v-if="display.shiftLabel" class="history-modal__meta">{{ display.shiftLabel }}</p>
        </div>
        <span class="history-modal__pill">
          <ListOrdered :size="12" />
          {{ display.transactionCount }} transaction(s)
        </span>
      </div>

      <div class="history-modal__facts">
        <div class="history-modal__fact">
          <User :size="14" />
          <span>Caissier : <strong>{{ display.cashierName }}</strong></span>
        </div>
        <div class="history-modal__fact">
          <Banknote :size="14" />
          <span>Gestionnaire : <strong>{{ display.gestionnaireName }}</strong></span>
        </div>
      </div>

      <section v-if="mode === 'view' && detail?.transactions?.length" class="form-panel gestionnaire-form-panel">
        <h3 class="form-panel__title">Transactions incluses</h3>
        <ul class="history-modal__tx-list">
          <li v-for="tx in detail.transactions" :key="tx.id">
            <span>{{ tx.invoiceNumber }} — {{ tx.typeLabel }}</span>
            <strong>{{ formatFcfa(tx.amountFcfa) }}</strong>
          </li>
        </ul>
      </section>

      <section class="form-panel gestionnaire-form-panel">
        <h3 class="form-panel__title">Commentaire</h3>
        <p v-if="mode === 'view' && !display.comment" class="history-modal__empty">Aucun commentaire</p>
        <p v-else-if="mode === 'view'" class="history-modal__comment">{{ display.comment }}</p>
        <UiTextarea
          v-else
          v-model="comment"
          label="Note de passage"
          placeholder="Précisions sur ce décaissement…"
        />
      </section>
    </template>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Fermer</UiButton>
      <UiButton
        v-if="mode === 'view'"
        variant="primary"
        :icon="Save"
        @click="emit('switchToEdit')"
      >
        Modifier
      </UiButton>
      <UiButton
        v-else
        variant="primary"
        :icon="Save"
        :disabled="saving"
        @click="emit('save', comment.trim())"
      >
        {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
      </UiButton>
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
  letter-spacing: 0.08em;
  color: #b45309;
}

.history-modal__amount {
  margin: 0;
  font-size: 1.65rem;
  font-weight: 800;
  color: #78350f;
  font-variant-numeric: tabular-nums;
}

.history-modal__meta {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: #92400e;
}

.history-modal__pill {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0.6rem;
  border-radius: 999px;
  background: #fff;
  border: 1px solid rgba(217, 119, 6, 0.2);
  color: #92400e;
  font-size: 0.6875rem;
  font-weight: 700;
  flex-shrink: 0;
}

.history-modal__facts {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-bottom: 0.75rem;
}

.history-modal__fact {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.8125rem;
  color: #57534e;
}

.history-modal__tx-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.history-modal__tx-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  background: #fff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  font-size: 0.8125rem;
}

.history-modal__empty {
  margin: 0;
  font-size: 0.8125rem;
  color: #a8a29e;
  font-style: italic;
}

.history-modal__comment {
  margin: 0;
  padding: 0.75rem 0.85rem;
  border-radius: 10px;
  background: #fff;
  border: 1px solid rgba(15, 23, 42, 0.08);
  font-size: 0.875rem;
  color: #44403c;
  line-height: 1.5;
  white-space: pre-wrap;
}
</style>
