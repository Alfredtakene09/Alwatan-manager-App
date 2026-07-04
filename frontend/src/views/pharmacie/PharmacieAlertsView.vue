<script setup lang="ts">
import { BellRing } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import PharmacyAlertsPanel from '@/components/pharmacie/PharmacyAlertsPanel.vue'
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Alertes"
        subtitle="Stocks bas, péremption et ruptures"
        :icon="BellRing"
      />
    </section>
    <PharmacyAlertsPanel />
  </div>
</template>
