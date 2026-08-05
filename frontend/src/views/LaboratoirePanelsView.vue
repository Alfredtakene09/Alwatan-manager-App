<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Eye, FlaskConical, Plus, RefreshCw, Save, Trash2 } from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal } from '@/lib/api-modal-helper'
import { statusBadge, catalogRowActionsHtml } from '@/lib/datatable-defaults'
import { labFieldCommentKey, type LabFormPanel } from '@/lib/lab-form-panels'
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

type FieldForm = {
  /** Identifiant local stable pour le v-for (évite de perdre la saisie section/libellé). */
  uid: string
  key: string
  section: string
  label: string
  unit: string
  reference: string
  defaultValue: string
  hasComment: boolean
}

const labPanels = useLabPanelsStore()
const { uiText, numberText } = useAppI18n()
const panels = ref<LabPanelDto[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')

const showModal = ref(false)
const editingId = ref<string | null>(null)
const showPreviewModal = ref(false)
const previewSource = ref<LabPanelDto | null>(null)
const previewFields = ref<LabPanelFieldDto[]>([])
const previewDirty = ref(false)
const previewSaving = ref(false)
const previewValues = reactive<Record<string, string>>({})

const previewPanel = computed<LabFormPanel | null>(() => {
  if (!previewSource.value) return null
  return panelDtoToFormPanel({ ...previewSource.value, fields: previewFields.value })
})

const form = ref<{ label: string; isEntry: boolean; active: boolean; fields: FieldForm[] }>({
  label: '',
  isEntry: true,
  active: true,
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
  panels.value.map((panel) => ({
    id: panel.id,
    label: uiText(panel.label),
    slug: panel.slug,
    fieldCount: panel.fields.length,
    statusLabel: uiText(panel.active ? 'Actif' : 'Inactif'),
    statusVariant: panel.active ? 'success' : 'danger',
    toggleLabel: panel.active ? 'Désactiver' : 'Activer',
    isActive: panel.active,
    showView: true,
  })),
)

function onTableClick(event: MouseEvent) {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]')
  if (!button?.dataset.action) return
  const row = button.closest<HTMLElement>('[data-id]')
  if (!row?.dataset.id) return
  onTableAction({ action: button.dataset.action, id: row.dataset.id })
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
    hasComment: false,
    ...partial,
  }
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
  form.value = { label: '', isEntry: true, active: true, fields: [emptyField()] }
  showModal.value = true
}

function openEdit(id: string) {
  const panel = panelsById.value.get(id)
  if (!panel) return
  editingId.value = id
  form.value = {
    label: panel.label,
    isEntry: panel.isEntry,
    active: panel.active,
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
  previewDirty.value = false
  Object.keys(previewValues).forEach((key) => delete previewValues[key])
  for (const field of previewFields.value) {
    previewValues[field.key] = field.defaultValue ?? ''
    if (field.hasComment) {
      previewValues[labFieldCommentKey(field.key)] = ''
    }
  }
  showPreviewModal.value = true
}

function removePreviewField(key: string) {
  previewFields.value = previewFields.value.filter((field) => field.key !== key)
  delete previewValues[key]
  delete previewValues[labFieldCommentKey(key)]
  previewDirty.value = true
}

async function savePreview() {
  if (!previewSource.value || !previewDirty.value) return

  previewSaving.value = true
  resetMessages()
  try {
    await api.put(`/lab-panels/${previewSource.value.id}`, {
      label: previewSource.value.label,
      isEntry: previewSource.value.isEntry,
      active: previewSource.value.active,
      fields: previewFields.value.map((field) => ({
        key: field.key,
        section: field.section?.trim() ? field.section.trim() : null,
        label: field.label,
        unit: field.unit ?? null,
        reference: field.reference ?? null,
        defaultValue: field.defaultValue ?? null,
        hasComment: field.hasComment === true,
        type: 'text',
      })),
    })
    message.value = previewFields.value.length
      ? 'Champs mis à jour.'
      : 'Formulaire vidé — ajoutez des champs plus tard.'
    messageType.value = 'success'
    previewDirty.value = false
    closePreview()
    await loadPanels()
    await labPanels.fetchPanels(true)
  } catch {
    message.value = 'Enregistrement impossible.'
    messageType.value = 'error'
  } finally {
    previewSaving.value = false
  }
}

function closePreview() {
  showPreviewModal.value = false
  previewSource.value = null
  previewFields.value = []
  previewDirty.value = false
}

async function save() {
  const label = form.value.label.trim()
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
      hasComment: field.hasComment === true,
      type: 'text',
    }))

  if (label.length < 2) {
    message.value = 'Le nom du formulaire est obligatoire.'
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
        fields,
      })
      message.value = fields.length
        ? 'Formulaire mis à jour.'
        : 'Formulaire mis à jour (aucun champ — à compléter plus tard).'
    } else {
      await api.post('/lab-panels', {
        label,
        isEntry: form.value.isEntry,
        fields,
      })
      message.value = fields.length
        ? 'Formulaire créé.'
        : 'Formulaire créé sans champ — ajoutez les résultats ensuite.'
    }
    messageType.value = 'success'
    closeModal()
    await loadPanels()
    await labPanels.fetchPanels(true)
  } catch {
    message.value = 'Enregistrement impossible. Vérifiez les champs.'
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
      description="Chaque formulaire regroupe les champs saisis par le laboratoire (avec unité et valeur de référence)"
      :icon="FlaskConical"
      icon-variant="teal"
      class="section"
    >
      <template #actions>
        <UiButton variant="primary" size="sm" :icon="Plus" @click="openCreate">
          Nouveau formulaire
        </UiButton>
        <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadPanels">
          Actualiser
        </UiButton>
        <span class="list-count">{{
          uiText('{n} formulaire(s)').replace('{n}', numberText(panels.length))
        }}</span>
      </template>

      <div class="panels-table-wrap">
        <div class="ui-dt-shell ui-dt-shell--static">
          <div class="ui-dt-scroll">
            <div class="ui-dt ui-dt--compact" @click="onTableClick">
              <div v-if="loading" class="ui-dt__overlay" role="status" aria-live="polite">
                <span class="ui-dt__spinner" />
                {{ uiText('Chargement des formulaires…') }}
              </div>

              <table class="dataTable stripe hover row-border ui-dt__table panels-table">
                <thead>
                  <tr>
                    <th class="dt-num-col">#</th>
                    <th>{{ uiText('Formulaire') }}</th>
                    <th>{{ uiText('Identifiant') }}</th>
                    <th>{{ uiText('Champs') }}</th>
                    <th>{{ uiText('Statut') }}</th>
                    <th class="dt-actions-col dt-actions-col--catalog">{{ uiText('Actions') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!loading && !tableRows.length">
                    <td colspan="6" class="panels-table-empty">{{ uiText('Aucun formulaire enregistré.') }}</td>
                  </tr>
                  <tr
                    v-for="(row, index) in tableRows"
                    v-else
                    :key="row.id"
                    :class="index % 2 === 0 ? 'odd' : 'even'"
                  >
                    <td class="dt-num-col">{{ numberText(index + 1) }}</td>
                    <td><span class="dt-name">{{ row.label }}</span></td>
                    <td><code class="panels-table-slug">{{ row.slug }}</code></td>
                    <td><span class="dt-amount">{{ numberText(row.fieldCount) }}</span></td>
                    <td v-html="statusBadge(row.statusLabel, row.statusVariant as 'success' | 'danger')" />
                    <td
                      class="dt-actions-col dt-actions-col--catalog"
                      v-html="catalogRowActionsHtml(row)"
                    />
                  </tr>
                </tbody>
              </table>
            </div>
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

        <p v-if="!form.fields.length" class="fields-empty">{{ uiText('Aucun champ pour l’instant — vous pouvez en ajouter maintenant ou plus tard.') }}</p>

        <div v-for="(field, index) in form.fields" :key="field.uid" class="field-block">
          <div class="field-row">
            <div class="field-row__grid">
              <UiInput v-model="field.label" label="Libellé" placeholder="Ex. Créatinine" />
              <UiInput v-model="field.section" label="Section (optionnel)" placeholder="Ex. Électrolytes" />
              <UiInput v-model="field.unit" label="Unité (optionnel)" placeholder="Ex. mg/dl" />
              <UiInput v-model="field.reference" label="Valeur de référence (optionnel)" placeholder="Ex. 0.6 - 1.1 mg/dl" />
              <UiInput v-model="field.defaultValue" label="Texte par défaut (optionnel)" placeholder="Ex. Normal" />
              <label class="field-comment-toggle">
                <input v-model="field.hasComment" type="checkbox" />
                <span>{{ uiText('Activer le commentaire (textarea) pour ce champ') }}</span>
              </label>
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
          Aperçu de la mise en page — le commentaire n'apparaît que pour les champs où il est activé.
          Survolez un champ et cliquez sur la corbeille pour le retirer.
        </p>

        <p v-if="!previewFields.length" class="fields-empty">
          Tous les champs ont été retirés — ajoutez-en via « Modifier ».
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
                <label v-if="field.hasComment" class="field-comment">
                  <span class="field-comment__label">{{ uiText('Commentaire') }}</span>
                  <textarea
                    v-model="previewValues[labFieldCommentKey(field.key)]"
                    rows="2"
                    :placeholder="uiText('Commentaire sur cette ligne…')"
                    readonly
                  />
                </label>
                <button
                  type="button"
                  class="preview-field__remove"
                  :title="uiText('Retirer ce champ')"
                  :aria-label="uiText('Retirer ce champ')"
                  @click="removePreviewField(field.key)"
                >
                  <Trash2 :size="14" />
                </button>
              </div>
            </template>
          </div>
        </div>
      </section>

      <template #footer>
        <UiButton variant="ghost" @click="closePreview">Fermer</UiButton>
        <UiButton
          variant="primary"
          :icon="Save"
          :disabled="!previewDirty || previewSaving"
          @click="savePreview"
        >
          {{ previewSaving ? 'Enregistrement…' : 'Enregistrer les modifications' }}
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.section {
  margin-top: 1rem;
}

.list-count {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
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

.field-comment-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0.1rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.field-comment-toggle input[type='checkbox'] {
  width: 0.95rem;
  height: 0.95rem;
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

.preview-field__remove {
  position: absolute;
  top: 0;
  right: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: #dc2626;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, border-color 0.15s;
}

.preview-field:hover .preview-field__remove,
.preview-field__remove:focus-visible {
  opacity: 1;
}

.preview-field__remove:hover {
  background: #fef2f2;
  border-color: #fca5a5;
}

.field-comment {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-top: 0.45rem;
}

.field-comment__label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
}

.field-comment textarea {
  width: 100%;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: 0.8125rem;
  resize: vertical;
  background: #f8fafc;
  color: var(--text-muted);
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
