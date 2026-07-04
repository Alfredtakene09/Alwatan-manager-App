<script setup lang="ts">
import { ArrowDownUp } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import PharmacyStockMovementsPanel from '@/components/pharmacie/PharmacyStockMovementsPanel.vue'
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Mouvements"
        subtitle="Entrées, sorties et ajustements de stock"
        :icon="ArrowDownUp"
      />
    </section>
    <PharmacyStockMovementsPanel />
  </div>
</template>
