<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { CheckCircle2, ClipboardList } from '@lucide/vue'

const route = useRoute()

const basePath = computed(() =>
  route.path.startsWith('/comptabilite/') ? '/comptabilite/examens-payes' : '/reception/examens-payes',
)

const tabs = computed(() => [
  { to: basePath.value, label: 'Examens payés', icon: CheckCircle2, exact: true },
  {
    to: `${basePath.value}/reclamations`,
    label: 'Historique des réclamations',
    icon: ClipboardList,
    exact: false,
  },
])

function isActive(tab: { to: string; exact: boolean }) {
  if (tab.exact) return route.path === tab.to
  return route.path.startsWith(tab.to)
}
</script>

<template>
  <nav class="examens-payes-subnav" aria-label="Examens payés">
    <RouterLink
      v-for="tab in tabs"
      :key="tab.to"
      :to="tab.to"
      class="examens-payes-subnav__tab"
      :class="{ 'examens-payes-subnav__tab--active': isActive(tab) }"
    >
      <component :is="tab.icon" :size="16" />
      {{ tab.label }}
    </RouterLink>
  </nav>
</template>

<style scoped>
.examens-payes-subnav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 1rem;
}

.examens-payes-subnav__tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.85rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-weight: 600;
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.examens-payes-subnav__tab:hover {
  border-color: var(--primary-200);
  color: var(--primary-800);
  background: var(--primary-50);
}

.examens-payes-subnav__tab--active {
  border-color: var(--primary-500, #6b7c3e);
  background: var(--primary-50, #f4f6ef);
  color: var(--primary-800);
}
</style>
