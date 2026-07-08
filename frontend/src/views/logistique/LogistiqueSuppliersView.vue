<script setup lang="ts">
import { Building2 } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import LogisticsSuppliersPanel from '@/components/logistique/LogisticsSuppliersPanel.vue'
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader title="Fournisseurs" subtitle="Contacts et références fournisseurs" :icon="Building2" />
    </section>
    <LogisticsSuppliersPanel />
  </div>
</template>
