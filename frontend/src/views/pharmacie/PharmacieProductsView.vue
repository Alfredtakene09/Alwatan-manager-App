<script setup lang="ts">
import { computed, ref } from 'vue'
import { FileText, Package, Plus } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiButton from '@/components/ui/UiButton.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import PharmacyProductsPanel from '@/components/pharmacie/PharmacyProductsPanel.vue'
import { useAppI18n } from '@/i18n/useAppI18n'
import { useAuthStore } from '@/stores/auth'
import { canAccessModule } from '@/lib/roles'
import { isUiActionAllowed } from '@/lib/ui-actions'

const { uiText } = useAppI18n()
const auth = useAuthStore()
const panel = ref<{
  exportPdf: () => void
  exportExcel: () => void
  exportWord: () => void
  openCreateModal: () => void | Promise<void>
  openPurchaseModal: () => void | Promise<void>
  exportDisabled: boolean
} | null>(null)

const canManageCatalog = computed(() =>
  auth.user ? canAccessModule(auth.user.role, 'pharmacie') : false,
)
const canAddByInvoice = computed(
  () => canManageCatalog.value && isUiActionAllowed(auth.user, 'pharmacie.purchase_invoice'),
)
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        :title="uiText('Produits')"
        :subtitle="uiText('Catalogue, prix et niveaux de stock')"
        :icon="Package"
      >
        <template #actions>
          <div class="products-page-actions">
            <ExportButtons
              :disabled="!panel || panel.exportDisabled"
              @pdf="panel?.exportPdf()"
              @excel="panel?.exportExcel()"
              @word="panel?.exportWord()"
            />
            <UiButton
              v-if="canAddByInvoice"
              variant="secondary"
              size="sm"
              :icon="FileText"
              @click="panel?.openPurchaseModal()"
            >
              {{ uiText('Ajout par facture') }}
            </UiButton>
            <UiButton
              v-if="canManageCatalog"
              variant="primary"
              size="sm"
              :icon="Plus"
              @click="panel?.openCreateModal()"
            >
              {{ uiText('Nouveau produit') }}
            </UiButton>
          </div>
        </template>
      </UiPageHeader>
    </section>
    <PharmacyProductsPanel ref="panel" />
  </div>
</template>

<style scoped>
.products-page-actions {
  display: inline-flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.4rem;
}

.page-with-table__head :deep(.page-header) {
  flex-wrap: nowrap;
  align-items: center;
}

.page-with-table__head :deep(.page-header__actions) {
  width: auto;
  flex-shrink: 0;
  flex-wrap: nowrap;
}
</style>
