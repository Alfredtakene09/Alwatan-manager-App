<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  Stethoscope,
  FlaskConical,
  ClipboardList,
  CheckCircle2,
  CircleDollarSign,
  FolderOpen,
} from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiStatCard from '@/components/ui/UiStatCard.vue'

const { uiText } = useAppI18n()

type MedecinStats = {
  consultationToday: number
  dejaConsulteToday: number
  labsWaitingToday: number
  labsResultsToday: number
  hasQuota: boolean
  consultationsTotalToday: number | null
  consultationsGrossFcfa: number | null
  consultationsDoctorShareFcfa: number | null
  consultationTotalFcfa: number | null
  consultationQuotaMode: 'PERCENT' | 'FIXED_AMOUNT' | null
  consultationQuotaPercent: number | null
  consultationQuotaFcfa: number | null
  dossierPatientsCount: number
}

const router = useRouter()

const props = defineProps<{
  refreshKey?: number | string
}>()

const stats = ref<MedecinStats>({
  consultationToday: 0,
  dejaConsulteToday: 0,
  labsWaitingToday: 0,
  labsResultsToday: 0,
  hasQuota: false,
  consultationsTotalToday: null,
  consultationsGrossFcfa: null,
  consultationsDoctorShareFcfa: null,
  consultationTotalFcfa: null,
  consultationQuotaMode: null,
  consultationQuotaPercent: null,
  consultationQuotaFcfa: null,
  dossierPatientsCount: 0,
})

const loading = ref(false)
const loadError = ref('')

const consultationShareValue = computed(() => {
  const share = stats.value.consultationsDoctorShareFcfa
  if (share == null) return '—'
  return formatFcfa(share)
})

async function loadStats() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await api.get<MedecinStats>('/consultations/medecin-stats')
    stats.value = data
  } catch {
    loadError.value = uiText(
      'Impossible de charger les statistiques. Réessayez ou redémarrez le serveur API.',
    )
  } finally {
    loading.value = false
  }
}

onMounted(loadStats)
watch(() => props.refreshKey, loadStats)

function openDossierPatient() {
  router.push({ name: 'dossier-patient' })
}
</script>

<template>
  <div class="stats-grid medecin-stats" :class="{ 'medecin-stats--loading': loading }">
    <p v-if="loadError" class="medecin-stats__error">{{ loadError }}</p>
    <UiStatCard
      mini
      label="Consultation"
      :value="stats.consultationToday"
      :icon="Stethoscope"
      variant="teal"
    />
    <UiStatCard
      mini
      label="Déjà consulté"
      :value="stats.dejaConsulteToday"
      :icon="CheckCircle2"
      variant="blue"
    />
    <UiStatCard
      mini
      label="Labos attente"
      :value="stats.labsWaitingToday"
      :icon="FlaskConical"
      variant="amber"
    />
    <UiStatCard
      mini
      label="Résultats labos"
      :value="stats.labsResultsToday"
      :icon="ClipboardList"
      variant="violet"
    />
    <button type="button" class="medecin-stats__link" @click="openDossierPatient">
      <UiStatCard
        mini
        label="Dossier patient"
        :value="stats.dossierPatientsCount"
        :icon="FolderOpen"
        variant="rose"
      />
    </button>
    <UiStatCard
      v-if="stats.hasQuota"
      mini
      label="Consultations"
      :value="consultationShareValue"
      :icon="CircleDollarSign"
      variant="amber"
    />
  </div>
</template>

<style scoped>
.medecin-stats {
  margin-bottom: 0;
}

.medecin-stats--loading {
  opacity: 0.65;
  pointer-events: none;
}

.medecin-stats__error {
  grid-column: 1 / -1;
  margin: 0 0 0.25rem;
  padding: 0.55rem 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 0.75rem;
}

.medecin-stats__link {
  display: block;
  padding: 0;
  border: none;
  background: none;
  text-align: inherit;
  cursor: pointer;
  border-radius: var(--radius);
}

.medecin-stats__link:focus-visible {
  outline: 2px solid var(--accent-500);
  outline-offset: 2px;
}

.medecin-stats__link:hover :deep(.stat-card) {
  border-color: var(--accent-300);
  box-shadow: 0 2px 10px rgba(15, 118, 110, 0.1);
}
</style>
