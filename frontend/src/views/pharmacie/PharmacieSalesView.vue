<script setup lang="ts">
import { History } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import PharmacySalesHistoryPanel from '@/components/pharmacie/PharmacySalesHistoryPanel.vue'
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Ventes"
        subtitle="Historique des dispensations et ventes au comptoir"
        :icon="History"
      />
    </section>
    <PharmacySalesHistoryPanel />
  </div>
</template>
