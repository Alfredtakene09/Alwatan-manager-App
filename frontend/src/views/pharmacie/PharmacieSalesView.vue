<script setup lang="ts">
import { History } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import PharmacySalesHistoryPanel from '@/components/pharmacie/PharmacySalesHistoryPanel.vue'
import { useAppI18n } from '@/i18n/useAppI18n'

const { uiText } = useAppI18n()
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        :title="uiText('Ventes')"
        :subtitle="uiText('Historique des dispensations et ventes au comptoir')"
        :icon="History"
      />
    </section>
    <PharmacySalesHistoryPanel />
  </div>
</template>
