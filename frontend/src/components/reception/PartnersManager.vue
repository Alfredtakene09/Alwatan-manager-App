<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Building2, Plus, Pencil, Save, EyeOff, Eye } from '@lucide/vue'
import api from '@/api/client'
import { showApiErrorModal } from '@/lib/api-modal-helper'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'

const { uiText, dateTimeText, numberText, localeCode } = useAppI18n()

type Partner = { id: string; name: string; active: boolean; createdAt: string }

const partners = ref<Partner[]>([])
const loading = ref(false)
const saving = ref(false)
/** null = fermé ; id vide = création. */
const editing = ref<{ id: string; name: string } | null>(null)

const canSave = computed(() => (editing.value?.name.trim().length ?? 0) >= 2)
const countLabel = computed(() => {
  void localeCode.value
  return translateTemplate('{n} partenaire(s)', { n: numberText(partners.value.length) })
})

async function load() {
  loading.value = true
  try {
    const { data } = await api.get<Partner[]>('/partners', { params: { all: '1' } })
    partners.value = data
  } finally {
    loading.value = false
  }
}

async function save() {
  const current = editing.value
  if (!current || !canSave.value || saving.value) return
  saving.value = true
  try {
    const name = current.name.trim()
    if (current.id) await api.patch(`/partners/${current.id}`, { name })
    else await api.post('/partners', { name })
    editing.value = null
    await load()
  } catch (error) {
    await showApiErrorModal(error, uiText("Impossible d'enregistrer le partenaire."))
  } finally {
    saving.value = false
  }
}

async function toggleActive(partner: Partner) {
  try {
    await api.patch(`/partners/${partner.id}`, { active: !partner.active })
    partner.active = !partner.active
  } catch (error) {
    await showApiErrorModal(error, uiText("Impossible d'enregistrer le partenaire."))
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-create-bar">
      <UiButton variant="primary" :icon="Plus" @click="editing = { id: '', name: '' }">Nouveau</UiButton>
    </div>

    <UiCard title="Liste des partenaires" :icon="Building2" icon-variant="blue">
      <template #actions>
        <span class="list-count">{{ countLabel }}</span>
      </template>

      <p v-if="!loading && !partners.length" class="empty">
        {{ uiText('Aucun partenaire enregistré pour le moment') }}
      </p>
      <div v-else class="table-wrap">
        <table class="partners-table">
          <thead>
            <tr>
              <th>{{ uiText('Nom') }}</th>
              <th>{{ uiText('Statut') }}</th>
              <th>{{ uiText('Enregistré le') }}</th>
              <th class="col-actions">{{ uiText('Actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="partner in partners" :key="partner.id" :class="{ inactive: !partner.active }">
              <td><strong>{{ partner.name }}</strong></td>
              <td>{{ partner.active ? uiText('Actif') : uiText('Masqué') }}</td>
              <td>{{ dateTimeText(partner.createdAt) }}</td>
              <td class="col-actions">
                <UiButton
                  variant="ghost"
                  size="sm"
                  :icon="Pencil"
                  @click="editing = { id: partner.id, name: partner.name }"
                >
                  Modifier
                </UiButton>
                <UiButton
                  variant="ghost"
                  size="sm"
                  :icon="partner.active ? EyeOff : Eye"
                  @click="toggleActive(partner)"
                >
                  {{ partner.active ? uiText('Masquer') : uiText('Réactiver') }}
                </UiButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCard>

    <UiFormModal
      v-if="editing"
      title-id="partner-modal-title"
      :title="editing.id ? 'Modifier le partenaire' : 'Nouveau partenaire'"
      :icon="Building2"
      @close="editing = null"
    >
      <form id="partner-form" @submit.prevent="save">
        <UiInput
          v-model="editing.name"
          label="Nom de l'ONG ou du partenaire"
          :icon="Building2"
          required
          autofocus
        />
      </form>
      <template #footer>
        <UiButton type="button" variant="ghost" @click="editing = null">Annuler</UiButton>
        <UiButton type="submit" form="partner-form" variant="primary" :icon="Save" :disabled="!canSave || saving">
          {{ saving ? uiText('Enregistrement…') : uiText('Enregistrer') }}
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.table-wrap {
  overflow-x: auto;
}

.partners-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.partners-table th,
.partners-table td {
  padding: 0.65rem 0.5rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: middle;
}

.partners-table tr.inactive td {
  color: var(--text-muted);
}

.col-actions {
  text-align: right;
  white-space: nowrap;
}

.list-count {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
}

.empty {
  text-align: center;
  color: var(--text-light);
  padding: 1.5rem;
}
</style>
