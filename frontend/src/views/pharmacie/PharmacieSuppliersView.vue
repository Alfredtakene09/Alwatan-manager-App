<script setup lang="ts">
import { Building2 } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import PharmacySuppliersPanel from '@/components/pharmacie/PharmacySuppliersPanel.vue'
import { useAppI18n } from '@/i18n/useAppI18n'

const { uiText } = useAppI18n()
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        :title="uiText('Fournisseurs')"
        :subtitle="uiText('Contacts et références fournisseurs')"
        :icon="Building2"
      />
    </section>
    <PharmacySuppliersPanel />
  </div>
</template>
