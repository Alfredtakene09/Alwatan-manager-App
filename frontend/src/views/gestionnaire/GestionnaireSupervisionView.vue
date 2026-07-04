<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Eye, CalendarDays, FlaskConical, BedDouble, Users } from '@lucide/vue'
import api from '@/api/client'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import '@/assets/gestionnaire-page.css'

type ClinicalOverview = {
  patientsToday: number
  appointmentsToday: number
  examsPending: number
  activeHospitalizations: number
}

const clinical = ref<ClinicalOverview | null>(null)
const loading = ref(false)

const stats = computed(() => {
  const c = clinical.value
  if (!c) return []
  return [
    { label: 'Patients aujourd\'hui', value: c.patientsToday, icon: Users, variant: 'amber' as const },
    { label: 'Rendez-vous du jour', value: c.appointmentsToday, icon: CalendarDays, variant: 'blue' as const },
    { label: 'Examens en attente', value: c.examsPending, icon: FlaskConical, variant: 'teal' as const },
    { label: 'Hospitalisations actives', value: c.activeHospitalizations, icon: BedDouble, variant: 'violet' as const },
  ]
})

async function loadSupervision() {
  loading.value = true
  try {
    const { data } = await api.get<ClinicalOverview>('/gestionnaire/supervision')
    clinical.value = data
  } finally {
    loading.value = false
  }
}

onMounted(loadSupervision)
</script>

<template>
  <div class="gestionnaire-page">
    <UiPageHeader
      title="Supervision clinique"
      subtitle="Vue d'ensemble opérationnelle — lecture seule"
      :icon="Eye"
    />

    <div v-if="loading" class="chart-empty">Chargement…</div>
    <div v-else class="stats-grid supervision-grid">
      <UiStatCard
        v-for="stat in stats"
        :key="stat.label"
        :label="stat.label"
        :value="stat.value"
        :icon="stat.icon"
        :variant="stat.variant"
        mini
      />
    </div>
  </div>
</template>
