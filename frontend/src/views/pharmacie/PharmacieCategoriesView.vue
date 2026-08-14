<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Tags, Pill } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import PharmacyCategoriesPanel from '@/components/pharmacie/PharmacyCategoriesPanel.vue'
import PharmacyFormsPanel from '@/components/pharmacie/PharmacyFormsPanel.vue'
import { useAppI18n } from '@/i18n/useAppI18n'

type TabId = 'categories' | 'formes'

const route = useRoute()
const router = useRouter()
const { uiText } = useAppI18n()

const activeTab = ref<TabId>(route.query.tab === 'formes' ? 'formes' : 'categories')

const pageSubtitle = computed(() =>
  activeTab.value === 'formes'
    ? uiText('Formes galéniques du catalogue')
    : uiText('Organisation du catalogue produits'),
)

function selectTab(tab: TabId) {
  activeTab.value = tab
}

watch(activeTab, (tab) => {
  router.replace({ query: tab === 'formes' ? { tab: 'formes' } : {} })
})

watch(
  () => route.query.tab,
  (tab) => {
    activeTab.value = tab === 'formes' ? 'formes' : 'categories'
  },
)
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        :title="uiText('Catégories')"
        :subtitle="pageSubtitle"
        :icon="Tags"
      />
      <div class="page-tabs" role="tablist" :aria-label="uiText('Sections catalogue')">
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
        <button
          type="button"
          class="page-tab"
          role="tab"
          :aria-selected="activeTab === 'formes'"
          :class="{ 'page-tab--active': activeTab === 'formes' }"
          @click="selectTab('formes')"
        >
          <Pill :size="14" />
          {{ uiText('Formes') }}
        </button>
      </div>
    </section>
    <PharmacyCategoriesPanel v-if="activeTab === 'categories'" />
    <PharmacyFormsPanel v-else />
  </div>
</template>
