<script setup lang="ts">
import { Package } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import PharmacyProductsPanel from '@/components/pharmacie/PharmacyProductsPanel.vue'
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Produits"
        subtitle="Catalogue, prix et niveaux de stock"
        :icon="Package"
      />
    </section>
    <PharmacyProductsPanel />
  </div>
</template>
