<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { LayoutDashboard, BedDouble, Scissors, Users, Clock } from '@lucide/vue'
import api from '@/api/client'
import UiCard from '@/components/ui/UiCard.vue'
import RoleDashboardShell from '@/components/dashboard/RoleDashboardShell.vue'
import DashboardSplitChart from '@/components/dashboard/DashboardSplitChart.vue'
import DashboardPendingBars from '@/components/dashboard/DashboardPendingBars.vue'
import type { SummaryStat } from '@/lib/dashboard-summary'

type SoignantDashboardStats = {
  roomsTotal: number
  roomsOccupied: number
  roomsFree: number
  bedsTotal?: number
  bedsOccupied?: number
  bedsFree?: number
  activeHospitalizations: number
  authorizedSurgeries: number
  pendingSurgeries: number
  occupancyByRoomType: Array<{ label: string; total: number; occupied: number }>
}

const stats = ref<SoignantDashboardStats | null>(null)
const loading = ref(false)
const loadError = ref('')

const summaryStats = computed((): SummaryStat[] => {
  if (!stats.value) return []
  const s = stats.value
  const total = s.roomsTotal ?? s.bedsTotal ?? 0
  const occupied = s.roomsOccupied ?? s.bedsOccupied ?? 0
  const free = s.roomsFree ?? s.bedsFree ?? 0
  const occupancyRate = total > 0 ? Math.round((occupied / total) * 100) : 0
  return [
    {
      id: 'rooms-occupied',
      label: 'Salles occupées',
      value: occupied,
      icon: BedDouble,
      variant: 'rose',
      trend: `${occupancyRate}% · ${free} libre(s)`,
    },
    {
      id: 'hospitalizations',
      label: 'Hospitalisations',
      value: s.activeHospitalizations,
      icon: Users,
      variant: 'violet',
      trend: 'Patients hospitalisés',
    },
    {
      id: 'surgeries',
      label: 'Chirurgies autorisées',
      value: s.authorizedSurgeries,
      icon: Scissors,
      variant: 'teal',
      trend: 'Bloc opératoire',
    },
    {
      id: 'pending-surgeries',
      label: 'En attente bloc',
      value: s.pendingSurgeries,
      icon: Clock,
      variant: 'amber',
      trend: 'À traiter comptabilité',
    },
  ]
})

const roomSplit = computed(() => {
  if (!stats.value) return []
  const occupied = stats.value.roomsOccupied ?? stats.value.bedsOccupied ?? 0
  const free = stats.value.roomsFree ?? stats.value.bedsFree ?? 0
  return [
    { label: 'Salles occupées', value: occupied, colorClass: 'split-chart__segment--a' },
    { label: 'Salles libres', value: free, colorClass: 'split-chart__segment--b' },
  ]
})

const roomTypeBars = computed(() => {
  if (!stats.value) return []
  return stats.value.occupancyByRoomType.map((room) => ({
    label: `Salles ${room.label}`,
    count: room.occupied,
    color: room.label === 'VIP' ? '#7c3aed' : '#2563eb',
  }))
})

const pendingBars = computed(() => {
  if (!stats.value) return []
  const s = stats.value
  return [
    { label: 'Hospitalisations actives', count: s.activeHospitalizations, color: '#7c3aed' },
    { label: 'Chirurgies autorisées', count: s.authorizedSurgeries, color: '#0d9488' },
    { label: 'Chirurgies en attente', count: s.pendingSurgeries, color: '#e11d48' },
  ]
})

async function loadStats() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await api.get<SoignantDashboardStats>('/dashboard/soignant')
    stats.value = data
  } catch {
    loadError.value = 'Impossible de charger le tableau de bord soins.'
    stats.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadStats)
</script>

<template>
  <RoleDashboardShell
    subtitle="Résumé bloc & salles — occupation des salles et interventions"
    :icon="LayoutDashboard"
    :stats="summaryStats"
    :loading="loading"
    :load-error="loadError"
    @refresh="loadStats"
  >
    <div class="charts-grid">
      <UiCard title="Occupation des salles" description="Répartition occupées / libres" :icon="BedDouble" icon-variant="blue">
        <DashboardSplitChart
          :rows="roomSplit"
          :format-value="(v) => String(v)"
          empty-label="Aucune salle configurée"
        />
      </UiCard>

      <UiCard title="Par type de salle" description="Salles occupées VIP et simples" :icon="BedDouble" icon-variant="violet">
        <div v-if="!roomTypeBars.length" class="chart-empty">Aucune chambre configurée</div>
        <DashboardPendingBars v-else :items="roomTypeBars" />
      </UiCard>
    </div>

    <UiCard title="Activité clinique" description="Hospitalisations et bloc opératoire" :icon="Scissors" icon-variant="rose">
      <DashboardPendingBars :items="pendingBars" />
    </UiCard>
  </RoleDashboardShell>
</template>

<style scoped>
@import '@/styles/dashboard-charts.css';
</style>
