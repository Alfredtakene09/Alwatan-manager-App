<script setup lang="ts">
import { Tags } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import LogisticsCategoriesPanel from '@/components/logistique/LogisticsCategoriesPanel.vue'
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader title="Catégories" subtitle="Organisation du stock logistique" :icon="Tags" />
    </section>
    <LogisticsCategoriesPanel />
  </div>
</template>
