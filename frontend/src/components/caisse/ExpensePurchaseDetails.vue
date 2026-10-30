<script lang="ts">
import { formatFcfa } from '@/lib/roles'

export type ExpensePurchaseDetails = {
  invoiceNumber: string | null
  lines: Array<{ productName: string; quantity: number; unitCostFcfa: number; totalFcfa: number }>
}

/** Texte des produits achetés pour les exports (une ligne par produit). */
export function purchaseDetailsText(purchase: ExpensePurchaseDetails | null | undefined) {
  if (!purchase?.lines.length) return ''
  return purchase.lines
    .map((line) => `${line.productName} × ${line.quantity} à ${formatFcfa(line.unitCostFcfa)} = ${formatFcfa(line.totalFcfa)}`)
    .join(' ; ')
}
</script>

<script setup lang="ts">
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

defineProps<{ purchase: ExpensePurchaseDetails }>()

const { uiText } = useAppI18n()
</script>

<template>
  <details v-if="purchase.lines.length" class="purchase-details">
    <summary>{{ translateTemplate('{n} produit(s) acheté(s)', { n: purchase.lines.length }) }}</summary>
    <table>
      <thead>
        <tr>
          <th>{{ uiText('Produit') }}</th>
          <th>{{ uiText('Qté') }}</th>
          <th>{{ uiText("Prix d'achat") }}</th>
          <th>{{ uiText('Total') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(line, index) in purchase.lines" :key="index">
          <td>{{ line.productName }}</td>
          <td>{{ line.quantity }}</td>
          <td>{{ formatFcfa(line.unitCostFcfa) }}</td>
          <td>{{ formatFcfa(line.totalFcfa) }}</td>
        </tr>
      </tbody>
    </table>
  </details>
</template>

<style scoped>
.purchase-details {
  margin-top: 0.25rem;
  font-size: 0.75rem;
}

.purchase-details summary {
  cursor: pointer;
  color: var(--primary-700, #0f766e);
  font-weight: 600;
}

.purchase-details table {
  width: 100%;
  margin-top: 0.3rem;
  border-collapse: collapse;
}

.purchase-details th,
.purchase-details td {
  padding: 0.2rem 0.4rem;
  border-top: 1px solid var(--border);
  text-align: left;
  font-weight: 400;
}

.purchase-details th {
  color: var(--text-muted);
  font-weight: 650;
}
</style>
