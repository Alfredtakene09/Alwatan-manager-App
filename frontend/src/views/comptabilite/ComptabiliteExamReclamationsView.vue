<script setup lang="ts">
import { ClipboardList } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import ExamensPayesSubnav from '@/components/comptabilite/ExamensPayesSubnav.vue'
import ExamReclamationsHistoryPanel from '@/components/comptabilite/ExamReclamationsHistoryPanel.vue'
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Historique des réclamations"
        subtitle="Remboursements appliqués immédiatement lors de la validation d'une réclamation"
        :icon="ClipboardList"
      />
      <ExamensPayesSubnav />
    </section>

    <section class="page-with-table__body">
      <ExamReclamationsHistoryPanel />
    </section>
  </div>
</template>
