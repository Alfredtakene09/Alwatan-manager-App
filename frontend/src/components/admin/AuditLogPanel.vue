<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import axios from 'axios'
import { ChevronLeft, ChevronRight, Eye } from '@lucide/vue'
import api from '@/api/client'
import { ROLE_LABELS, type AppUserRole } from '@/lib/roles'
import { formatPatientTableDate } from '@/lib/patient-datatable-columns'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import '@/assets/simple-table.css'

type AuditUserOption = { id: string; firstName: string; lastName: string }

type AuditEntry = {
  id: string
  createdAt: string
  userId: string | null
  userName: string
  userRole: AppUserRole | null
  username: string | null
  action: string
  actionLabel: string
  entity: string
  moduleLabel: string
  entityId: string | null
  method: string | null
  path: string | null
  status: number | null
  success: boolean
  ip: string | null
  durationMs: number | null
  details: unknown
}

type AuditResponse = {
  items: AuditEntry[]
  total: number
  page: number
  pageSize: number
  retentionMonths: number
  modules: Array<{ id: string; label: string }>
}

const props = defineProps<{ users: AuditUserOption[] }>()

const { uiText, localeCode } = useAppI18n()

function localIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const today = new Date()
const weekAgo = new Date(today)
weekAgo.setDate(weekAgo.getDate() - 6)

const dateFrom = ref(localIsoDate(weekAgo))
const dateTo = ref(localIsoDate(today))
const userId = ref('')
const actionFilter = ref('')
const moduleFilter = ref('')
const page = ref(1)
const pageSize = 100

const items = ref<AuditEntry[]>([])
const total = ref(0)
const retentionMonths = ref(2)
const modules = ref<Array<{ id: string; label: string }>>([])
const loading = ref(false)
const message = ref('')
const selected = ref<AuditEntry | null>(null)
let loadRequest = 0

const sortedUsers = computed(() =>
  [...props.users].sort((a, b) =>
    `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'fr'),
  ),
)

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const rangeLabel = computed(() => {
  void localeCode.value
  if (!total.value) return uiText('Aucune entrée')
  const start = (page.value - 1) * pageSize + 1
  const end = Math.min(total.value, page.value * pageSize)
  return translateTemplate('{start}–{end} sur {total}', { start, end, total: total.value })
})

const actionOptions = computed(() => {
  void localeCode.value
  return [
    { id: '', label: uiText('Toutes les actions') },
    { id: 'CREATE', label: uiText('Créations') },
    { id: 'UPDATE', label: uiText('Modifications') },
    { id: 'DELETE', label: uiText('Suppressions') },
    { id: 'AUTH', label: uiText('Connexions / déconnexions') },
  ]
})

function actionTone(entry: AuditEntry) {
  if (!entry.success || entry.action === 'LOGIN_FAILED') return 'danger'
  if (entry.action === 'DELETE') return 'danger'
  if (entry.action === 'CREATE') return 'success'
  if (entry.action === 'UPDATE') return 'warning'
  if (entry.action === 'LOGIN' || entry.action === 'LOGOUT') return 'info'
  return 'neutral'
}

function roleLabel(role: AppUserRole | null) {
  return role ? uiText(ROLE_LABELS[role] ?? role) : ''
}

function formatDateTime(iso: string) {
  const date = new Date(iso)
  return `${formatPatientTableDate(iso)} ${date.toLocaleTimeString(localeCode.value, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })}`
}

function detailsText(value: unknown) {
  if (value == null) return ''
  return JSON.stringify(value, null, 2)
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
    const { data } = await api.get<AuditResponse>('/audit-logs', {
      params: {
        from: dateFrom.value || undefined,
        to: dateTo.value || undefined,
        userId: userId.value || undefined,
        action: actionFilter.value || undefined,
        entity: moduleFilter.value || undefined,
        page: page.value,
        pageSize,
      },
    })
    if (request !== loadRequest) return
    items.value = data.items
    total.value = data.total
    retentionMonths.value = data.retentionMonths
    modules.value = data.modules
  } catch (error: unknown) {
    if (request !== loadRequest) return
    const apiMessage = axios.isAxiosError(error) ? error.response?.data?.error : null
    message.value = typeof apiMessage === 'string' ? apiMessage : uiText("Impossible de charger le journal d'audit.")
    items.value = []
    total.value = 0
  } finally {
    if (request === loadRequest) loading.value = false
  }
}

function goToPage(next: number) {
  page.value = Math.min(pageCount.value, Math.max(1, next))
}

watch([dateFrom, dateTo, userId, actionFilter, moduleFilter], () => {
  if (page.value !== 1) page.value = 1
  else void loadEntries()
})
watch(page, () => void loadEntries())

onMounted(() => {
  void loadEntries()
})
</script>

<template>
  <div class="audit-panel">
    <div class="audit-toolbar">
      <UiInput v-model="dateFrom" label="Du" type="date" class="audit-field" />
      <UiInput v-model="dateTo" label="Au" type="date" class="audit-field" />
      <UiSelect v-model="userId" label="Utilisateur" class="audit-field audit-field--wide">
        <option value="">{{ uiText('Tous les utilisateurs') }}</option>
        <option v-for="u in sortedUsers" :key="u.id" :value="u.id">{{ u.firstName }} {{ u.lastName }}</option>
      </UiSelect>
      <UiSelect v-model="actionFilter" label="Action" class="audit-field">
        <option v-for="option in actionOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
      </UiSelect>
      <UiSelect v-model="moduleFilter" label="Module" class="audit-field">
        <option value="">{{ uiText('Tous les modules') }}</option>
        <option v-for="m in modules" :key="m.id" :value="m.id">{{ uiText(m.label) }}</option>
      </UiSelect>
    </div>

    <p class="audit-hint">
      {{
        translateTemplate(
          'Toutes les créations, modifications, suppressions et connexions. Les entrées de plus de {n} mois sont supprimées automatiquement.',
          { n: retentionMonths },
        )
      }}
    </p>

    <UiAlert v-if="message" type="error" :message="message" />

    <p v-if="!loading && !items.length" class="audit-empty">{{ uiText('Aucune action sur cette période.') }}</p>
    <div v-else class="simple-table-shell simple-table-shell--fill">
      <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
        <span class="simple-table-spinner" aria-hidden="true" />
        {{ uiText('Chargement du journal…') }}
      </div>
      <div class="simple-table-scroll">
        <div class="simple-table-wrap">
          <table class="simple-table">
            <thead>
              <tr>
                <th>{{ uiText('Date et heure') }}</th>
                <th>{{ uiText('Utilisateur') }}</th>
                <th>{{ uiText('Action') }}</th>
                <th>{{ uiText('Module') }}</th>
                <th>{{ uiText('Détail') }}</th>
                <th>{{ uiText('Adresse IP') }}</th>
                <th class="simple-table__actions-head">{{ uiText('Voir') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in items" :key="entry.id">
                <td><span class="st-date">{{ formatDateTime(entry.createdAt) }}</span></td>
                <td>
                  <span class="st-name">{{ entry.userName }}</span>
                  <small v-if="entry.userRole" class="audit-sub">{{ roleLabel(entry.userRole) }}</small>
                </td>
                <td>
                  <span class="audit-badge" :class="`audit-badge--${actionTone(entry)}`">
                    {{ uiText(entry.actionLabel) }}
                  </span>
                </td>
                <td>{{ uiText(entry.moduleLabel) }}</td>
                <td class="audit-path">
                  <template v-if="entry.path">
                    <code>{{ entry.method }} {{ entry.path }}</code>
                    <small class="audit-sub" :class="{ 'audit-sub--error': !entry.success }">
                      {{ entry.success ? uiText('Réussi') : translateTemplate('Échec ({status})', { status: entry.status ?? '' }) }}
                    </small>
                  </template>
                  <span v-else>{{ entry.entityId ?? '—' }}</span>
                </td>
                <td>{{ entry.ip ?? '—' }}</td>
                <td class="simple-table__actions">
                  <div class="st-actions">
                    <button
                      type="button"
                      class="st-btn st-btn--soft"
                      :title="uiText('Détail')"
                      :aria-label="uiText('Détail')"
                      @click="selected = entry"
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

    <div class="audit-pagination">
      <span>{{ rangeLabel }}</span>
      <UiButton variant="ghost" size="sm" :icon="ChevronLeft" :disabled="loading || page <= 1" @click="goToPage(page - 1)">
        {{ uiText('Précédent') }}
      </UiButton>
      <span>{{ translateTemplate('Page {page} / {count}', { page, count: pageCount }) }}</span>
      <UiButton
        variant="ghost"
        size="sm"
        :icon="ChevronRight"
        :disabled="loading || page >= pageCount"
        @click="goToPage(page + 1)"
      >
        {{ uiText('Suivant') }}
      </UiButton>
    </div>
  </div>

  <UiFormModal
    v-if="selected"
    title="Détail de l'action"
    :subtitle="`${selected.userName} — ${formatDateTime(selected.createdAt)}`"
    size="large"
    @close="selected = null"
  >
    <dl class="audit-detail">
      <dt>{{ uiText('Utilisateur') }}</dt>
      <dd>
        {{ selected.userName }}
        <template v-if="selected.username"> ({{ selected.username }})</template>
        <template v-if="selected.userRole"> · {{ roleLabel(selected.userRole) }}</template>
      </dd>
      <dt>{{ uiText('Action') }}</dt>
      <dd>{{ uiText(selected.actionLabel) }} — {{ uiText(selected.moduleLabel) }}</dd>
      <template v-if="selected.path">
        <dt>{{ uiText('Requête') }}</dt>
        <dd><code>{{ selected.method }} {{ selected.path }}</code></dd>
        <dt>{{ uiText('Résultat') }}</dt>
        <dd>
          {{ selected.success ? uiText('Réussi') : uiText('Échec') }} ({{ selected.status }})
          <template v-if="selected.durationMs != null"> · {{ selected.durationMs }} ms</template>
        </dd>
      </template>
      <template v-if="selected.entityId">
        <dt>{{ uiText('Élément concerné') }}</dt>
        <dd><code>{{ selected.entityId }}</code></dd>
      </template>
      <dt>{{ uiText('Adresse IP') }}</dt>
      <dd>{{ selected.ip ?? '—' }}</dd>
    </dl>
    <h4 class="audit-detail__title">{{ uiText('Données envoyées') }}</h4>
    <pre v-if="detailsText(selected.details)" class="audit-detail__json">{{ detailsText(selected.details) }}</pre>
    <p v-else class="audit-sub">{{ uiText('Aucune donnée.') }}</p>
    <template #footer>
      <UiButton variant="ghost" @click="selected = null">{{ uiText('Fermer') }}</UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.audit-panel {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-height: 0;
  flex: 1 1 auto;
}

.audit-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.6rem;
}

.audit-toolbar :deep(.ui-field) {
  margin-bottom: 0;
}

.audit-field {
  min-width: 9rem;
}

.audit-field--wide {
  min-width: 13rem;
}

.audit-hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.audit-empty {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--text-light);
  font-size: 0.875rem;
}

.audit-sub {
  display: block;
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.audit-sub--error {
  color: #be123c;
}

.audit-path code {
  font-size: 0.75rem;
  word-break: break-all;
}

.audit-badge {
  display: inline-block;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
  white-space: nowrap;
}

.audit-badge--success { background: #dcfce7; color: #15803d; }
.audit-badge--warning { background: #fef3c7; color: #92400e; }
.audit-badge--danger { background: #ffe4e6; color: #be123c; }
.audit-badge--info { background: #e0f2fe; color: #0369a1; }
.audit-badge--neutral { background: #f1f5f9; color: #475569; }

.audit-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.6rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.audit-detail {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.35rem 1rem;
  margin: 0 0 1rem;
  font-size: 0.8125rem;
}

.audit-detail dt {
  font-weight: 650;
  color: var(--text-muted);
}

.audit-detail dd {
  margin: 0;
  word-break: break-word;
}

.audit-detail__title {
  margin: 0 0 0.4rem;
  font-size: 0.8125rem;
}

.audit-detail__json {
  max-height: 22rem;
  margin: 0;
  padding: 0.75rem;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-muted, #f8fafc);
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
