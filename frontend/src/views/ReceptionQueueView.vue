<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  Activity,
  Search,
  RefreshCw,
  UserRound,
  X,
} from '@lucide/vue'
import api from '@/api/client'
import { fullName } from '@/lib/roles'
import { getVisitStatusMeta, PIPELINE_LEVELS } from '@/lib/visit-status'
import { sortPatientsNewestFirst, sortVisitsByPatientNewestFirst } from '@/lib/patient-sort'
import { matchesPatientSearch } from '@/lib/patient-search'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import VisitEtatDataTable from '@/components/ui/VisitEtatDataTable.vue'

type Patient = {
  id: string
  code: string
  firstName: string
  lastName: string
  phone?: string
  createdAt?: string
}

type PatientVisit = {
  id: string
  status: string
  createdAt: string
  updatedAt: string
  patient: Patient & { createdAt: string }
  assignedDoctor?: { firstName: string; lastName: string } | null
}

const visits = ref<PatientVisit[]>([])
const patients = ref<Patient[]>([])
const search = ref('')
const filterLevel = ref('1')
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const loading = ref(false)
const loadingPatients = ref(false)
const loadingVisitId = ref<string | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | undefined
let messageTimer: ReturnType<typeof setTimeout> | undefined

function showAlert(text: string, type: 'success' | 'error' = 'success') {
  if (messageTimer) clearTimeout(messageTimer)
  message.value = text
  messageType.value = type
  if (type === 'success') {
    messageTimer = setTimeout(() => {
      message.value = ''
      messageTimer = undefined
    }, 3000)
  }
}

function clearAlert() {
  if (messageTimer) clearTimeout(messageTimer)
  messageTimer = undefined
  message.value = ''
}

const levelCounts = computed(() => {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const visit of visits.value) {
    const level = getVisitStatusMeta(visit.status).level
    if (level > 0) counts[level] = (counts[level] ?? 0) + 1
  }
  return counts
})

const filteredVisits = computed(() => {
  if (!filterLevel.value) return []
  const level = Number(filterLevel.value)
  const q = search.value.trim()
  let list = visits.value.filter((v) => getVisitStatusMeta(v.status).level === level)
  if (q) {
    list = list.filter((v) => matchesPatientSearch(v.patient, q))
  }
  return sortVisitsByPatientNewestFirst(list)
})

const selectedLevel = computed(() =>
  PIPELINE_LEVELS.find((step) => String(step.level) === filterLevel.value),
)

const tablePanelTitle = computed(() => {
  if (!selectedLevel.value) return 'Parcours patient'
  return selectedLevel.value.label
})

const tablePanelSubtitle = computed(() => {
  if (!filterLevel.value) return 'Sélectionnez un niveau pour afficher les patients'
  if (loading.value) return 'Chargement…'
  const q = search.value.trim()
  if (q) {
    return `${filteredVisits.value.length} résultat(s) pour « ${q} »`
  }
  return `${filteredVisits.value.length} patient(s) à ce niveau`
})

function clearSearch() {
  search.value = ''
  patients.value = []
}

async function loadEtat() {
  loading.value = true
  try {
    const { data } = await api.get('/visits/etat-patients')
    visits.value = data
  } finally {
    loading.value = false
  }
}

async function loadPatients() {
  if (!search.value.trim()) {
    patients.value = []
    return
  }
  loadingPatients.value = true
  try {
    const { data } = await api.get('/patients', { params: { q: search.value.trim() } })
    patients.value = sortPatientsNewestFirst(data)
  } catch {
    patients.value = []
    showAlert('Impossible de rechercher les patients.', 'error')
  } finally {
    loadingPatients.value = false
  }
}

async function newVisit(patientId: string) {
  loadingVisitId.value = patientId
  clearAlert()
  try {
    await api.post('/visits', { patientId })
    const patient = patients.value.find((p) => p.id === patientId)
    showAlert(
      patient
        ? `${fullName(patient.firstName, patient.lastName)} — niveau Réception (attente consultation).`
        : 'Patient enregistré au niveau Réception.',
    )
    clearSearch()
    await loadEtat()
  } catch (e: unknown) {
    const err = e as { response?: { status?: number; data?: { error?: string } } }
    showAlert(
      err.response?.status === 409
        ? (err.response.data?.error ?? 'Ce patient a déjà une visite en cours.')
        : "Impossible d'enregistrer la visite.",
      'error',
    )
  } finally {
    loadingVisitId.value = null
  }
}

watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(loadPatients, 300)
})

onMounted(loadEtat)
onUnmounted(clearAlert)
</script>

<template>
  <div class="etat-page">
    <section class="etat-sticky">
      <UiPageHeader
        title="État des patients"
        subtitle="Suivi du parcours clinique — savoir à quel niveau se trouve chaque patient"
        :icon="Activity"
      />

      <UiAlert v-if="message" :type="messageType" :message="message" class="page-alert" />

      <div class="pipeline-panel">
        <div class="pipeline">
          <button
            v-for="step in PIPELINE_LEVELS"
            :key="step.level"
            type="button"
            class="pipeline-step"
            :class="{ 'pipeline-step--active': filterLevel === String(step.level) }"
            @click="filterLevel = filterLevel === String(step.level) ? '' : String(step.level)"
          >
            <strong>{{ step.label }}</strong>
            <span class="pipeline-step__count">{{ levelCounts[step.level] ?? 0 }}</span>
          </button>
          <UiButton
            variant="ghost"
            size="sm"
            :icon="RefreshCw"
            class="pipeline-refresh"
            :loading="loading"
            @click="loadEtat"
          >
            Actualiser
          </UiButton>
        </div>
      </div>

      <div class="search-panel-sticky">
        <div class="search-toolbar">
          <div class="search-toolbar__title">
            <h3>Recherche patient</h3>
            <p>Matricule, nom ou téléphone — filtre la liste et permet d'enregistrer au niveau Réception</p>
          </div>

          <div class="search-toolbar__field">
            <div class="search-compact">
              <Search :size="16" class="search-compact__icon" />
              <input
                v-model="search"
                type="search"
                class="search-compact__input"
                placeholder="Matricule PAT, nom ou téléphone…"
              />
              <button
                v-if="search"
                type="button"
                class="search-compact__clear"
                aria-label="Effacer la recherche"
                @click="clearSearch"
              >
                <X :size="14" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="etat-body">
      <div v-if="loadingPatients" class="search-hint">Recherche en cours…</div>
      <div v-else-if="patients.length" class="search-results">
        <div v-for="patient in patients" :key="patient.id" class="search-item">
          <div>
            <strong>{{ fullName(patient.firstName, patient.lastName) }}</strong>
            <UiBadge variant="primary">{{ patient.code }}</UiBadge>
          </div>
          <UiButton
            variant="primary"
            size="sm"
            :loading="loadingVisitId === patient.id"
            @click="newVisit(patient.id)"
          >
            Réception
          </UiButton>
        </div>
      </div>
      <div v-else-if="search.trim()" class="search-hint">Aucun patient trouvé</div>

      <div class="patients-table-card">
        <div class="table-panel-head">
          <div class="table-panel-head__titles">
            <h3>{{ tablePanelTitle }}</h3>
            <p>{{ tablePanelSubtitle }}</p>
          </div>
        </div>

        <div v-if="!filterLevel" class="empty-state">
          <UserRound :size="32" />
          <p>Sélectionnez un niveau ci-dessus pour afficher la liste des patients</p>
        </div>

        <div v-else-if="loading" class="empty-state empty-state--compact">Chargement…</div>

        <div v-else-if="filteredVisits.length" class="table-wrap">
          <VisitEtatDataTable fill :visits="filteredVisits" :loading="loading" />
        </div>

        <div v-else class="empty-state empty-state--compact">
          <UserRound :size="28" />
          <p>{{ search.trim() ? 'Aucun patient correspondant à cette recherche' : 'Aucun patient à ce niveau' }}</p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.etat-page {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  height: calc(100dvh - 9rem);
  min-height: 0;
}

.etat-sticky {
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 30;
  margin: -1.75rem -2rem 0;
  padding: 0.875rem 2rem 1.125rem;
  background: var(--bg-app);
}

.etat-sticky :deep(.page-header) {
  margin-bottom: 0.625rem;
}

.etat-sticky :deep(.page-header__main) {
  gap: 0.625rem;
}

.etat-sticky :deep(.page-header__icon) {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 10px;
  box-shadow: none;
}

.etat-sticky :deep(.page-header__icon svg) {
  width: 18px;
  height: 18px;
}

.etat-sticky :deep(.page-header h1) {
  font-size: 1.125rem;
  line-height: 1.2;
}

.etat-sticky :deep(.page-header p) {
  margin-top: 0.1rem;
  font-size: 0.75rem;
  line-height: 1.3;
}

.page-alert {
  margin-top: 0 !important;
  margin-bottom: 0.5rem;
  padding: 0.5rem 0.75rem !important;
  font-size: 0.8125rem !important;
}

.pipeline-panel {
  margin-bottom: 0.625rem;
}

.pipeline {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr)) auto;
  gap: 0.5rem;
  align-items: stretch;
}

.pipeline-step {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  padding: 0.625rem 0.75rem;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s;
  box-shadow: var(--shadow-sm);
}

.pipeline-step:hover {
  border-color: var(--primary-500);
  background: var(--primary-50);
}

.pipeline-step--active {
  border-color: var(--primary-500);
  background: var(--primary-50);
  box-shadow: 0 0 0 1px var(--primary-500);
}

.pipeline-refresh {
  align-self: center;
  white-space: nowrap;
}

.pipeline-step__level {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--primary-700);
}

.pipeline-step strong {
  font-size: 0.8125rem;
  line-height: 1.2;
}

.pipeline-step__count {
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.search-panel-sticky {
  margin-top: 0.625rem;
  padding-top: 0.625rem;
  padding-bottom: 0.25rem;
  border-top: 1px solid var(--border);
}

.search-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 22rem);
  align-items: center;
  gap: 0.75rem 1rem;
}

.search-toolbar__title h3 {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--text);
  line-height: 1.2;
}

.search-toolbar__title p {
  margin: 0.1rem 0 0;
  font-size: 0.6875rem;
  color: var(--text-muted);
  line-height: 1.3;
}

.search-toolbar__field {
  min-width: 0;
}

.search-compact {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.45rem 0.875rem;
  border: 1.5px solid var(--border);
  border-radius: 999px;
  background: #fff;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.search-compact:focus-within {
  border-color: var(--primary-500);
  box-shadow: 0 0 0 3px var(--focus-ring-sm);
}

.search-compact__icon {
  color: var(--text-light);
  flex-shrink: 0;
}

.search-compact__input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font-size: 0.8125rem;
  color: var(--text);
  outline: none;
}

.search-compact__input::placeholder {
  color: var(--text-light);
}

.search-compact__clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border: 0;
  border-radius: 999px;
  background: #f1f5f9;
  color: var(--text-muted);
  cursor: pointer;
}

.search-compact__clear:hover {
  background: #e2e8f0;
}

.etat-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.search-hint {
  font-size: 0.8125rem;
  color: var(--text-muted);
  padding: 0 0.25rem;
}

.search-results {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex-shrink: 0;
}

.search-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 0.875rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  box-shadow: var(--shadow-sm);
}

.search-item strong {
  display: block;
  margin-bottom: 0.25rem;
}

.patients-table-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-top: 0.25rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.table-panel-head {
  flex-shrink: 0;
  padding: 0.75rem 1rem 0.625rem;
  border-bottom: 1px solid var(--border);
  background: #fff;
}

.table-panel-head__titles h3 {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--text);
  line-height: 1.2;
}

.table-panel-head__titles p {
  margin: 0.15rem 0 0;
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0.5rem 0.75rem 0.75rem;
}

.muted {
  color: var(--text-light);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  flex: 1;
  text-align: center;
  color: var(--text-light);
  padding: 2rem 1rem;
}

.empty-state--compact {
  flex: 1;
  padding: 1.5rem 1rem;
}

.empty-state p {
  margin: 0;
  font-size: 0.875rem;
  max-width: 22rem;
}

@media (max-width: 900px) {
  .pipeline {
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  }

  .pipeline-refresh {
    grid-column: 1 / -1;
    justify-self: end;
  }

  .search-toolbar {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .etat-page {
    height: auto;
  }

  .etat-sticky {
    margin: -1.75rem -1rem 0;
    padding: 0.75rem 1rem 0.875rem;
  }

  .etat-body {
    flex: none;
    min-height: auto;
  }

  .patients-table-card {
    flex: none;
    min-height: auto;
  }

  .table-wrap {
    max-height: 55dvh;
  }
}

@media (max-width: 640px) {
  .search-item {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
