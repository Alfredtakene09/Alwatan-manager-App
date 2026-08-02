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
  position: relative;
  display: block;
  padding: 0 5.5rem 1rem;
  margin-bottom: 1rem;
  min-height: 4.75rem;
  border-bottom: 1px dashed var(--border);
  text-align: center;
}

.clinic-letterhead__logo {
  position: absolute;
  left: 0;
  top: 0;
  width: 4.75rem;
  height: 4.75rem;
  object-fit: contain;
  background: #fff;
  border-radius: 8px;
}

.clinic-letterhead__info {
  text-align: center;
}

.clinic-letterhead__info h2 {
  margin: 0 0 0.25rem;
  font-size: 1.125rem;
  line-height: 1.3;
}

.clinic-letterhead__ar {
  margin: 0 0 0.45rem;
  font-size: 0.9375rem;
  color: var(--text-muted);
  font-family: 'Noto Naskh Arabic', 'Amiri', 'Tahoma', 'Arial', sans-serif;
}

.clinic-letterhead__info p {
  margin: 0 0 0.15rem;
  font-size: 0.8125rem;
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
