<script setup lang="ts">
import { BarChart3 } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import PharmacyReportsPanel from '@/components/pharmacie/PharmacyReportsPanel.vue'
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Rapports"
        subtitle="Synthèse des ventes et performances"
        :icon="BarChart3"
      />
    </section>
    <section class="page-with-table__body">
      <PharmacyReportsPanel />
    </section>
  </div>
</template>
