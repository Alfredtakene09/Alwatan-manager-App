<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Eye, FlaskConical, Plus, RefreshCw, Save, Search, Trash2 } from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal } from '@/lib/api-modal-helper'
import { invalidateExamCatalogCache } from '@/lib/exam-catalog'
import { formatFcfa } from '@/lib/roles'
import { type LabFormPanel } from '@/lib/lab-form-panels'
import {
  useLabPanelsStore,
  panelDtoToFormPanel,
  type LabPanelDto,
  type LabPanelFieldDto,
} from '@/stores/lab-panels'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import StCatalogActions from '@/components/ui/StCatalogActions.vue'
import LabQueueBell from '@/components/layout/LabQueueBell.vue'
import '@/assets/simple-table.css'

type FieldForm = {
  /** Identifiant local stable pour le v-for (évite de perdre la saisie section/libellé). */
  uid: string
  key: string
  section: string
  label: string
  unit: string
  reference: string
  defaultValue: string
  /** Tarif partiel optionnel (chaîne pour input number). */
  priceFcfa: string
  hasComment: boolean
}

const labPanels = useLabPanelsStore()
const { uiText, numberText } = useAppI18n()
const panels = ref<LabPanelDto[]>([])
const listSearch = ref('')
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')

const showModal = ref(false)
const editingId = ref<string | null>(null)
const showPreviewModal = ref(false)
const previewSource = ref<LabPanelDto | null>(null)
const previewFields = ref<LabPanelFieldDto[]>([])
const previewValues = reactive<Record<string, string>>({})

const previewPanel = computed<LabFormPanel | null>(() => {
  if (!previewSource.value) return null
  return panelDtoToFormPanel({ ...previewSource.value, fields: previewFields.value })
})

const form = ref<{ label: string; isEntry: boolean; active: boolean; priceFcfa: string; fields: FieldForm[] }>({
  label: '',
  isEntry: true,
  active: true,
  priceFcfa: '',
  fields: [],
})

const panelsById = computed(() => new Map(panels.value.map((panel) => [panel.id, panel])))

const modalTitle = computed(() =>
  editingId.value ? uiText('Modifier le formulaire') : uiText('Nouveau formulaire'),
)

const isEntryModel = computed({
  get: () => (form.value.isEntry ? 'entry' : 'consult'),
  set: (value: string) => {
    form.value.isEntry = value === 'entry'
  },
})

const tableRows = computed(() =>
  panels.value.map((panel) => {
    const exam = panel.examCatalogItems?.[0]
    const priceFcfa = exam?.priceFcfa
    return {
      id: panel.id,
      label: uiText(panel.label),
      slug: panel.slug,
      fieldCount: panel.fields.length,
      tariffLabel:
        priceFcfa == null
          ? '—'
          : priceFcfa <= 0
            ? uiText('À tarifer')
            : formatFcfa(priceFcfa),
      tariffPending: priceFcfa != null && priceFcfa <= 0,
      statusLabel: uiText(panel.active ? 'Actif' : 'Inactif'),
      statusVariant: panel.active ? 'success' : 'danger',
      toggleLabel: panel.active ? 'Désactiver' : 'Activer',
      isActive: panel.active,
      showView: true,
      showEdit: true,
      showToggle: true,
      canDelete: true,
    }
  }),
)

const hasActiveSearch = computed(() => listSearch.value.trim().length > 0)

const filteredTableRows = computed(() => {
  const query = listSearch.value.trim().toLocaleLowerCase()
  if (!query) return tableRows.value
  return tableRows.value.filter((row) => {
    const panel = panelsById.value.get(row.id)
    const haystack = [
      row.label,
      row.slug,
      panel?.label,
      ...(panel?.fields.map((field) => field.label) ?? []),
      ...(panel?.fields.map((field) => field.key) ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
    return haystack.includes(query)
  })
})

const listCountLabel = computed(() => {
  if (hasActiveSearch.value) {
    return uiText('{shown} / {total} formulaire(s)')
      .replace('{shown}', numberText(filteredTableRows.value.length))
      .replace('{total}', numberText(panels.value.length))
  }
  return uiText('{n} formulaire(s)').replace('{n}', numberText(panels.value.length))
})

function resetSearch() {
  listSearch.value = ''
}

function resetMessages() {
  message.value = ''
}

async function loadPanels() {
  loading.value = true
  resetMessages()
  try {
    const { data } = await api.get<LabPanelDto[]>('/lab-panels')
    panels.value = [...data].sort((a, b) =>
      a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }),
    )
  } catch {
    message.value = 'Impossible de charger les formulaires.'
    messageType.value = 'error'
  } finally {
    loading.value = false
  }
}

let fieldUidSeq = 0
function nextFieldUid() {
  fieldUidSeq += 1
  return `field-${fieldUidSeq}`
}

function emptyField(partial?: Partial<Omit<FieldForm, 'uid'>>): FieldForm {
  return {
    uid: nextFieldUid(),
    key: '',
    section: '',
    label: '',
    unit: '',
    reference: '',
    defaultValue: '',
    priceFcfa: '',
    hasComment: false,
    ...partial,
  }
}

function parseOptionalFieldPrice(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  // Vide / 0 / invalide → pas de tarif unitaire (jamais bloquant à l’enregistrement).
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) return null
  return value
}

/** Insère un nouveau champ juste après la ligne `index` (fin de liste si index omis). */
function insertFieldAfter(index?: number) {
  const insertAt = index == null ? form.value.fields.length : index + 1
  const previous =
    index == null
      ? form.value.fields[form.value.fields.length - 1]
      : form.value.fields[index]
  form.value.fields.splice(
    insertAt,
    0,
    emptyField({
      // Reprend la section de la ligne précédente pour que le titre soit conservé
      section: previous?.section ?? '',
    }),
  )
}

function removeField(index: number) {
  form.value.fields.splice(index, 1)
}

function openCreate() {
  editingId.value = null
  form.value = { label: '', isEntry: true, active: true, priceFcfa: '', fields: [emptyField()] }
  showModal.value = true
}

function openEdit(id: string) {
  const panel = panelsById.value.get(id)
  if (!panel) return
  editingId.value = id
  const linkedPrice = panel.examCatalogItems?.[0]?.priceFcfa
  form.value = {
    label: panel.label,
    isEntry: panel.isEntry,
    active: panel.active,
    priceFcfa: linkedPrice != null && linkedPrice > 0 ? String(linkedPrice) : '',
    fields: [...panel.fields]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((field) =>
        emptyField({
          key: field.key,
          section: field.section ?? '',
          label: field.label,
          unit: field.unit ?? '',
          reference: field.reference ?? '',
          defaultValue: field.defaultValue ?? '',
          priceFcfa:
            field.priceFcfa != null && field.priceFcfa > 0 ? String(field.priceFcfa) : '',
          hasComment: field.hasComment === true,
        }),
      ),
  }
  if (!form.value.fields.length) form.value.fields.push(emptyField())
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  editingId.value = null
}

function openPreview(id: string) {
  const panel = panelsById.value.get(id)
  if (!panel) return
  previewSource.value = panel
  previewFields.value = [...panel.fields].sort((a, b) => a.sortOrder - b.sortOrder)
  Object.keys(previewValues).forEach((key) => delete previewValues[key])
  for (const field of previewFields.value) {
    previewValues[field.key] = field.defaultValue?.trim() ?? ''
  }
  showPreviewModal.value = true
}

function closePreview() {
  showPreviewModal.value = false
  previewSource.value = null
  previewFields.value = []
}

async function save() {
  const label = form.value.label.trim()
  const priceFcfa = Number(form.value.priceFcfa)
  const fields = form.value.fields
    .filter((field) => field.label.trim())
    .map((field) => ({
      key: field.key.trim() || undefined,
      // null explicite pour que la section vide efface bien l’ancienne valeur en base
      section: field.section.trim() ? field.section.trim() : null,
      label: field.label.trim(),
      unit: field.unit.trim() || null,
      reference: field.reference.trim() || null,
      defaultValue: field.defaultValue.trim() || null,
      priceFcfa: parseOptionalFieldPrice(field.priceFcfa),
      hasComment: false,
      type: 'text',
    }))

  if (label.length < 2) {
    message.value = uiText('Le nom du formulaire est obligatoire.')
    messageType.value = 'error'
    return
  }

  if (!Number.isFinite(priceFcfa) || !Number.isInteger(priceFcfa) || priceFcfa < 1) {
    message.value = uiText('Le tarif est obligatoire et doit être supérieur à 0.')
    messageType.value = 'error'
    return
  }

  saving.value = true
  resetMessages()
  try {
    if (editingId.value) {
      await api.put(`/lab-panels/${editingId.value}`, {
        label,
        isEntry: form.value.isEntry,
        active: form.value.active,
        priceFcfa,
        fields,
      })
      message.value = fields.length
        ? 'Formulaire mis à jour — proposé automatiquement au médecin.'
        : 'Formulaire mis à jour (aucun champ — non proposé au médecin).'
    } else {
      await api.post('/lab-panels', {
        label,
        isEntry: form.value.isEntry,
        priceFcfa,
        fields,
      })
      message.value = fields.length
        ? 'Formulaire créé — proposé automatiquement au médecin.'
        : 'Formulaire créé sans champ — non proposé au médecin tant que les résultats ne sont pas ajoutés.'
    }
    messageType.value = 'success'
    invalidateExamCatalogCache()
    closeModal()
    await loadPanels()
    await labPanels.fetchPanels(true)
  } catch (error: unknown) {
    const apiError =
      error &&
      typeof error === 'object' &&
      'response' in error &&
      error.response &&
      typeof error.response === 'object' &&
      'data' in error.response &&
      error.response.data &&
      typeof error.response.data === 'object' &&
      'error' in error.response.data
        ? String((error.response.data as { error?: unknown }).error ?? '')
        : ''
    message.value = apiError.trim() || 'Enregistrement impossible. Vérifiez les champs.'
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

async function toggle(id: string) {
  const panel = panelsById.value.get(id)
  if (!panel) return
  resetMessages()
  try {
    await api.put(`/lab-panels/${id}`, { active: !panel.active })
    message.value = panel.active ? 'Formulaire désactivé.' : 'Formulaire réactivé.'
    messageType.value = 'success'
    invalidateExamCatalogCache()
    await loadPanels()
    await labPanels.fetchPanels(true)
  } catch {
    message.value = 'Action impossible.'
    messageType.value = 'error'
  }
}

async function remove(id: string) {
  const panel = panelsById.value.get(id)
  if (!panel) return
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer le formulaire',
    message: `Supprimer définitivement « ${panel.label} » ? Les résultats déjà saisis restent conservés dans les dossiers.`,
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return

  resetMessages()
  try {
    await api.delete(`/lab-panels/${id}`)
    message.value = 'Formulaire supprimé.'
    messageType.value = 'success'
    invalidateExamCatalogCache()
    await loadPanels()
    await labPanels.fetchPanels(true)
  } catch {
    message.value = 'Suppression impossible.'
    messageType.value = 'error'
  }
}

function onTableAction({ action, id }: { action: string; id: string }) {
  if (action === 'view') openPreview(id)
  if (action === 'toggle') toggle(id)
  if (action === 'edit') openEdit(id)
  if (action === 'delete') remove(id)
}

onMounted(loadPanels)
</script>

<template>
  <div>
    <UiPageHeader
      title="Formulaires de résultats"
      subtitle="Créez et modifiez les formulaires de saisie des résultats du laboratoire"
      :icon="FlaskConical"
    />

    <UiAlert v-if="message" :type="messageType" :message="message" />

    <UiCard
      title="Formulaires de résultats"
      :icon="FlaskConical"
      icon-variant="teal"
      class="section"
    >
      <template #actions>
        <div class="panels-toolbar">
          <label class="panels-toolbar__search">
            <Search :size="16" aria-hidden="true" />
            <input
              v-model="listSearch"
              type="search"
              :placeholder="uiText('Rechercher un formulaire…')"
              :aria-label="uiText('Rechercher un formulaire')"
            />
          </label>
          <UiButton v-if="hasActiveSearch" variant="ghost" size="sm" @click="resetSearch">
            Effacer
          </UiButton>
          <UiButton variant="primary" size="sm" :icon="Plus" @click="openCreate">
            Nouveau formulaire
          </UiButton>
          <LabQueueBell />
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadPanels">
            Actualiser
          </UiButton>
          <span class="list-count">{{ listCountLabel }}</span>
        </div>
      </template>

      <div class="simple-table-shell simple-table-shell--static">
        <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
          <span class="simple-table-spinner" aria-hidden="true" />
          {{ uiText('Chargement des formulaires…') }}
        </div>
        <div class="simple-table-scroll">
          <div class="simple-table-wrap">
            <table class="simple-table panels-table">
              <thead>
                <tr>
                  <th class="simple-table__num">#</th>
                  <th>{{ uiText('Formulaire') }}</th>
                  <th>{{ uiText('Identifiant') }}</th>
                  <th>{{ uiText('Champs') }}</th>
                  <th>{{ uiText('Tarif') }}</th>
                  <th>{{ uiText('Statut') }}</th>
                  <th class="simple-table__actions-head">{{ uiText('Actions') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!loading && !tableRows.length">
                  <td colspan="7" class="panels-table-empty">{{ uiText('Aucun formulaire enregistré.') }}</td>
                </tr>
                <tr v-else-if="!loading && !filteredTableRows.length">
                  <td colspan="7" class="panels-table-empty">
                    {{ uiText('Aucun formulaire ne correspond à la recherche.') }}
                  </td>
                </tr>
                <tr v-for="(row, index) in filteredTableRows" v-else :key="row.id">
                  <td class="simple-table__num">{{ numberText(index + 1) }}</td>
                  <td><span class="st-name">{{ row.label }}</span></td>
                  <td><code class="panels-table-slug">{{ row.slug }}</code></td>
                  <td><span class="st-amount">{{ numberText(row.fieldCount) }}</span></td>
                  <td>
                    <span
                      class="st-amount"
                      :class="{ 'panels-table-tariff--pending': row.tariffPending }"
                    >{{ row.tariffLabel }}</span>
                  </td>
                  <td>
                    <span class="st-badge" :class="`st-badge--${row.statusVariant}`">{{ row.statusLabel }}</span>
                  </td>
                  <td class="simple-table__actions">
                    <StCatalogActions
                      :id="row.id"
                      :is-active="row.isActive"
                      :toggle-label="row.toggleLabel"
                      :can-delete="row.canDelete"
                      :show-edit="row.showEdit"
                      :show-view="row.showView"
                      :show-toggle="row.showToggle"
                      @action="onTableAction"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </UiCard>

    <UiFormModal
      v-if="showModal"
      title-id="lab-panel-form-title"
      :title="modalTitle"
      subtitle="Nom, usage et liste des champs du formulaire"
      :icon="FlaskConical"
      size="large"
      @close="closeModal"
    >
      <section class="form-panel">
        <div class="form-grid-2">
          <UiInput v-model="form.label" label="Nom du formulaire" placeholder="Ex. Bilan rénal" />
          <UiInput
            v-model="form.priceFcfa"
            label="Tarif (FCFA)"
            type="number"
            placeholder="Ex. 5000"
            required
          />
          <UiSelect v-model="isEntryModel" label="Usage">
            <option value="entry">{{ uiText('Saisie (proposé au laboratoire)') }}</option>
            <option value="consult">{{ uiText('Consultation seule') }}</option>
          </UiSelect>
        </div>

        <div class="fields-header">
          <h4 class="fields-title">{{ uiText('Champs du formulaire') }}</h4>
          <UiButton variant="outline" size="sm" :icon="Plus" @click="insertFieldAfter()">
            Ajouter un champ
          </UiButton>
        </div>
        <p class="fields-hint">
          {{
            uiText(
              'Prix par champ : utilisé si le médecin coche seulement certains labels ; sinon le tarif général de l’examen s’applique.',
            )
          }}
        </p>

        <p v-if="!form.fields.length" class="fields-empty">{{ uiText('Aucun champ pour l’instant — vous pouvez en ajouter maintenant ou plus tard.') }}</p>

        <div v-for="(field, index) in form.fields" :key="field.uid" class="field-block">
          <div class="field-row">
            <div class="field-row__grid">
              <UiInput v-model="field.label" label="Libellé" placeholder="Ex. Créatinine" />
              <UiInput v-model="field.section" label="Section (optionnel)" placeholder="Ex. Électrolytes" />
              <UiInput v-model="field.unit" label="Unité (optionnel)" placeholder="Ex. mg/dl" />
              <UiInput v-model="field.reference" label="Valeur de référence (optionnel)" placeholder="Ex. 0.6 - 1.1 mg/dl" />
              <UiInput
                v-model="field.priceFcfa"
                :label="uiText('Prix (optionnel)')"
                type="number"
                placeholder="Ex. 1500"
                :required="false"
              />
              <UiInput
                v-model="field.defaultValue"
                :label="uiText('Texte par défaut (prérempli à la saisie)')"
                placeholder="Ex. Negative(-ve)"
              />
            </div>
            <button
              type="button"
              class="field-row__remove"
              :title="uiText('Supprimer le champ')"
              :aria-label="uiText('Supprimer le champ')"
              @click="removeField(index)"
            >
              <Trash2 :size="16" />
            </button>
          </div>
          <button
            type="button"
            class="field-insert"
            :title="uiText('Insérer un champ ici')"
            :aria-label="uiText('Insérer un champ ici')"
            @click="insertFieldAfter(index)"
          >
            <Plus :size="14" />
            <span>{{ uiText('Insérer un champ') }}</span>
          </button>
        </div>
      </section>

      <template #footer>
        <UiButton variant="ghost" @click="closeModal">Annuler</UiButton>
        <UiButton variant="primary" :icon="Save" :disabled="saving" @click="save">
          {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
        </UiButton>
      </template>
    </UiFormModal>

    <UiFormModal
      v-if="showPreviewModal && previewPanel"
      title-id="lab-panel-preview-title"
      :title="previewPanel.label"
      subtitle="Aperçu tel qu'affiché lors de la saisie des résultats au laboratoire"
      :icon="Eye"
      size="large"
      @close="closePreview"
    >
      <section class="preview-panel">
        <p class="preview-hint">
          Aperçu de la mise en page telle qu’affichée lors de la saisie des résultats.
          Pour modifier des champs, utilisez « Modifier ».
        </p>

        <p v-if="!previewFields.length" class="fields-empty">
          Aucun champ — ajoutez-en via « Modifier ».
        </p>

        <div
          v-for="section in previewPanel.sections"
          :key="section.title ?? 'main'"
          class="form-section"
        >
          <h3 v-if="section.title" class="form-section__title">{{ uiText(section.title) }}</h3>
          <div
            class="form-grid"
            :class="section.fields.length > 4 ? 'form-grid--cols-4' : 'form-grid--cols-2'"
          >
            <template v-for="field in section.fields" :key="field.key">
              <div class="preview-field">
                <UiInput
                  v-model="previewValues[field.key]"
                  :label="
                    field.reference
                      ? `${uiText(field.label)} (${field.reference})`
                      : uiText(field.label)
                  "
                  :placeholder="
                    field.unit
                      ? uiText('Résultat {unit}').replace('{unit}', field.unit)
                      : uiText('Résultat')
                  "
                  readonly
                />
              </div>
            </template>
          </div>
        </div>
      </section>

      <template #footer>
        <UiButton variant="ghost" @click="closePreview">Fermer</UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.section {
  margin-top: 1rem;
}

.panels-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}

.panels-toolbar__search {
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

.panels-toolbar__search:focus-within {
  border-color: var(--accent-500);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.panels-toolbar__search input {
  width: 100%;
  min-width: 10rem;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--text);
}

.panels-toolbar__search input:focus {
  outline: none;
}

.list-count {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
}

@media (max-width: 640px) {
  .panels-toolbar {
    width: 100%;
    justify-content: stretch;
  }

  .panels-toolbar__search {
    flex: 1;
    min-width: 0;
  }
}

.panels-table-wrap {
  overflow: visible;
}

.panels-table {
  width: 100%;
  margin-bottom: 0;
}

.panels-table-empty {
  text-align: center;
  padding: 1.5rem 1rem !important;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.panels-table-slug {
  font-size: 0.8125rem;
  color: var(--text-muted);
  background: var(--surface-2, #f4f6f8);
  padding: 0.15rem 0.4rem;
  border-radius: var(--radius-xs, 4px);
}

.panels-table-tariff--pending {
  color: #b45309;
  font-weight: 700;
}

.form-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
}

.fields-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 1.25rem 0 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}

.fields-title {
  margin: 0;
  font-size: 0.9rem;
  color: var(--primary-700);
}

.fields-hint {
  margin: -0.35rem 0 0.85rem;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--text-muted);
}

.fields-empty {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.field-block {
  margin-bottom: 0.35rem;
}

.field-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #f8fafc;
}

.field-row__grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem;
}

.field-row__grid :deep(.ui-field) {
  margin-bottom: 0;
}

.field-row__remove {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  margin-top: 1.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: #dc2626;
  cursor: pointer;
}

.field-row__remove:hover {
  background: #fef2f2;
  border-color: #fca5a5;
}

.field-insert {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  width: 100%;
  margin: 0.15rem 0 0.45rem;
  padding: 0.35rem 0.5rem;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.field-insert:hover {
  background: #ecfdf5;
  border-color: var(--accent-400, #34d399);
  color: var(--accent-700, #047857);
}

@media (max-width: 768px) {
  .form-grid-2,
  .field-row__grid {
    grid-template-columns: 1fr;
  }
}

.preview-panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.preview-hint {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.preview-field {
  position: relative;
}

.form-section + .form-section {
  margin-top: 1.25rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border);
}

.form-section__title {
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
  color: var(--primary-700);
}

.form-grid {
  display: grid;
  gap: 0.85rem;
}

.form-grid--cols-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-grid--cols-4 {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.65rem 0.75rem;
}

.form-grid--cols-4 :deep(.ui-field__label) {
  font-size: 0.75rem;
  line-height: 1.25;
}

.form-grid--cols-4 :deep(.ui-field__input) {
  padding: 0.5rem 0.6rem;
  font-size: 0.8125rem;
}

@media (max-width: 1200px) {
  .form-grid--cols-4 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .form-grid--cols-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .form-grid--cols-2,
  .form-grid--cols-4 {
    grid-template-columns: 1fr;
  }
}
</style>
