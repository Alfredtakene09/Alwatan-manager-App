<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { Clock, ShieldCheck } from '@lucide/vue'
import { formatFcfa } from '@/lib/roles'
import { formatStayRemaining, stayAmountLabel } from '@/lib/hospitalization-admission'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiBadge from '@/components/ui/UiBadge.vue'

export type OccupiedStayCard = {
  id: string
  patientName: string
  roomName: string
  roomType: string
  endDate?: string | null
  totalDueFcfa: number
  paidFcfa: number
}

defineProps<{
  occupants: OccupiedStayCard[]
}>()

const { uiText } = useAppI18n()
const now = ref(new Date())
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  timer = setInterval(() => {
    now.value = new Date()
  }, 30_000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

function amountText(stay: OccupiedStayCard) {
  const amount = stayAmountLabel(stay.totalDueFcfa, stay.paidFcfa)
  if (amount.kind === 'paid') return `${uiText('Payé')} ${formatFcfa(amount.amount)}`
  return `${uiText('Reste')} ${formatFcfa(amount.amount)}`
}
</script>

<template>
  <p v-if="!occupants.length" class="occupied-empty">{{ uiText('Aucune salle occupée') }}</p>
  <div v-else class="occupied-grid">
    <article v-for="stay in occupants" :key="stay.id" class="occupied-card">
      <div class="occupied-card__head">
        <strong>{{ stay.roomName }}</strong>
        <UiBadge :variant="stay.roomType === 'VIP' ? 'primary' : 'info'">
          {{ stay.roomType === 'SIMPLE' ? uiText('Simple') : stay.roomType }}
        </UiBadge>
      </div>
      <p class="occupied-card__patient">
        <ShieldCheck :size="14" />
        {{ stay.patientName }}
      </p>
      <p class="occupied-card__meta">
        <Clock :size="14" />
        {{ uiText('Temps restant') }} : {{ formatStayRemaining(stay.endDate, now) }}
      </p>
      <p class="occupied-card__amount" :class="stayAmountLabel(stay.totalDueFcfa, stay.paidFcfa).kind">
        {{ amountText(stay) }}
      </p>
    </article>
  </div>
</template>

<style scoped>
.occupied-empty {
  margin: 0;
  text-align: center;
  color: var(--text-light);
  padding: 1.5rem;
  font-size: 0.875rem;
}

.occupied-grid {
  display: grid;
  gap: 0.875rem;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}

.occupied-card {
  padding: 1rem;
  border-radius: var(--radius-sm);
  border: 1.5px solid #fecaca;
  background: linear-gradient(135deg, #fef2f2, #fff1f2);
}

.occupied-card__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.65rem;
}

.occupied-card__patient,
.occupied-card__meta,
.occupied-card__amount {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.4rem 0 0;
  font-size: 0.8125rem;
}

.occupied-card__patient {
  font-weight: 600;
  color: var(--text);
}

.occupied-card__meta {
  color: var(--text-muted);
}

.occupied-card__amount {
  font-weight: 700;
}

.occupied-card__amount.paid {
  color: #047857;
}

.occupied-card__amount.due {
  color: #b45309;
}
</style>
