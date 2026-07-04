<script setup lang="ts">
import { Tags } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import PharmacyCategoriesPanel from '@/components/pharmacie/PharmacyCategoriesPanel.vue'
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Catégories"
        subtitle="Organisation du catalogue produits"
        :icon="Tags"
      />
    </section>
    <PharmacyCategoriesPanel />
  </div>
</template>
