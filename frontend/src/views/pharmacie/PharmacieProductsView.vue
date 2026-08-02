<script setup lang="ts">
import { Package } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import PharmacyProductsPanel from '@/components/pharmacie/PharmacyProductsPanel.vue'
import { useAppI18n } from '@/i18n/useAppI18n'

const { uiText } = useAppI18n()
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        :title="uiText('Produits')"
        :subtitle="uiText('Catalogue, prix et niveaux de stock')"
        :icon="Package"
      />
    </section>
    <PharmacyProductsPanel />
  </div>
</template>
