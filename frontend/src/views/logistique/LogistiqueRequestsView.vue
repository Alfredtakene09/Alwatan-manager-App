<script setup lang="ts">
import { ClipboardList } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import LogisticsRequestsPanel from '@/components/logistique/LogisticsRequestsPanel.vue'
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Demandes internes"
        subtitle="Bons de sortie des services (labo, bloc, hospitalisation…)"
        :icon="ClipboardList"
      />
    </section>
    <LogisticsRequestsPanel />
  </div>
</template>
