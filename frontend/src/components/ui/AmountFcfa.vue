<script setup lang="ts">
import { computed } from 'vue'
import { formatFcfaDigits } from '@/lib/format-fcfa'

const props = withDefaults(
  defineProps<{
    amount: number
    variant?: 'in' | 'out' | 'net-pos' | 'net-neg' | 'neutral'
    size?: 'sm' | 'md' | 'lg'
    bold?: boolean
    showUnit?: boolean
  }>(),
  {
    variant: 'neutral',
    size: 'md',
    bold: false,
    showUnit: true,
  },
)

const digits = computed(() => formatFcfaDigits(props.amount))
</script>

<template>
  <span
    class="amount-fcfa"
    :class="[
      `amount-fcfa--${variant}`,
      `amount-fcfa--${size}`,
      { 'amount-fcfa--bold': bold },
    ]"
  >
    <span class="amount-fcfa__value">{{ digits }}</span>
    <span v-if="showUnit" class="amount-fcfa__unit">FCFA</span>
  </span>
</template>

<style scoped>
.amount-fcfa {
  display: inline-flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 0.28rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  line-height: 1.2;
}

.amount-fcfa--bold,
.amount-fcfa--bold .amount-fcfa__value {
  font-weight: 700;
}

.amount-fcfa--sm {
  font-size: 0.8125rem;
}

.amount-fcfa--md {
  font-size: 0.875rem;
}

.amount-fcfa--lg {
  font-size: 0.9375rem;
}

.amount-fcfa--lg .amount-fcfa__value {
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: 0.01em;
}

.amount-fcfa__value {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.amount-fcfa__unit {
  font-size: 0.68em;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0.72;
}

.amount-fcfa--in {
  color: #15803d;
}

.amount-fcfa--in .amount-fcfa__unit {
  color: #166534;
  opacity: 0.65;
}

.amount-fcfa--out {
  color: #be123c;
}

.amount-fcfa--out .amount-fcfa__unit {
  color: #9f1239;
  opacity: 0.65;
}

.amount-fcfa--net-pos {
  color: #15803d;
}

.amount-fcfa--net-neg {
  color: #be123c;
}

.amount-fcfa--neutral {
  color: inherit;
}

@media print {
  .amount-fcfa__unit {
    opacity: 0.85;
  }
}
</style>
