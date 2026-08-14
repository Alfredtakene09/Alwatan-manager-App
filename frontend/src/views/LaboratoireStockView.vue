<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Package, Tags } from '@lucide/vue'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import LabStockItemsPanel from '@/components/laboratoire/LabStockItemsPanel.vue'
import LabStockCategoriesPanel from '@/components/laboratoire/LabStockCategoriesPanel.vue'

type TabId = 'articles' | 'categories'

const route = useRoute()
const router = useRouter()
const { uiText } = useAppI18n()

function tabFromQuery(): TabId {
  return route.query.tab === 'categories' ? 'categories' : 'articles'
}

const activeTab = ref<TabId>(tabFromQuery())

const pageSubtitle = computed(() =>
  activeTab.value === 'categories'
    ? 'Organisation du catalogue laboratoire'
    : 'Réactifs et consommables du laboratoire',
)

function selectTab(tab: TabId) {
  activeTab.value = tab
}

watch(activeTab, (tab) => {
  const query = tab === 'articles' ? {} : { tab }
  router.replace({ query })
})

watch(
  () => route.query.tab,
  () => {
    activeTab.value = tabFromQuery()
  },
)
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Stock laboratoire"
        :subtitle="pageSubtitle"
        :icon="Package"
      />
      <div class="page-tabs" role="tablist" :aria-label="uiText('Sections stock laboratoire')">
        <button
          type="button"
          class="page-tab"
          role="tab"
          :aria-selected="activeTab === 'articles'"
          :class="{ 'page-tab--active': activeTab === 'articles' }"
          @click="selectTab('articles')"
        >
          <Package :size="14" />
          {{ uiText('Articles') }}
        </button>
        <button
          type="button"
          class="page-tab"
          role="tab"
          :aria-selected="activeTab === 'categories'"
          :class="{ 'page-tab--active': activeTab === 'categories' }"
          @click="selectTab('categories')"
        >
          <Tags :size="14" />
          {{ uiText('Catégories') }}
        </button>
      </div>
    </section>
    <LabStockItemsPanel v-if="activeTab === 'articles'" />
    <LabStockCategoriesPanel v-else />
  </div>
</template>
