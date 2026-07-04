<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import {
  Clock,
  FlaskConical,
  Stethoscope,
  Scissors,
  BedDouble,
} from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import UiStatCard from '@/components/ui/UiStatCard.vue'

export type ComptabiliteRevenueDay = {
  date: string
  dayLabel: string
  consultationsFcfa: number
  labExamsFcfa: number
  surgeryFcfa?: number
  hospitalizationFcfa?: number
  totalFcfa: number
}

export type ComptabiliteStats = {
  labPendingCount: number
  labPendingGrossFcfa: number
  labPaidTodayCount: number
  labPaidTodayNetFcfa: number
  consultationsTodayCount: number
  consultationsTodayNetFcfa: number
  surgeryPaidTodayCount?: number
  surgeryPaidTodayNetFcfa?: number
  hospitalizationPaidTodayCount?: number
  hospitalizationPaidTodayNetFcfa?: number
  surgeriesPending: number
  hospitalizationsPending: number
  collectedTodayTotalFcfa?: number
  revenueLast7Days?: ComptabiliteRevenueDay[]
}

const props = defineProps<{
  refreshKey?: number | string
}>()

const stats = ref<ComptabiliteStats>({
  labPendingCount: 0,
  labPendingGrossFcfa: 0,
  labPaidTodayCount: 0,
  labPaidTodayNetFcfa: 0,
  consultationsTodayCount: 0,
  consultationsTodayNetFcfa: 0,
  surgeriesPending: 0,
  hospitalizationsPending: 0,
})

const loading = ref(false)
const loadError = ref('')

async function loadStats() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await api.get<ComptabiliteStats>('/comptabilite/stats')
    stats.value = data
  } catch {
    loadError.value = 'Impossible de charger les statistiques comptables.'
  } finally {
    loading.value = false
  }
}

onMounted(loadStats)
watch(() => props.refreshKey, loadStats)

defineExpose({ reload: loadStats })
</script>

<template>
  <div class="stats-grid compta-stats" :class="{ 'compta-stats--loading': loading }">
    <p v-if="loadError" class="compta-stats__error">{{ loadError }}</p>
    <UiStatCard
      mini
      label="Examens attente"
      :value="stats.labPendingCount"
      :icon="Clock"
      variant="amber"
    />
    <UiStatCard
      mini
      label="Labos jour"
      :value="formatFcfa(stats.labPaidTodayNetFcfa)"
      :icon="FlaskConical"
      variant="teal"
    />
    <UiStatCard
      mini
      label="Consult. jour"
      :value="formatFcfa(stats.consultationsTodayNetFcfa)"
      :icon="Stethoscope"
      variant="blue"
    />
    <UiStatCard
      mini
      label="Chir. attente"
      :value="stats.surgeriesPending"
      :icon="Scissors"
      variant="rose"
    />
    <UiStatCard
      mini
      label="Hospitalisations"
      :value="stats.hospitalizationsPending"
      :icon="BedDouble"
      variant="violet"
    />
  </div>
</template>

<style scoped>
.compta-stats--loading {
  opacity: 0.7;
}

.compta-stats__error {
  grid-column: 1 / -1;
  margin: 0 0 0.25rem;
  font-size: 0.75rem;
  color: #b45309;
}
</style>
