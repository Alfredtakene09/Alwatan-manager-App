<script setup lang="ts">
import { BellRing } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import PharmacyAlertsPanel from '@/components/pharmacie/PharmacyAlertsPanel.vue'
import { useAppI18n } from '@/i18n/useAppI18n'

const { uiText } = useAppI18n()
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        :title="uiText('Alertes')"
        :subtitle="uiText('Stocks bas, péremption et ruptures')"
        :icon="BellRing"
      />
    </section>
    <section class="page-with-table__body pharmacy-alerts-body">
      <PharmacyAlertsPanel />
    </section>
  </div>
</template>

<style scoped>
.pharmacy-alerts-body {
  overflow: auto;
}
</style>
