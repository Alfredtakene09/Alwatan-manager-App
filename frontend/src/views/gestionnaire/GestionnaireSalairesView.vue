<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Coins, Banknote, History, HandCoins, Clock } from '@lucide/vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import CaisseToolbar from '@/components/caisse/CaisseToolbar.vue'
import GestionnairePayrollMoisPanel from '@/components/gestionnaire/GestionnairePayrollMoisPanel.vue'
import GestionnairePayrollHistoriquePanel from '@/components/gestionnaire/GestionnairePayrollHistoriquePanel.vue'
import GestionnaireSalaryAdvancesPanel from '@/components/gestionnaire/GestionnaireSalaryAdvancesPanel.vue'
import GestionnaireOvertimePanel from '@/components/gestionnaire/GestionnaireOvertimePanel.vue'
import '@/assets/gestionnaire-page.css'

type TabId = 'mois' | 'historique' | 'avances' | 'heures-supp'

const route = useRoute()
const router = useRouter()

const now = new Date()
const payrollYear = ref(Number(route.query.year) || now.getFullYear())
const payrollMonth = ref(Number(route.query.month) || now.getMonth() + 1)

const activeTab = ref<TabId>(
  route.query.tab === 'historique'
    ? 'historique'
    : route.query.tab === 'avances'
      ? 'avances'
      : route.query.tab === 'heures-supp'
        ? 'heures-supp'
        : 'mois',
)

const historiquePanelRef = ref<InstanceType<typeof GestionnairePayrollHistoriquePanel> | null>(null)
const avancesPanelRef = ref<InstanceType<typeof GestionnaireSalaryAdvancesPanel> | null>(null)
const overtimePanelRef = ref<InstanceType<typeof GestionnaireOvertimePanel> | null>(null)

const periodLabel = computed(() =>
  new Date(payrollYear.value, payrollMonth.value - 1, 1).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  }),
)

const pageSubtitle = computed(() => {
  if (activeTab.value === 'historique') return 'Historique des salaires payés'
  if (activeTab.value === 'avances') return 'Avances sur salaire des employés'
  if (activeTab.value === 'heures-supp') return 'Heures supplémentaires médecins — validation et calcul'
  return `Paie — ${periodLabel.value}`
})

function selectTab(tab: TabId) {
  activeTab.value = tab
}

function updatePeriod(year: number, month: number) {
  payrollYear.value = year
  payrollMonth.value = month
}

function onPaid() {
  historiquePanelRef.value?.reload()
  avancesPanelRef.value?.reload()
  overtimePanelRef.value?.reload()
}

function syncRouteQuery() {
  const query: Record<string, string> = {}
  if (activeTab.value === 'historique') query.tab = 'historique'
  else if (activeTab.value === 'avances') query.tab = 'avances'
  else if (activeTab.value === 'heures-supp') query.tab = 'heures-supp'
  if (activeTab.value === 'mois') {
    query.year = String(payrollYear.value)
    query.month = String(payrollMonth.value)
  }
  router.replace({ query })
}

watch(activeTab, syncRouteQuery)

watch([payrollYear, payrollMonth], () => {
  if (activeTab.value === 'mois') syncRouteQuery()
})

watch(
  () => route.query.tab,
  (tab) => {
    activeTab.value =
      tab === 'historique'
        ? 'historique'
        : tab === 'avances'
          ? 'avances'
          : tab === 'heures-supp'
            ? 'heures-supp'
            : 'mois'
  },
)

watch(
  () => [route.query.year, route.query.month] as const,
  ([year, month]) => {
    if (year) payrollYear.value = Number(year)
    if (month) payrollMonth.value = Number(month)
  },
)
</script>

<template>
  <div class="gestionnaire-page salaires-page">
    <UiPageHeader title="Salaires & paie" :subtitle="pageSubtitle" :icon="Coins" />

    <CaisseToolbar role="tablist" aria-label="Sections salaires">
      <button
        type="button"
        class="salaires-toolbar__tab"
        :class="{ 'salaires-toolbar__tab--active': activeTab === 'mois' }"
        :aria-selected="activeTab === 'mois'"
        @click="selectTab('mois')"
      >
        <Banknote :size="16" />
        Paie du mois
      </button>
      <button
        type="button"
        class="salaires-toolbar__tab"
        :class="{ 'salaires-toolbar__tab--active': activeTab === 'historique' }"
        :aria-selected="activeTab === 'historique'"
        @click="selectTab('historique')"
      >
        <History :size="16" />
        Historique
      </button>
      <button
        type="button"
        class="salaires-toolbar__tab"
        :class="{ 'salaires-toolbar__tab--active': activeTab === 'avances' }"
        :aria-selected="activeTab === 'avances'"
        @click="selectTab('avances')"
      >
        <HandCoins :size="16" />
        Avances
      </button>
      <button
        type="button"
        class="salaires-toolbar__tab"
        :class="{ 'salaires-toolbar__tab--active': activeTab === 'heures-supp' }"
        :aria-selected="activeTab === 'heures-supp'"
        @click="selectTab('heures-supp')"
      >
        <Clock :size="16" />
        Heures supp.
      </button>
    </CaisseToolbar>

    <GestionnairePayrollMoisPanel
      v-if="activeTab === 'mois'"
      :year="payrollYear"
      :month="payrollMonth"
      @update:period="updatePeriod"
      @paid="onPaid"
    />

    <GestionnairePayrollHistoriquePanel v-else-if="activeTab === 'historique'" ref="historiquePanelRef" />
    <GestionnaireSalaryAdvancesPanel v-else-if="activeTab === 'avances'" ref="avancesPanelRef" />
    <GestionnaireOvertimePanel v-else ref="overtimePanelRef" />
  </div>
</template>

<style scoped>
.salaires-page {
  gap: 0.75rem;
}

.salaires-toolbar__tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 2.25rem;
  padding: 0.45rem 0.9rem;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.salaires-toolbar__tab--active {
  background: #fff;
  color: var(--primary-800);
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}

@media (max-width: 720px) {
  .salaires-toolbar__tab {
    flex: 1 1 auto;
    justify-content: center;
  }
}
</style>
