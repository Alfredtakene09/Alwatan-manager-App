<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  BookOpen,
  FileDown,
  Printer,
  RefreshCw,
  Search,
  TrendingUp,
} from '@lucide/vue'
import api from '@/api/client'
import AmountFcfa from '@/components/ui/AmountFcfa.vue'
import { currentMonthRangeToToday, formatDateRangeLabel, todayDateKey } from '@/lib/date-filters'
import { CLINIC } from '@/lib/clinic'
import UiButton from '@/components/ui/UiButton.vue'
import ClinicLetterhead from '@/components/ClinicLetterhead.vue'
import '@/assets/gestionnaire-page.css'

type JournalPreset = 'today' | 'week' | 'month' | 'year' | 'custom'
type JournalTypeFilter = 'all' | 'ENTREE' | 'SORTIE'
type JournalCategoryFilter =
  | 'all'
  | 'CONSULTATION'
  | 'EXAMEN'
  | 'SALAIRE'
  | 'DEPENSE'
  | 'DECAISSEMENT'
  | 'OPERATION'
  | 'HOSPITALISATION'
  | 'AUTRE'

type JournalDayLine = {
  type: 'ENTREE' | 'SORTIE'
  label: string
  amountFcfa: number
  variant: 'header' | 'sub' | 'item'
}

type JournalDaySummary = {
  date: string
  label: string
  inflowsFcfa: number
  outflowsFcfa: number
  balanceFcfa: number
  lines: JournalDayLine[]
}

type JournalMonthDailySummary = {
  year: number
  month: number
  monthLabel: string
  inflowsFcfa: number
  outflowsFcfa: number
  balanceFcfa: number
  days: JournalDaySummary[]
}

type JournalResponse = {
  dailyByMonth: JournalMonthDailySummary[]
  totals: { inflowsFcfa: number; outflowsFcfa: number; balanceFcfa: number }
}

const PRESET_LABELS: Record<JournalPreset, string> = {
  today: 'Auj.',
  week: 'Sem.',
  month: 'Mois',
  year: 'Année',
  custom: 'Perso.',
}

const TYPE_OPTIONS: { value: JournalTypeFilter; label: string }[] = [
  { value: 'all', label: 'Tous les flux' },
  { value: 'ENTREE', label: 'Entrées' },
  { value: 'SORTIE', label: 'Sorties' },
]

const CATEGORY_OPTIONS: { value: JournalCategoryFilter; label: string }[] = [
  { value: 'all', label: 'Toutes catégories' },
  { value: 'CONSULTATION', label: 'Consultation' },
  { value: 'EXAMEN', label: 'Examen' },
  { value: 'OPERATION', label: 'Opération' },
  { value: 'HOSPITALISATION', label: 'Hospitalisation' },
  { value: 'DEPENSE', label: 'Dépense' },
  { value: 'SALAIRE', label: 'Salaire' },
  { value: 'DECAISSEMENT', label: 'Décaissement' },
  { value: 'AUTRE', label: 'Autre' },
]

const preset = ref<JournalPreset>('month')
const customFrom = ref('')
const customTo = ref('')
const filterType = ref<JournalTypeFilter>('all')
const filterCategory = ref<JournalCategoryFilter>('all')
const searchInput = ref('')
const searchQuery = ref('')
const loading = ref(false)
const exportingPdf = ref(false)
const journal = ref<JournalResponse | null>(null)
const todayKey = todayDateKey()
let searchDebounce: ReturnType<typeof setTimeout> | undefined

const customRangeValid = computed(() => {
  if (!customFrom.value || !customTo.value) return false
  return customFrom.value <= customTo.value
})

const periodLabel = computed(() => {
  const now = new Date()
  switch (preset.value) {
    case 'today':
      return now.toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    case 'week':
      return '7 derniers jours'
    case 'month':
      return now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    case 'year':
      return `Année ${now.getFullYear()}`
    case 'custom':
      return formatDateRangeLabel(customFrom.value, customTo.value)
    default:
      return ''
  }
})

const hasActiveFilters = computed(
  () =>
    filterType.value !== 'all' ||
    filterCategory.value !== 'all' ||
    Boolean(searchQuery.value.trim()),
)

const filtersLabel = computed(() => {
  const parts: string[] = []
  if (filterType.value !== 'all') {
    parts.push(TYPE_OPTIONS.find((option) => option.value === filterType.value)?.label ?? filterType.value)
  }
  if (filterCategory.value !== 'all') {
    parts.push(
      CATEGORY_OPTIONS.find((option) => option.value === filterCategory.value)?.label ??
        filterCategory.value,
    )
  }
  if (searchQuery.value.trim()) {
    parts.push(`Recherche « ${searchQuery.value.trim()} »`)
  }
  return parts.join(' · ')
})

const printedAt = computed(() =>
  new Date().toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }),
)

function buildQuery(extra?: Record<string, string>) {
  const params = new URLSearchParams({ preset: preset.value })
  if (preset.value === 'custom') {
    if (customFrom.value) params.set('from', customFrom.value)
    if (customTo.value) params.set('to', customTo.value)
  }
  if (filterType.value !== 'all') params.set('type', filterType.value)
  if (filterCategory.value !== 'all') params.set('category', filterCategory.value)
  if (searchQuery.value.trim()) params.set('search', searchQuery.value.trim())
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      params.set(key, value)
    }
  }
  return params.toString()
}

async function loadJournal() {
  if (preset.value === 'custom' && !customRangeValid.value) return
  loading.value = true
  try {
    const { data } = await api.get<JournalResponse>(`/gestionnaire/journal?${buildQuery()}`)
    journal.value = data
  } finally {
    loading.value = false
  }
}

function initCustomRangeMonthToDate() {
  const range = currentMonthRangeToToday()
  customFrom.value = range.from
  customTo.value = range.to
}

function selectPreset(next: JournalPreset) {
  if (next === 'custom' && (!customFrom.value || !customTo.value)) {
    initCustomRangeMonthToDate()
  }
  preset.value = next
}

function resetFilters() {
  if (searchDebounce) clearTimeout(searchDebounce)
  filterType.value = 'all'
  filterCategory.value = 'all'
  searchInput.value = ''
  searchQuery.value = ''
  loadJournal()
}

async function downloadPdf() {
  if (!journal.value?.dailyByMonth.length) return
  exportingPdf.value = true
  try {
    const query = buildQuery({
      download: '1',
      periodLabel: periodLabel.value,
      ...(filtersLabel.value ? { filtersLabel: filtersLabel.value } : {}),
    })
    const { data } = await api.get<Blob>(`/gestionnaire/journal/export.pdf?${query}`, {
      responseType: 'blob',
    })
    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = `livre-journal-${todayKey}.pdf`
    link.click()
    URL.revokeObjectURL(url)
  } finally {
    exportingPdf.value = false
  }
}

function printJournal() {
  if (!journal.value?.dailyByMonth.length) return
  window.print()
}

watch(preset, (next) => {
  if (next !== 'custom') loadJournal()
  else if (customRangeValid.value) loadJournal()
})

watch([customFrom, customTo], () => {
  if (preset.value === 'custom' && customRangeValid.value) loadJournal()
})

watch([filterType, filterCategory], () => {
  loadJournal()
})

watch(searchInput, (value) => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    searchQuery.value = value.trim()
    loadJournal()
  }, 350)
})

onMounted(loadJournal)
</script>

<template>
  <div class="journal-page page-with-table">
    <section class="journal-print-sheet">
      <ClinicLetterhead doc-title="Livre journal — synthèse journalière" />

      <div class="journal-print-meta">
        <div class="journal-print-meta__main">
          <p class="journal-print-meta__period">{{ periodLabel }}</p>
          <p v-if="filtersLabel" class="journal-print-meta__filters">Filtres : {{ filtersLabel }}</p>
        </div>
        <p class="journal-print-meta__date">Édité le {{ printedAt }}</p>
      </div>

      <div v-if="journal" class="journal-print-kpis">
        <article class="journal-print-kpi journal-print-kpi--in">
          <span class="journal-print-kpi__label">Total entrées</span>
          <AmountFcfa :amount="journal.totals.inflowsFcfa" variant="in" size="lg" bold />
        </article>
        <article class="journal-print-kpi journal-print-kpi--out">
          <span class="journal-print-kpi__label">Total sorties</span>
          <AmountFcfa :amount="journal.totals.outflowsFcfa" variant="out" size="lg" bold />
        </article>
        <article
          class="journal-print-kpi"
          :class="journal.totals.balanceFcfa >= 0 ? 'journal-print-kpi--net-pos' : 'journal-print-kpi--net-neg'"
        >
          <span class="journal-print-kpi__label">Solde période</span>
          <AmountFcfa
            :amount="journal.totals.balanceFcfa"
            :variant="journal.totals.balanceFcfa >= 0 ? 'net-pos' : 'net-neg'"
            size="lg"
            bold
          />
        </article>
      </div>

      <footer class="journal-print-footer">
        {{ CLINIC.nameFr }} — {{ CLINIC.fullAddress }}
      </footer>
    </section>

    <section class="page-with-table__head journal-page__head no-print">
      <header class="journal-hero">
        <div class="journal-hero__top">
          <div class="journal-hero__content">
            <div class="journal-hero__icon">
              <BookOpen :size="26" />
            </div>
            <div>
              <p class="journal-hero__eyebrow">Trésorerie clinique</p>
              <h1 class="journal-hero__title">Livre journal</h1>
              <p class="journal-hero__subtitle">Entrées et sorties — synthèse journalière</p>
            </div>
          </div>

          <div class="journal-hero__controls">
            <div class="period-pills" role="tablist" aria-label="Période">
              <button
                v-for="p in (['today', 'week', 'month', 'year', 'custom'] as const)"
                :key="p"
                type="button"
                role="tab"
                class="period-pill"
                :class="{ 'period-pill--active': preset === p }"
                :aria-selected="preset === p"
                @click="selectPreset(p)"
              >
                {{ PRESET_LABELS[p] }}
              </button>
            </div>

            <div v-if="preset === 'custom'" class="period-inline">
              <input
                v-model="customFrom"
                type="date"
                class="period-inline__input"
                aria-label="Date de début"
                :max="customTo || todayKey"
              />
              <span class="period-inline__sep" aria-hidden="true">→</span>
              <input
                v-model="customTo"
                type="date"
                class="period-inline__input"
                aria-label="Date de fin"
                :min="customFrom || undefined"
                :max="todayKey"
              />
            </div>

            <UiButton
              size="sm"
              variant="ghost"
              :icon="RefreshCw"
              :disabled="loading"
              @click="loadJournal"
            >
              Actualiser
            </UiButton>
          </div>
        </div>
      </header>

      <div class="journal-toolbar">
        <label class="journal-toolbar__search">
          <Search :size="15" aria-hidden="true" />
          <input
            v-model="searchInput"
            type="search"
            placeholder="Rechercher libellé, référence…"
            aria-label="Rechercher dans le journal"
          />
        </label>

        <select v-model="filterType" class="journal-toolbar__select" aria-label="Filtrer par flux">
          <option v-for="option in TYPE_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>

        <select v-model="filterCategory" class="journal-toolbar__select" aria-label="Filtrer par catégorie">
          <option v-for="option in CATEGORY_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>

        <button
          v-if="hasActiveFilters"
          type="button"
          class="journal-toolbar__reset"
          @click="resetFilters"
        >
          Effacer filtres
        </button>

        <div class="journal-toolbar__actions">
          <UiButton
            size="sm"
            variant="secondary"
            :icon="FileDown"
            :disabled="exportingPdf || loading || !journal?.dailyByMonth.length"
            @click="downloadPdf"
          >
            PDF
          </UiButton>
          <UiButton
            size="sm"
            variant="secondary"
            :icon="Printer"
            :disabled="loading || !journal?.dailyByMonth.length"
            @click="printJournal"
          >
            Imprimer
          </UiButton>
        </div>
      </div>
    </section>

    <section class="page-with-table__body journal-page__body journal-print-content">
      <div v-if="loading" class="journal-state">Chargement de la synthèse…</div>
      <div v-else-if="!journal?.dailyByMonth.length" class="journal-state journal-state--empty">
        <TrendingUp :size="32" />
        <p>{{ hasActiveFilters ? 'Aucun résultat pour ces filtres' : 'Aucun mouvement sur cette période' }}</p>
      </div>

      <template v-else>
        <article
          v-for="month in journal.dailyByMonth"
          :key="`${month.year}-${month.month}`"
          class="journal-month journal-print-month"
          :class="{ 'journal-month--solo': journal.dailyByMonth.length === 1 }"
        >
          <header class="journal-month__head">
            <h3 class="journal-month__title">{{ month.monthLabel }}</h3>
          </header>

          <div class="journal-table-viewport">
            <table class="journal-table journal-table--body-scroll">
              <colgroup>
                <col class="col-day" />
                <col class="col-libelle" />
                <col class="col-amount" />
                <col class="col-amount" />
                <col class="col-amount" />
              </colgroup>
              <thead>
                <tr class="journal-table__head-row">
                  <th class="journal-table__head-day">Jour</th>
                  <th class="journal-table__head-libelle">Libellé</th>
                  <th class="col-num journal-table__head-cell journal-table__head-cell--in">
                    <span class="th-col-label">Entrées</span>
                    <AmountFcfa :amount="month.inflowsFcfa" variant="in" size="lg" bold class="th-col-amount" />
                  </th>
                  <th class="col-num journal-table__head-cell journal-table__head-cell--out">
                    <span class="th-col-label">Sorties</span>
                    <AmountFcfa :amount="month.outflowsFcfa" variant="out" size="lg" bold class="th-col-amount" />
                  </th>
                  <th class="col-num journal-table__head-cell journal-table__head-cell--net">
                    <span class="th-col-label">Solde jour</span>
                    <AmountFcfa
                      :amount="month.balanceFcfa"
                      :variant="month.balanceFcfa >= 0 ? 'net-pos' : 'net-neg'"
                      size="lg"
                      bold
                      class="th-col-amount"
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="day in month.days"
                  :key="day.date"
                  :class="{ 'journal-table__row--empty': !day.inflowsFcfa && !day.outflowsFcfa }"
                >
                  <td class="journal-table__day">{{ day.label }}</td>
                  <td class="journal-table__libelle">
                    <ul v-if="day.lines.length" class="journal-lines">
                      <li
                        v-for="(line, lineIndex) in day.lines"
                        :key="`${day.date}-${lineIndex}-${line.label}`"
                        class="journal-lines__row"
                        :class="{
                          'journal-lines__row--header': line.variant === 'header',
                          'journal-lines__row--header-in': line.type === 'ENTREE' && line.variant === 'header',
                          'journal-lines__row--header-out': line.type === 'SORTIE' && line.variant === 'header',
                          'journal-lines__row--sub': line.variant === 'sub',
                          'journal-lines__row--item': line.variant === 'item',
                        }"
                      >
                        <span class="journal-lines__label">{{ line.label }}</span>
                        <span
                          v-if="line.variant !== 'header'"
                          class="journal-lines__amount"
                        >
                          <AmountFcfa
                            :amount="line.amountFcfa"
                            :variant="line.type === 'ENTREE' ? 'in' : 'out'"
                            size="sm"
                          />
                        </span>
                      </li>
                    </ul>
                    <span v-else class="journal-lines__empty">Aucun mouvement</span>
                  </td>
                  <td class="col-num col-in">
                    <AmountFcfa v-if="day.inflowsFcfa" :amount="day.inflowsFcfa" variant="in" bold />
                    <span v-else class="amount-empty">—</span>
                  </td>
                  <td class="col-num col-out">
                    <AmountFcfa v-if="day.outflowsFcfa" :amount="day.outflowsFcfa" variant="out" bold />
                    <span v-else class="amount-empty">—</span>
                  </td>
                  <td class="col-num">
                    <AmountFcfa
                      v-if="day.inflowsFcfa || day.outflowsFcfa"
                      :amount="day.balanceFcfa"
                      :variant="day.balanceFcfa >= 0 ? 'net-pos' : 'net-neg'"
                      bold
                    />
                    <span v-else class="amount-empty">—</span>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="2"><strong>Total {{ month.monthLabel }}</strong></td>
                  <td class="col-num col-in">
                    <AmountFcfa :amount="month.inflowsFcfa" variant="in" bold />
                  </td>
                  <td class="col-num col-out">
                    <AmountFcfa :amount="month.outflowsFcfa" variant="out" bold />
                  </td>
                  <td class="col-num">
                    <AmountFcfa
                      :amount="month.balanceFcfa"
                      :variant="month.balanceFcfa >= 0 ? 'net-pos' : 'net-neg'"
                      bold
                    />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </article>
      </template>
    </section>
  </div>
</template>

<style scoped>
.journal-page.page-with-table {
  height: calc(100dvh - 6.5rem);
  min-height: 32rem;
  max-width: 1120px;
  gap: 0.5rem;
}

.journal-page__head {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--bg-app, #f4f6ef);
  padding-bottom: 0.15rem;
  gap: 0.45rem;
}

.journal-page__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  border-radius: 16px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #fff;
  box-shadow: 0 4px 24px rgba(15, 23, 42, 0.04);
  overflow: hidden;
}

.journal-page__body:has(.journal-month--solo) {
  overflow: hidden;
}

.journal-page__body:has(.journal-month:not(.journal-month--solo)) {
  overflow-y: auto;
}

.journal-hero {
  padding: 1rem 1.25rem;
  border-radius: 16px;
  background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 48%, #fde68a 100%);
  border: 1px solid rgba(180, 83, 9, 0.18);
  box-shadow: 0 8px 24px rgba(180, 83, 9, 0.07);
}

.journal-hero__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.25rem;
}

.journal-hero__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 0.55rem;
  flex: 1;
  min-width: min(100%, 22rem);
  max-width: 36rem;
  margin-left: auto;
}

.journal-hero__content {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}

.journal-hero__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 3rem;
  border-radius: 12px;
  background: linear-gradient(145deg, #b45309, #92400e);
  color: #fff;
  box-shadow: 0 6px 14px rgba(146, 64, 14, 0.25);
  flex-shrink: 0;
}

.journal-hero__eyebrow {
  margin: 0 0 0.1rem;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #92400e;
}

.journal-hero__title {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #78350f;
  line-height: 1.15;
}

.journal-hero__subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: #a16207;
}

.period-pills {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.2rem;
  padding: 0.2rem;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(180, 83, 9, 0.12);
}

.period-pill {
  border: none;
  border-radius: 8px;
  padding: 0.4rem 0.7rem;
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 700;
  color: #92400e;
  background: transparent;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.period-pill:hover {
  background: rgba(255, 255, 255, 0.6);
}

.period-pill--active {
  background: #fff;
  color: #78350f;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}

.period-inline {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.35rem;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(180, 83, 9, 0.12);
}

.period-inline__input {
  width: 8.75rem;
  height: 2rem;
  padding: 0 0.4rem;
  border: 1px solid rgba(180, 83, 9, 0.18);
  border-radius: 6px;
  background: #fff;
  font-family: inherit;
  font-size: 0.8125rem;
  color: #78350f;
}

.period-inline__input:focus {
  outline: 2px solid rgba(180, 83, 9, 0.2);
  outline-offset: 0;
}

.period-inline__sep {
  color: #b45309;
  font-size: 0.75rem;
  font-weight: 700;
}

.journal-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 0.55rem;
  padding: 0.55rem 0.65rem;
  border-radius: 12px;
  background: #fff;
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04);
}

.journal-toolbar__search {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex: 1;
  min-width: 10rem;
  height: 2rem;
  padding: 0 0.55rem;
  border-radius: 8px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  background: #f8fafc;
  color: #64748b;
}

.journal-toolbar__search input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 0.8125rem;
  color: #0f172a;
}

.journal-toolbar__search input:focus {
  outline: none;
}

.journal-toolbar__select {
  height: 2rem;
  padding: 0 0.55rem;
  border-radius: 8px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  background: #fff;
  font-family: inherit;
  font-size: 0.8125rem;
  color: #334155;
}

.journal-toolbar__reset {
  border: none;
  background: transparent;
  color: #92400e;
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
  padding: 0.25rem;
}

.journal-toolbar__actions {
  display: inline-flex;
  gap: 0.35rem;
  margin-left: auto;
}

.journal-print-sheet {
  display: none;
}

.journal-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2.5rem 1.35rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.9375rem;
}

.journal-state--empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.65rem;
  color: #94a3b8;
}

.journal-month {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0.85rem 1rem 1rem;
}

.journal-month__head {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  margin-bottom: 0.65rem;
}

.journal-month__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  text-transform: capitalize;
  color: var(--text);
  letter-spacing: -0.02em;
}

.journal-month--solo {
  flex: 1;
  min-height: 0;
}

.journal-month + .journal-month {
  border-top: 1px solid rgba(15, 23, 42, 0.07);
}

.journal-table-viewport {
  flex: 1;
  min-height: 0;
  border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.journal-month:not(.journal-month--solo) .journal-table-viewport {
  max-height: 22rem;
}

@media (max-width: 820px) {
  .journal-page.page-with-table {
    height: calc(100dvh - 7rem);
    min-height: 26rem;
  }

  .journal-hero__top {
    flex-direction: column;
  }

  .journal-hero__controls {
    max-width: none;
    margin-left: 0;
    justify-content: flex-start;
  }

  .period-inline {
    width: 100%;
  }

  .period-inline__input {
    flex: 1;
    min-width: 0;
    width: auto;
  }

  .journal-toolbar__actions {
    margin-left: 0;
    width: 100%;
    justify-content: flex-end;
  }
}

.journal-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
  table-layout: fixed;
}

.journal-table--body-scroll {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.journal-table--body-scroll col.col-day {
  width: 11%;
}

.journal-table--body-scroll col.col-libelle {
  width: 38%;
}

.journal-table--body-scroll col.col-amount {
  width: 17%;
}

.journal-table--body-scroll thead,
.journal-table--body-scroll tfoot {
  display: table;
  width: 100%;
  table-layout: fixed;
  flex-shrink: 0;
}

.journal-table--body-scroll tbody {
  display: block;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  -webkit-overflow-scrolling: touch;
}

.journal-table--body-scroll tbody tr {
  display: table;
  width: 100%;
  table-layout: fixed;
}

.journal-table th,
.journal-table td {
  padding: 0.7rem 1rem;
  text-align: left;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
}

.journal-table th {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
  background: #f8fafc;
  vertical-align: bottom;
}

.journal-table__head-row th {
  padding-top: 0.75rem;
  padding-bottom: 0.7rem;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}

.journal-table__head-day {
  font-size: 0.6875rem;
  vertical-align: bottom;
}

.journal-table__head-libelle {
  font-size: 0.6875rem;
  vertical-align: bottom;
  text-align: left;
}

.journal-table__libelle {
  vertical-align: top;
  padding-top: 0.65rem;
  padding-bottom: 0.65rem;
}

.journal-lines {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.journal-lines__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.8125rem;
  line-height: 1.35;
}

.journal-lines__row--header {
  font-weight: 800;
  font-size: 0.8125rem;
  padding-bottom: 0.15rem;
  border-bottom: 1px dashed rgba(15, 23, 42, 0.08);
  justify-content: flex-start;
}

.journal-lines__row--header-in {
  color: #15803d;
}

.journal-lines__row--header-out {
  color: #be123c;
  margin-top: 0.25rem;
}

.journal-lines__row--sub {
  padding-left: 0.65rem;
  color: #475569;
}

.journal-lines__row--sub .journal-lines__label::before {
  content: '· ';
  opacity: 0.6;
}

.journal-lines__row--item {
  padding-left: 0.65rem;
  color: #334155;
}

.journal-lines__row--item .journal-lines__label::before {
  content: '— ';
  color: #be123c;
  opacity: 0.75;
}

.journal-lines__amount {
  flex-shrink: 0;
}

.journal-lines__amount :deep(.amount-fcfa) {
  justify-content: flex-end;
}

.journal-lines__empty {
  color: #cbd5e1;
  font-size: 0.8125rem;
}

.journal-table__head-cell {
  text-align: right;
}

.th-col-label {
  display: block;
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.25rem;
  opacity: 0.9;
}

.journal-table__head-cell :deep(.th-col-amount) {
  justify-content: flex-end;
  width: 100%;
}

.journal-table__head-cell--in .th-col-label {
  color: #15803d;
}

.journal-table__head-cell--out .th-col-label {
  color: #be123c;
}

.journal-table__head-cell--net .th-col-label {
  color: #1d4ed8;
}

.amount-empty {
  color: #cbd5e1;
  font-weight: 600;
}

.journal-table tfoot td {
  background: #f8fafc;
  border-bottom: none;
  font-size: 0.8125rem;
  box-shadow: 0 -1px 0 rgba(15, 23, 42, 0.06);
}

.journal-table th.col-num,
.journal-table td.col-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.journal-table td.col-num :deep(.amount-fcfa) {
  width: 100%;
  justify-content: flex-end;
}

.journal-table tbody tr:hover:not(.journal-table__row--empty) {
  background: rgba(245, 158, 11, 0.04);
}

.journal-table tbody tr:nth-child(even):not(.journal-table__row--empty) {
  background: rgba(248, 250, 252, 0.8);
}

.journal-table__day {
  font-weight: 600;
  color: var(--text);
}

.journal-table__row--empty td {
  color: #cbd5e1;
}

@media print {
  @page {
    size: A4 landscape;
    margin: 10mm;
  }

  :global(body *) {
    visibility: hidden;
  }

  :global(body) {
    background: #fff !important;
  }

  .journal-page,
  .journal-page * {
    visibility: visible;
  }

  .journal-page {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
  }

  .no-print {
    display: none !important;
  }

  .journal-print-sheet {
    display: block;
    margin-bottom: 1rem;
    page-break-after: avoid;
  }

  .journal-print-sheet :deep(.clinic-letterhead) {
    border-bottom: 2px solid #fde68a;
    margin-bottom: 0.75rem;
    padding-bottom: 0.75rem;
  }

  .journal-print-sheet :deep(.clinic-letterhead__logo) {
    width: 3.5rem;
    height: 3.5rem;
  }

  .journal-print-sheet :deep(.clinic-letterhead__info h2) {
    font-size: 0.95rem;
    color: #0f766e;
  }

  .journal-print-sheet :deep(.clinic-letterhead__doc) {
    color: #78350f !important;
    font-size: 0.8125rem;
  }

  .journal-print-meta {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 0.85rem;
  }

  .journal-print-meta__period {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 700;
    color: #0f172a;
    text-transform: capitalize;
  }

  .journal-print-meta__filters {
    margin: 0.25rem 0 0;
    font-size: 0.75rem;
    color: #64748b;
    font-style: italic;
  }

  .journal-print-meta__date {
    margin: 0;
    font-size: 0.75rem;
    color: #64748b;
    white-space: nowrap;
  }

  .journal-print-kpis {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.65rem;
    margin-bottom: 1rem;
  }

  .journal-print-kpi {
    padding: 0.55rem 0.75rem;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    background: #f8fafc;
  }

  .journal-print-kpi--in {
    background: #ecfdf5;
    border-color: #86efac;
  }

  .journal-print-kpi--out {
    background: #fff1f2;
    border-color: #fda4af;
  }

  .journal-print-kpi--net-pos {
    background: #eff6ff;
    border-color: #93c5fd;
  }

  .journal-print-kpi--net-neg {
    background: #fff1f2;
    border-color: #fda4af;
  }

.journal-print-kpi__label {
  display: block;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 0.2rem;
}

.journal-print-kpi :deep(.amount-fcfa) {
  justify-content: flex-start;
}

  .journal-print-footer {
    display: none;
  }

  .journal-page.page-with-table {
    height: auto !important;
    min-height: 0 !important;
    max-width: none;
  }

  .journal-page__body,
  .journal-print-content {
    overflow: visible !important;
    border: none !important;
    box-shadow: none !important;
    background: #fff !important;
    padding: 0 !important;
  }

  .journal-print-month {
    break-inside: avoid-page;
    page-break-inside: avoid;
    padding: 0.35rem 0 0.75rem !important;
  }

  .journal-month + .journal-month {
    border-top: 1px solid #e2e8f0;
    margin-top: 0.5rem;
    padding-top: 0.75rem !important;
  }

  .journal-month__title {
    font-size: 0.9375rem !important;
    color: #78350f !important;
  }

  .journal-table-viewport {
    overflow: visible !important;
    max-height: none !important;
    border: 1px solid #cbd5e1 !important;
    border-radius: 6px !important;
  }

  .journal-table--body-scroll {
    display: table !important;
    height: auto !important;
    width: 100% !important;
  }

  .journal-table--body-scroll thead {
    display: table-header-group !important;
  }

  .journal-table--body-scroll tfoot {
    display: table-footer-group !important;
  }

  .journal-table--body-scroll tbody {
    display: table-row-group !important;
    overflow: visible !important;
  }

  .journal-table--body-scroll thead,
  .journal-table--body-scroll tfoot,
  .journal-table--body-scroll tbody tr {
    display: table-row !important;
  }

  .journal-table th,
  .journal-table td {
    border: 1px solid #e2e8f0 !important;
    padding: 0.45rem 0.55rem !important;
    font-size: 0.75rem !important;
  }

  .journal-table th {
    background: #fffbeb !important;
    color: #92400e !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .journal-table tfoot td {
    background: #f8fafc !important;
    font-weight: 700 !important;
  }

  .journal-table tbody tr:nth-child(even):not(.journal-table__row--empty) {
    background: #fafafa !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .journal-table .col-in :deep(.amount-fcfa),
  .journal-table__head-cell--in :deep(.amount-fcfa) {
    color: #166534 !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .journal-table .col-out :deep(.amount-fcfa),
  .journal-table__head-cell--out :deep(.amount-fcfa) {
    color: #9f1239 !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .journal-lines__row--header-in {
    color: #166534 !important;
  }

  .journal-lines__row--header-out {
    color: #9f1239 !important;
  }

  .journal-table__row--empty {
    display: none !important;
  }
}
</style>
