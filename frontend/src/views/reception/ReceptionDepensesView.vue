<script setup lang="ts">
import { ref } from 'vue'
import { Receipt, ListOrdered } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import CaisseToolbar from '@/components/caisse/CaisseToolbar.vue'
import CaisseCompactDateField from '@/components/caisse/CaisseCompactDateField.vue'
import CaisseDepensesPanel from '@/components/caisse/CaisseDepensesPanel.vue'
import ExpenseIndicesPanel from '@/components/caisse/ExpenseIndicesPanel.vue'

type TabId = 'depenses' | 'indices'

const activeTab = ref<TabId>('depenses')
const indicesVersion = ref(0)
const businessDate = ref(new Date().toISOString().slice(0, 10))

function onIndicesChanged() {
  indicesVersion.value += 1
}
</script>

<template>
  <div class="depenses-page">
    <UiPageHeader
      title="Dépenses"
      subtitle="Dépenses de la clinique payées en caisse (réception ou comptabilité)"
      :icon="Receipt"
    />

    <CaisseToolbar role="tablist" aria-label="Sections dépenses">
      <button
        type="button"
        class="depenses-toolbar__tab"
        :class="{ 'depenses-toolbar__tab--active': activeTab === 'depenses' }"
        :aria-selected="activeTab === 'depenses'"
        @click="activeTab = 'depenses'"
      >
        <Receipt :size="16" />
        Dépenses du jour
      </button>

      <CaisseCompactDateField
        v-model="businessDate"
        :disabled="activeTab !== 'depenses'"
        :inactive="activeTab !== 'depenses'"
      />

      <button
        type="button"
        class="depenses-toolbar__tab"
        :class="{ 'depenses-toolbar__tab--active': activeTab === 'indices' }"
        :aria-selected="activeTab === 'indices'"
        @click="activeTab = 'indices'"
      >
        <ListOrdered :size="16" />
        Indices
      </button>
    </CaisseToolbar>

    <CaisseDepensesPanel
      v-if="activeTab === 'depenses'"
      :show-header="false"
      :show-date-filter="false"
      v-model:business-date="businessDate"
      :indices-version="indicesVersion"
    />
    <ExpenseIndicesPanel v-else @changed="onIndicesChanged" />
  </div>
</template>

<style scoped>
.depenses-page {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.depenses-toolbar__tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 2.25rem;
  padding: 0.45rem 0.9rem;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.depenses-toolbar__tab--active {
  background: #fff;
  color: var(--primary-800);
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}

@media (max-width: 720px) {
  .depenses-toolbar__tab {
    flex: 1 1 auto;
    justify-content: center;
  }
}
</style>
