<script setup lang="ts">
import { ArrowDownUp } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import PharmacyStockMovementsPanel from '@/components/pharmacie/PharmacyStockMovementsPanel.vue'
import { useAppI18n } from '@/i18n/useAppI18n'

const { uiText } = useAppI18n()
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        :title="uiText('Mouvements')"
        :subtitle="uiText('Entrées, sorties et ajustements de stock')"
        :icon="ArrowDownUp"
      />
    </section>
    <PharmacyStockMovementsPanel />
  </div>
</template>
