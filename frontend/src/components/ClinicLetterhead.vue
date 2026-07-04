<script setup lang="ts">
import { CLINIC } from '@/lib/clinic'

defineProps<{
  docTitle?: string
}>()
</script>

<template>
  <header class="clinic-letterhead">
    <img :src="CLINIC.logo" :alt="CLINIC.nameFr" class="clinic-letterhead__logo" />
    <div class="clinic-letterhead__info">
      <h2>{{ CLINIC.nameFr }}</h2>
      <p class="clinic-letterhead__ar" dir="rtl" lang="ar">{{ CLINIC.nameAr }}</p>
      <p>{{ CLINIC.fullAddress }}</p>
      <p>{{ CLINIC.phoneLabel }}</p>
      <p>Email : {{ CLINIC.email }}</p>
      <p v-if="docTitle" class="clinic-letterhead__doc">{{ docTitle }}</p>
    </div>
  </header>
</template>

<style scoped>
.clinic-letterhead {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  padding-bottom: 1rem;
  margin-bottom: 1rem;
  border-bottom: 1px dashed var(--border);
}

.clinic-letterhead__logo {
  width: 4.5rem;
  height: 4.5rem;
  object-fit: contain;
  flex-shrink: 0;
  background: #fff;
  border-radius: 8px;
}

.clinic-letterhead__info h2 {
  margin: 0 0 0.25rem;
  font-size: 1rem;
  line-height: 1.3;
}

.clinic-letterhead__ar {
  margin: 0 0 0.45rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
  font-family: 'Noto Naskh Arabic', 'Amiri', 'Tahoma', 'Arial', sans-serif;
}

.clinic-letterhead__info p {
  margin: 0 0 0.15rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  line-height: 1.45;
}

.clinic-letterhead__doc {
  margin-top: 0.55rem !important;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--primary-800) !important;
}
</style>
