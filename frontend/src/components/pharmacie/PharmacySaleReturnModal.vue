<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RotateCcw } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiAlert from '@/components/ui/UiAlert.vue'

export type PharmacySaleLineForReturn = {
  id: string
  productName: string
  sku: string
  quantity: number
  quantityReturned?: number
  quantityReturnable?: number
  unitPriceFcfa: number
  lineTotalFcfa: number
}

export type PharmacySaleForReturn = {
  id: string
  createdAt: string
  invoiceNumber: string | null
  patient: { code: string; firstName: string; lastName: string } | null
  externalClient: { code: string; firstName: string; lastName: string } | null
  pharmacist: { firstName: string; lastName: string }
  lines: PharmacySaleLineForReturn[]
}

const props = defineProps<{
  open: boolean
  sale: PharmacySaleForReturn | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  success: [saleId: string]
}>()

const { uiText } = useAppI18n()
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('error')
const quantities = ref<Record<string, number>>({})
const reasons = ref<Record<string, string>>({})

const returnableLines = computed(() =>
  (props.sale?.lines ?? []).filter((line) => (line.quantityReturnable ?? line.quantity) > 0),
)

const saleLabel = computed(() => {
  if (!props.sale) return ''
  if (props.sale.externalClient) {
    return `${props.sale.externalClient.code} — ${fullName(props.sale.externalClient.firstName, props.sale.externalClient.lastName)}`
  }
  if (props.sale.patient) {
    return `${props.sale.patient.code} — ${fullName(props.sale.patient.firstName, props.sale.patient.lastName)}`
  }
  return props.sale.invoiceNumber ?? props.sale.id.slice(0, 8)
})

watch(
  () => [props.open, props.sale?.id] as const,
  () => {
    if (!props.open || !props.sale) return
    message.value = ''
    quantities.value = {}
    reasons.value = {}
    for (const line of returnableLines.value) {
      quantities.value[line.id] = 0
      reasons.value[line.id] = ''
    }
  },
)

function close() {
  emit('update:open', false)
}

function maxReturnable(line: PharmacySaleLineForReturn) {
  return line.quantityReturnable ?? Math.max(0, line.quantity - (line.quantityReturned ?? 0))
}

const hasSelection = computed(() =>
  returnableLines.value.some((line) => {
    const qty = Math.floor(quantities.value[line.id] ?? 0)
    return qty > 0
  }),
)

async function submitReturn() {
  if (!props.sale) return
  const items = returnableLines.value
    .map((line) => ({
      saleLineId: line.id,
      quantity: Math.floor(quantities.value[line.id] ?? 0),
      reason: reasons.value[line.id]?.trim() || undefined,
    }))
    .filter((item) => item.quantity > 0)

  if (!items.length) {
    message.value = uiText('Indiquez au moins une quantité à retourner.')
    messageType.value = 'error'
    return
  }

  for (const item of items) {
    const line = returnableLines.value.find((row) => row.id === item.saleLineId)
    if (!line || item.quantity > maxReturnable(line)) {
      message.value = uiText('Quantité de retour invalide.')
      messageType.value = 'error'
      return
    }
  }

  saving.value = true
  message.value = ''
  try {
    await api.post(`/pharmacie/sales/${props.sale.id}/returns`, { items })
    messageType.value = 'success'
    message.value = uiText('Retour enregistré — stock mis à jour.')
    emit('success', props.sale.id)
    close()
  } catch (error: unknown) {
    const apiMessage =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
    message.value = apiMessage ?? uiText('Impossible d’enregistrer le retour.')
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiFormModal
    :open="open"
    :title="uiText('Enregistrer un retour')"
    :subtitle="sale ? saleLabel : ''"
    size="large"
    @close="close"
  >
    <UiAlert v-if="message" :type="messageType" :message="message" class="mb-3" />

    <p v-if="!sale" class="text-muted">{{ uiText('Sélectionnez une vente.') }}</p>
    <p v-else-if="!returnableLines.length" class="text-muted">
      {{ uiText('Aucun article retournable sur cette vente.') }}
    </p>

    <div v-else class="return-lines">
      <div v-for="line in returnableLines" :key="line.id" class="return-line">
        <div class="return-line__head">
          <strong>{{ line.productName }}</strong>
          <span class="text-muted">{{ line.sku }}</span>
        </div>
        <p class="text-muted return-line__meta">
          {{ uiText('Vendu') }} : {{ line.quantity }}
          <template v-if="line.quantityReturned">
            · {{ uiText('Déjà retourné') }} : {{ line.quantityReturned }}
          </template>
          · {{ uiText('Reste') }} : {{ maxReturnable(line) }}
          · {{ formatFcfa(line.unitPriceFcfa) }}
        </p>
        <div class="return-line__fields">
          <UiInput
            v-model.number="quantities[line.id]"
            type="number"
            :min="0"
            :max="maxReturnable(line)"
            :label="uiText('Qté retour')"
          />
          <UiInput
            v-model="reasons[line.id]"
            type="text"
            :label="uiText('Motif (optionnel)')"
            :placeholder="uiText('Ex. erreur de dispensation')"
          />
        </div>
      </div>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="close">{{ uiText('Annuler') }}</UiButton>
      <UiButton
        variant="primary"
        :icon="RotateCcw"
        :disabled="!sale || !returnableLines.length || !hasSelection"
        :loading="saving"
        @click="submitReturn"
      >
        {{ uiText('Valider le retour') }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.return-lines {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.return-line {
  border: 1px solid var(--border-subtle, #e5e7eb);
  border-radius: 8px;
  padding: 0.75rem 1rem;
}
.return-line__head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
}
.return-line__meta {
  margin: 0.35rem 0 0.65rem;
  font-size: 0.875rem;
}
.return-line__fields {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 0.75rem;
}
@media (max-width: 640px) {
  .return-line__fields {
    grid-template-columns: 1fr;
  }
}
</style>
