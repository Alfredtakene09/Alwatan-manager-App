<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  ClipboardList,
  BedDouble,
  FileText,
  Receipt,
  Clock,
  ChevronRight,
  Scissors,
  Banknote,
} from '@lucide/vue'
import { useComptabiliteQueue } from '@/composables/useComptabiliteQueue'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import ComptabiliteStatsGrid from '@/components/comptabilite/ComptabiliteStatsGrid.vue'

const router = useRouter()
const { uiText, localeCode } = useAppI18n()
const { data, load } = useComptabiliteQueue()

const sections = computed(() => {
  void localeCode.value
  return [
  {
    to: '/comptabilite/en-attente-paiement',
    label: uiText('En attente de paiement'),
    description: uiText('Examens prescrits par les médecins'),
    icon: Clock,
    countKey: 'labPending' as const,
  },
  {
    to: '/comptabilite/compte-rendu-caisse',
    label: uiText('Compte rendu caisse'),
    description: uiText('Matin & soir — décaissement par caissier'),
    icon: Banknote,
    countKey: null,
  },
  {
    to: '/reception/comptabilite',
    label: uiText('Encaissements clinique'),
    description: uiText('Consultations, examens, chirurgie et hospitalisation'),
    icon: Receipt,
    countKey: null,
  },
  {
    to: '/hospitalisation',
    label: uiText('Hospitalisation'),
    description: uiText('Attribution des salles et hospitalisations'),
    icon: BedDouble,
    countKey: 'hospitalizations' as const,
  },
  {
    to: '/comptabilite/operations-attente',
    label: uiText('Opérations en attente'),
    description: uiText('Opérations payées à planifier'),
    icon: Scissors,
    countKey: 'surgeries' as const,
  },
  {
    to: '/factures',
    label: uiText('Factures'),
    description: uiText('Tous les documents comptables'),
    icon: FileText,
    countKey: null,
  },
]
})

const counts = computed(() => ({
  labPending: data.value?.labExamsPending?.length ?? 0,
  hospitalizations: data.value?.hospitalizations?.length ?? 0,
  surgeries: data.value?.surgeries?.length ?? 0,
}))

onMounted(load)
</script>

<template>
  <div>
    <UiPageHeader
      title="Comptabilités"
      subtitle="Vue d'ensemble — consultations, examens, bloc opératoire et plus"
      :icon="ClipboardList"
    />

    <ComptabiliteStatsGrid />

    <UiCard title="Rubriques comptables" :icon="ClipboardList" icon-variant="teal" class="hub-card">
      <div class="hub-list">
        <button
          v-for="section in sections"
          :key="section.to"
          type="button"
          class="hub-item"
          @click="router.push(section.to)"
        >
          <div class="hub-item__icon">
            <component :is="section.icon" :size="20" />
          </div>
          <div class="hub-item__body">
            <strong>{{ section.label }}</strong>
            <span>{{ section.description }}</span>
          </div>
          <div v-if="section.countKey" class="hub-item__count">
            {{ counts[section.countKey] }}
          </div>
          <ChevronRight :size="18" class="hub-item__chevron" />
        </button>
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.hub-card {
  margin-top: 0.25rem;
}

.hub-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.hub-item {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  width: 100%;
  padding: 0.9rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fafcfd;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.hub-item:hover {
  border-color: var(--primary-300);
  background: var(--primary-50);
}

.hub-item__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 10px;
  background: var(--primary-100);
  color: var(--primary-700);
  flex-shrink: 0;
}

.hub-item__body {
  flex: 1;
  min-width: 0;
}

.hub-item__body strong {
  display: block;
  font-size: 0.9rem;
  margin-bottom: 0.15rem;
}

.hub-item__body span {
  display: block;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.hub-item__count {
  min-width: 2rem;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: #f1f5f9;
  font-size: 0.8125rem;
  font-weight: 700;
  text-align: center;
  color: var(--text);
}

.hub-item__chevron {
  color: var(--text-light);
  flex-shrink: 0;
}
</style>
