<script setup lang="ts">
import {
  EXAM_CATALOG_KIND_CONFIG,
  EXAM_CATALOG_KIND_SLUGS,
  examCatalogKindRoute,
  type ExamCatalogKindSlug,
} from '@/lib/exam-catalog-kinds'

defineProps<{
  activeKind: ExamCatalogKindSlug
}>()
</script>

<template>
  <nav class="exam-kind-tabs" aria-label="Types d'examen">
    <RouterLink
      v-for="slug in EXAM_CATALOG_KIND_SLUGS"
      :key="slug"
      :to="examCatalogKindRoute(slug)"
      class="exam-kind-tab"
      :class="{ 'exam-kind-tab--active': activeKind === slug }"
    >
      <component :is="EXAM_CATALOG_KIND_CONFIG[slug].icon" :size="16" />
      {{ EXAM_CATALOG_KIND_CONFIG[slug].label }}
    </RouterLink>
  </nav>
</template>

<style scoped>
.exam-kind-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 1rem;
  padding: 0.25rem;
  border-radius: 12px;
  background: var(--surface-muted, #eef2e6);
  border: 1px solid var(--border);
}

.exam-kind-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 0.9rem;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-weight: 700;
  text-decoration: none;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.exam-kind-tab:hover {
  color: var(--primary-800);
}

.exam-kind-tab--active {
  background: #fff;
  color: var(--primary-800);
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}
</style>
