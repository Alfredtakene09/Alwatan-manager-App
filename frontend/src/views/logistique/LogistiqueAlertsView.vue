<script setup lang="ts">
import { BellRing } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import LogisticsAlertsPanel from '@/components/logistique/LogisticsAlertsPanel.vue'
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader title="Alertes" subtitle="Stocks bas et péremption" :icon="BellRing" />
    </section>
    <LogisticsAlertsPanel />
  </div>
</template>
