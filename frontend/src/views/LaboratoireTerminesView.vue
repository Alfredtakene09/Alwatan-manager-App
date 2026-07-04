<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CheckCircle2, RefreshCw, Search } from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { fetchAndPrintLabVisitResults } from '@/lib/lab-visit-print'
import { matchesLabVisitSearch } from '@/lib/lab-visit-search'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import LabsWaitingDataTable, {
  type LabsWaitingVisitRow,
} from '@/components/ui/LabsWaitingDataTable.vue'

const router = useRouter()
const auth = useAuthStore()

const visits = ref<LabsWaitingVisitRow[]>([])
const listSearch = ref('')
const loading = ref(false)
const loadError = ref('')
const printError = ref('')
const printingVisitId = ref<string | null>(null)

const filteredVisits = computed(() =>
  visits.value.filter((visit) => matchesLabVisitSearch(visit, listSearch.value)),
)

const hasActiveSearch = computed(() => listSearch.value.trim().length > 0)

async function loadCompleted() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await api.get<LabsWaitingVisitRow[]>('/laboratoire/completed')
    visits.value = data
  } catch {
    loadError.value = 'Impossible de charger les examens terminés.'
    visits.value = []
  } finally {
    loading.value = false
  }
}

function goToResults(visitId: string) {
  router.push({ name: 'laboratoire-dossier', params: { visitId }, query: { from: 'termines' } })
}

function goToEditResults(visitId: string) {
  router.push({
    name: 'laboratoire-dossier',
    params: { visitId },
    query: { from: 'termines', edit: '1' },
  })
}

function goToAddForm(visitId: string) {
  router.push({
    name: 'laboratoire-dossier',
    params: { visitId },
    query: { from: 'termines', add: '1' },
  })
}

async function printResults(visitId: string) {
  const visit = visits.value.find((v) => v.id === visitId)
  if (!visit) return

  printError.value = ''
  printingVisitId.value = visitId

  const result = await fetchAndPrintLabVisitResults(visit, auth.user, 'laboratoire')

  if (!result.ok) {
    printError.value = result.error
  }

  printingVisitId.value = null
}

function resetSearch() {
  listSearch.value = ''
}

onMounted(loadCompleted)
</script>

<template>
  <div class="page-with-table lab-page">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Examens terminés"
        subtitle="Patients dont les analyses de laboratoire ont été clôturées"
        :icon="CheckCircle2"
      >
        <template #actions>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadCompleted">
            Actualiser
          </UiButton>
        </template>
      </UiPageHeader>

      <UiAlert v-if="loadError" type="error" :message="loadError" />
      <UiAlert v-if="printError" type="error" :message="printError" />
    </section>

    <section class="page-with-table__body">
      <UiCard
        title="Dossiers clôturés"
        description="Matricule · Patient · Date · Examens — Imprimer · Consulter · Modifier · Ajouter"
        class="ui-card--table-panel lab-table-card"
        :icon="CheckCircle2"
        icon-variant="teal"
      >
        <template #actions>
          <div class="lab-toolbar">
            <label class="lab-toolbar__search">
              <Search :size="16" aria-hidden="true" />
              <input
                v-model="listSearch"
                type="search"
                placeholder="Patient, matricule, médecin…"
                aria-label="Rechercher un dossier terminé"
              />
            </label>
            <UiButton v-if="hasActiveSearch" variant="ghost" size="sm" @click="resetSearch">
              Effacer
            </UiButton>
            <span class="lab-toolbar__count">{{ filteredVisits.length }} dossier(s)</span>
          </div>
        </template>

        <p v-if="!loading && !visits.length" class="empty">
          Aucun examen de laboratoire terminé pour le moment.
        </p>
        <p v-else-if="!loading && visits.length && !filteredVisits.length" class="empty">
          Aucun dossier ne correspond à votre recherche.
        </p>
        <div v-else-if="visits.length || loading" class="lab-completed-table">
          <LabsWaitingDataTable
            fill
            actions-mode="lab-completed"
            exams-summary-mode="lab"
            date-mode="completed"
            :visits="filteredVisits"
            :loading="loading || !!printingVisitId"
            table-key="lab-completed"
            @modify="goToEditResults"
            @saisir="goToResults"
            @print="printResults"
            @add="goToAddForm"
          />
        </div>
      </UiCard>
    </section>
  </div>
</template>

<style scoped>
.empty {
  margin: 0;
  text-align: center;
  color: var(--text-muted);
  padding: 2rem 1rem;
  font-size: 0.9375rem;
}

.lab-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}

.lab-toolbar__search {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-width: min(100%, 16rem);
  padding: 0.45rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text-muted);
}

.lab-toolbar__search input {
  width: 100%;
  border: 0;
  outline: none;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--text);
  background: transparent;
}

.lab-toolbar__count {
  font-size: 0.75rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.lab-completed-table {
  min-height: 0;
}
</style>
