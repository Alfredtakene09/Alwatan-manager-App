<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import axios from 'axios'
import { ArrowLeft, ChevronLeft, ChevronRight, Eye, RotateCcw, Trash2 } from '@lucide/vue'
import api from '@/api/client'
import { formatPatientTableDate } from '@/lib/patient-datatable-columns'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import { confirmAppModal, showApiErrorModal, showSuccessModal } from '@/lib/api-modal-helper'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import '@/assets/simple-table.css'

type Readable = {
  fields: Array<{ label: string; value: string }>
  groups: Array<{ label: string; columns: string[]; rows: string[][] }>
}

type TrashEntry = {
  batchId: string
  deletedAt: string
  actorName: string
  summary: string
  tableLabel: string
  title: string
  relatedCount: number
  restoredAt: string | null
  restoredByName: string | null
}

type TrashDetail = TrashEntry & {
  items: Array<{ id: string; isMain: boolean; tableLabel: string; title: string; readable: Readable }>
}

type TrashResponse = { items: TrashEntry[]; total: number; page: number; pageSize: number; retentionMonths: number }

const props = defineProps<{ initialBatchId?: string | null }>()
const emit = defineEmits<{ back: [] }>()

const { uiText, localeCode } = useAppI18n()

const dateFrom = ref('')
const dateTo = ref('')
const page = ref(1)
const pageSize = 50
const items = ref<TrashEntry[]>([])
const total = ref(0)
const retentionMonths = ref(2)
const loading = ref(false)
const message = ref('')
const selected = ref<TrashDetail | null>(null)
const restoring = ref(false)
let loadRequest = 0

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

function formatDateTime(iso: string) {
  const date = new Date(iso)
  return `${formatPatientTableDate(iso)} ${date.toLocaleTimeString(localeCode.value, {
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

async function loadEntries() {
  if (dateFrom.value && dateTo.value && dateFrom.value > dateTo.value) {
    message.value = uiText('La date de début doit précéder la date de fin.')
    return
  }
  const request = ++loadRequest
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<TrashResponse>('/trash', {
      params: { from: dateFrom.value || undefined, to: dateTo.value || undefined, page: page.value, pageSize },
    })
    if (request !== loadRequest) return
    items.value = data.items
    total.value = data.total
    retentionMonths.value = data.retentionMonths
  } catch (error: unknown) {
    if (request !== loadRequest) return
    const apiMessage = axios.isAxiosError(error) ? error.response?.data?.error : null
    message.value = typeof apiMessage === 'string' ? apiMessage : uiText('Impossible de charger la corbeille.')
    items.value = []
    total.value = 0
  } finally {
    if (request === loadRequest) loading.value = false
  }
}

async function openBatch(batchId: string) {
  try {
    const { data } = await api.get<TrashDetail>(`/trash/${batchId}`)
    selected.value = data
  } catch (error) {
    await showApiErrorModal(error, uiText('Impossible de charger cet élément.'))
  }
}

async function restore() {
  if (!selected.value) return
  const entry = selected.value
  const confirmed = await confirmAppModal({
    type: 'WARNING',
    title: uiText('Restaurer cet élément ?'),
    message: translateTemplate(
      '« {title} » et ses {n} élément(s) lié(s) seront remis dans l’application. Les effets de la suppression sur le stock, la caisse ou les totaux ne sont pas annulés automatiquement : vérifiez-les après la restauration.',
      { title: entry.title, n: entry.relatedCount },
    ),
    confirmLabel: uiText('Restaurer'),
    cancelLabel: uiText('Annuler'),
  })
  if (!confirmed) return
  restoring.value = true
  try {
    await api.post(`/trash/${entry.batchId}/restore`)
    selected.value = null
    await loadEntries()
    await showSuccessModal(uiText('Élément restauré'), translateTemplate('« {title} » est de nouveau dans l’application.', { title: entry.title }))
  } catch (error) {
    await showApiErrorModal(error, uiText('Restauration impossible.'))
  } finally {
    restoring.value = false
  }
}

function goToPage(next: number) {
  page.value = Math.min(pageCount.value, Math.max(1, next))
}

watch([dateFrom, dateTo], () => {
  if (page.value !== 1) page.value = 1
  else void loadEntries()
})
watch(page, () => void loadEntries())

onMounted(() => {
  void loadEntries()
  if (props.initialBatchId) void openBatch(props.initialBatchId)
})
</script>

<template>
  <div class="trash-panel">
    <div class="trash-toolbar">
      <UiButton variant="ghost" size="sm" :icon="ArrowLeft" @click="emit('back')">
        {{ uiText('Retour au journal') }}
      </UiButton>
      <h3 class="trash-title"><Trash2 :size="16" /> {{ uiText('Corbeille') }}</h3>
      <UiInput v-model="dateFrom" label="Du" type="date" class="trash-field" />
      <UiInput v-model="dateTo" label="Au" type="date" class="trash-field" />
    </div>

    <p class="trash-hint">
      {{
        translateTemplate(
          'Tout ce qui a été supprimé avec un bouton « Supprimer », avec les éléments supprimés en même temps. Les éléments sont gardés {n} mois, puis effacés définitivement.',
          { n: retentionMonths },
        )
      }}
    </p>

    <UiAlert v-if="message" type="error" :message="message" />

    <p v-if="!loading && !items.length" class="trash-empty">{{ uiText('La corbeille est vide.') }}</p>
    <div v-else class="simple-table-shell simple-table-shell--fill">
      <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
        <span class="simple-table-spinner" aria-hidden="true" />
        {{ uiText('Chargement…') }}
      </div>
      <div class="simple-table-scroll">
        <div class="simple-table-wrap">
          <table class="simple-table">
            <thead>
              <tr>
                <th>{{ uiText('Supprimé le') }}</th>
                <th>{{ uiText('Par') }}</th>
                <th>{{ uiText('Élément supprimé') }}</th>
                <th>{{ uiText('État') }}</th>
                <th class="simple-table__actions-head">{{ uiText('Voir') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in items" :key="entry.batchId">
                <td><span class="st-date">{{ formatDateTime(entry.deletedAt) }}</span></td>
                <td>{{ entry.actorName }}</td>
                <td>
                  <span class="st-name">{{ entry.title }}</span>
                  <small class="trash-sub">
                    {{ uiText(entry.tableLabel) }}
                    <template v-if="entry.relatedCount">
                      · {{ translateTemplate('+ {n} élément(s) lié(s)', { n: entry.relatedCount }) }}
                    </template>
                  </small>
                </td>
                <td>
                  <span v-if="entry.restoredAt" class="trash-badge trash-badge--restored">
                    {{ translateTemplate('Restauré le {date}', { date: formatDateTime(entry.restoredAt) }) }}
                  </span>
                  <span v-else class="trash-badge">{{ uiText('Dans la corbeille') }}</span>
                </td>
                <td class="simple-table__actions">
                  <div class="st-actions">
                    <button
                      type="button"
                      class="st-btn st-btn--soft"
                      :title="uiText('Voir')"
                      :aria-label="uiText('Voir')"
                      @click="openBatch(entry.batchId)"
                    >
                      <Eye :size="15" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="trash-pagination">
      <UiButton variant="ghost" size="sm" :icon="ChevronLeft" :disabled="loading || page <= 1" @click="goToPage(page - 1)">
        {{ uiText('Précédent') }}
      </UiButton>
      <span>{{ translateTemplate('Page {page} / {count}', { page, count: pageCount }) }}</span>
      <UiButton variant="ghost" size="sm" :icon="ChevronRight" :disabled="loading || page >= pageCount" @click="goToPage(page + 1)">
        {{ uiText('Suivant') }}
      </UiButton>
    </div>
  </div>

  <UiFormModal
    v-if="selected"
    :title="uiText('Élément supprimé')"
    :subtitle="selected.title"
    size="large"
    @close="selected = null"
  >
    <p class="trash-detail__summary">{{ uiText(selected.summary) }}</p>
    <dl class="trash-detail">
      <dt>{{ uiText('Supprimé par') }}</dt>
      <dd>{{ selected.actorName }}</dd>
      <dt>{{ uiText('Le') }}</dt>
      <dd>{{ formatDateTime(selected.deletedAt) }}</dd>
      <template v-if="selected.restoredAt">
        <dt>{{ uiText('Restauré') }}</dt>
        <dd>
          {{ formatDateTime(selected.restoredAt) }}
          <template v-if="selected.restoredByName"> · {{ selected.restoredByName }}</template>
        </dd>
      </template>
    </dl>

    <details
      v-for="item in selected.items"
      :key="item.id"
      class="trash-item"
      :open="item.isMain"
    >
      <summary>
        <strong>{{ item.title }}</strong>
        <small> · {{ uiText(item.tableLabel) }}</small>
      </summary>
      <dl v-if="item.readable.fields.length" class="trash-detail">
        <template v-for="field in item.readable.fields" :key="field.label">
          <dt>{{ uiText(field.label) }}</dt>
          <dd>{{ field.value }}</dd>
        </template>
      </dl>
      <div v-for="group in item.readable.groups" :key="group.label" class="trash-group">
        <h5>{{ group.label }}</h5>
        <table class="trash-table">
          <thead>
            <tr><th v-for="column in group.columns" :key="column">{{ uiText(column) }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in group.rows" :key="index">
              <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>

    <template #footer>
      <UiButton variant="ghost" @click="selected = null">{{ uiText('Fermer') }}</UiButton>
      <UiButton
        v-if="!selected.restoredAt"
        variant="primary"
        :icon="RotateCcw"
        :loading="restoring"
        :disabled="restoring"
        @click="restore"
      >
        {{ uiText('Restaurer') }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.trash-panel {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-height: 0;
  flex: 1 1 auto;
}

.trash-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.6rem;
}

.trash-toolbar :deep(.ui-field) {
  margin-bottom: 0;
}

.trash-title {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0 auto 0.35rem 0.25rem;
  font-size: 0.9375rem;
}

.trash-field {
  min-width: 9rem;
}

.trash-hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.trash-empty {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--text-light);
  font-size: 0.875rem;
}

.trash-sub {
  display: block;
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.trash-badge {
  display: inline-block;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
  white-space: nowrap;
  background: #ffe4e6;
  color: #be123c;
}

.trash-badge--restored {
  background: #dcfce7;
  color: #15803d;
}

.trash-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.6rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.trash-detail__summary {
  margin: 0 0 0.75rem;
  font-size: 1rem;
  font-weight: 700;
}

.trash-detail {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.35rem 1rem;
  margin: 0 0 0.9rem;
  font-size: 0.8125rem;
}

.trash-detail dt {
  font-weight: 650;
  color: var(--text-muted);
}

.trash-detail dd {
  margin: 0;
  word-break: break-word;
}

.trash-item {
  margin-bottom: 0.5rem;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.trash-item summary {
  margin-bottom: 0.4rem;
  cursor: pointer;
  font-size: 0.8125rem;
}

.trash-item summary small {
  color: var(--text-muted);
}

.trash-group h5 {
  margin: 0 0 0.3rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.trash-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}

.trash-table th,
.trash-table td {
  padding: 0.3rem 0.5rem;
  border-top: 1px solid var(--border);
  text-align: left;
}
</style>
