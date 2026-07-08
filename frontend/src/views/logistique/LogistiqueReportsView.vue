<script setup lang="ts">
import { BarChart3 } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import LogisticsReportsPanel from '@/components/logistique/LogisticsReportsPanel.vue'
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader title="Rapports" subtitle="Valeur du stock et statistiques de mouvements" :icon="BarChart3" />
    </section>
    <LogisticsReportsPanel />
  </div>
</template>
