<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Wallet, Stethoscope, Layers } from '@lucide/vue'
import ConsultationsComptabilitePanel from '@/components/comptabilite/ConsultationsComptabilitePanel.vue'
import EncaissementsComptabilitePanel from '@/components/comptabilite/EncaissementsComptabilitePanel.vue'

type TabId = 'encaissements' | 'consultations'

const route = useRoute()

function tabFromQuery(): TabId {
  return route.query.tab === 'consultations' ? 'consultations' : 'encaissements'
}

const activeTab = ref<TabId>(tabFromQuery())

watch(
  () => route.query.tab,
  () => {
    activeTab.value = tabFromQuery()
  },
)

const tabs: { id: TabId; label: string; icon: typeof Wallet }[] = [
  { id: 'encaissements', label: 'Tous les encaissements', icon: Layers },
  { id: 'consultations', label: 'Consultations seules', icon: Stethoscope },
]
</script>

<template>
  <div class="compta-tabs-page">
    <div class="compta-tabs" role="tablist" aria-label="Vue comptabilité">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        class="compta-tabs__btn"
        :class="{ 'compta-tabs__btn--active': activeTab === tab.id }"
        :aria-selected="activeTab === tab.id"
        @click="activeTab = tab.id"
      >
        <component :is="tab.icon" :size="16" />
        {{ tab.label }}
      </button>
    </div>

    <EncaissementsComptabilitePanel
      v-if="activeTab === 'encaissements'"
      title="Comptabilité — Encaissements"
      subtitle="Uniquement vos encaissements — consultations, examens, chirurgie et hospitalisation"
      table-key="reception-encaissements"
    />
    <ConsultationsComptabilitePanel
      v-else
      title="Comptabilité — Consultations"
      subtitle="Détail des montants de consultation enregistrés à la réception"
      :icon="Wallet"
      table-key="reception-comptabilite"
    />
  </div>
</template>

<style scoped>
.compta-tabs-page {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.compta-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.25rem;
  background: #f1f5f9;
  border: 1px solid var(--border);
  border-radius: 10px;
  width: fit-content;
}

.compta-tabs__btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.85rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.compta-tabs__btn--active {
  background: #fff;
  color: var(--primary-800);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
}
</style>
