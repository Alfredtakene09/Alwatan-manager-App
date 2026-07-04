<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '@/api/client'
import UiAlert from '@/components/ui/UiAlert.vue'
import PharmacyCashierPanel, {
  type CashierPatient,
  type CashierProduct,
} from '@/components/pharmacie/PharmacyCashierPanel.vue'

const products = ref<CashierProduct[]>([])
const patients = ref<CashierPatient[]>([])
const loading = ref(false)
const loadError = ref('')

async function loadDispensationData() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await api.get<{ products: CashierProduct[]; patients: CashierPatient[] }>('/pharmacie')
    products.value = data.products
    patients.value = data.patients
  } catch {
    loadError.value = 'Impossible de charger le catalogue pharmacie.'
    products.value = []
    patients.value = []
  } finally {
    loading.value = false
  }
}

async function onStockChanged() {
  await loadDispensationData()
}

onMounted(loadDispensationData)
</script>

<template>
  <div class="pharmacy-caisse-page">
    <UiAlert v-if="loadError" type="error" :message="loadError" class="pharmacy-caisse-page__alert" />
    <PharmacyCashierPanel
      :products="products"
      :patients="patients"
      :loading="loading"
      @changed="onStockChanged"
      @refresh="loadDispensationData"
    />
  </div>
</template>

<style scoped>
.pharmacy-caisse-page {
  display: flex;
  flex-direction: column;
  height: calc(100dvh - 9rem);
  min-height: 0;
  gap: 0.75rem;
  overflow: hidden;
}

.pharmacy-caisse-page__alert {
  flex-shrink: 0;
  margin: 0;
}

.pharmacy-caisse-page :deep(.cashier) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
