<script setup lang="ts">
import { Package } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import LogisticsItemsPanel from '@/components/logistique/LogisticsItemsPanel.vue'
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Articles"
        subtitle="Catalogue des consommables et matériel non-médicament"
        :icon="Package"
      />
    </section>
    <LogisticsItemsPanel />
  </div>
</template>
