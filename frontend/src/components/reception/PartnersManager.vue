<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Building2, Plus, Pencil, Save, EyeOff, Eye, Phone, UserRound, MapPin, Mail } from '@lucide/vue'
import api from '@/api/client'
import { showApiErrorModal } from '@/lib/api-modal-helper'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'

const { uiText, dateTimeText, numberText, localeCode } = useAppI18n()

type PartnerDetails = {
  name: string
  phone: string
  contactName: string
  address: string
  email: string
  notes: string
}
type Partner = {
  id: string
  name: string
  phone: string | null
  contactName: string | null
  address: string | null
  email: string | null
  notes: string | null
  active: boolean
  createdAt: string
}

function toForm(partner?: Partner): { id: string } & PartnerDetails {
  return {
    id: partner?.id ?? '',
    name: partner?.name ?? '',
    phone: partner?.phone ?? '',
    contactName: partner?.contactName ?? '',
    address: partner?.address ?? '',
    email: partner?.email ?? '',
    notes: partner?.notes ?? '',
  }
}

const partners = ref<Partner[]>([])
const loading = ref(false)
const saving = ref(false)
/** null = fermé ; id vide = création. */
const editing = ref<ReturnType<typeof toForm> | null>(null)

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
    const { id, ...details } = current
    if (id) await api.patch(`/partners/${id}`, details)
    else await api.post('/partners', details)
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
      <UiButton variant="primary" :icon="Plus" @click="editing = toForm()">Nouveau</UiButton>
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
              <th>{{ uiText('Représentant') }}</th>
              <th>{{ uiText('Contact') }}</th>
              <th>{{ uiText('Statut') }}</th>
              <th>{{ uiText('Enregistré le') }}</th>
              <th class="col-actions">{{ uiText('Actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="partner in partners" :key="partner.id" :class="{ inactive: !partner.active }">
              <td>
                <strong>{{ partner.name }}</strong>
                <span v-if="partner.address" class="sub">{{ partner.address }}</span>
              </td>
              <td>{{ partner.contactName || '—' }}</td>
              <td>
                <span v-if="partner.phone" class="sub-line">{{ partner.phone }}</span>
                <span v-if="partner.email" class="sub-line">{{ partner.email }}</span>
                <template v-if="!partner.phone && !partner.email">—</template>
              </td>
              <td>{{ partner.active ? uiText('Actif') : uiText('Masqué') }}</td>
              <td>{{ dateTimeText(partner.createdAt) }}</td>
              <td class="col-actions">
                <UiButton
                  variant="ghost"
                  size="sm"
                  :icon="Pencil"
                  @click="editing = toForm(partner)"
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
      <form id="partner-form" class="partner-form" @submit.prevent="save">
        <UiInput
          v-model="editing.name"
          label="Nom de l'ONG ou du partenaire"
          :icon="Building2"
          required
          autofocus
        />
        <div class="form-grid-2">
          <UiInput v-model="editing.contactName" label="Nom du représentant" :icon="UserRound" />
          <UiInput v-model="editing.phone" label="Téléphone" type="tel" :icon="Phone" />
        </div>
        <div class="form-grid-2">
          <UiInput v-model="editing.email" label="Adresse e-mail" type="email" :icon="Mail" />
          <UiInput v-model="editing.address" label="Adresse" :icon="MapPin" />
        </div>
        <UiTextarea v-model="editing.notes" :label="uiText('Autres informations')" :rows="3" />
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

.partner-form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.form-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

@media (max-width: 640px) {
  .form-grid-2 {
    grid-template-columns: 1fr;
  }
}

.partners-table .sub,
.partners-table .sub-line {
  display: block;
}

.partners-table .sub {
  font-size: 0.75rem;
  color: var(--text-muted);
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
