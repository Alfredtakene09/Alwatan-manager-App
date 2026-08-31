<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RefreshCw, Save, Shield } from '@lucide/vue'
import api from '@/api/client'
import {
  ROLE_LABELS,
  type AppUserRole,
} from '@/lib/roles'
import {
  UI_ACTIONS,
  UI_ACTION_GROUPS,
  UI_ACTION_TARGET_ROLES,
  actionAppliesToRole,
  type HiddenByRole,
  type UiActionTargetRole,
} from '@/lib/ui-actions'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import { useAppI18n } from '@/i18n/useAppI18n'

const { uiText } = useAppI18n()

const selectedRole = ref<UiActionTargetRole>('GESTIONNAIRE')
const hiddenByRole = ref<HiddenByRole>({})
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')

const groupedActions = computed(() =>
  UI_ACTION_GROUPS.map((group) => ({
    ...group,
    actions: UI_ACTIONS.filter(
      (action) => action.group === group.id && actionAppliesToRole(action, selectedRole.value),
    ),
  })).filter((group) => group.actions.length > 0),
)

function isWideGroup(actionCount: number) {
  return actionCount >= 5
}

function isVisible(actionId: string) {
  return !(hiddenByRole.value[selectedRole.value] ?? []).includes(actionId)
}

function setVisible(actionId: string, visible: boolean) {
  const current = new Set(hiddenByRole.value[selectedRole.value] ?? [])
  if (visible) current.delete(actionId)
  else current.add(actionId)
  hiddenByRole.value = {
    ...hiddenByRole.value,
    [selectedRole.value]: [...current],
  }
}

async function load() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<{ hiddenByRole?: HiddenByRole }>('/admin/ui-permissions')
    hiddenByRole.value = data.hiddenByRole ?? {}
  } catch {
    messageType.value = 'error'
    message.value = 'Impossible de charger les permissions des boutons.'
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  message.value = ''
  try {
    const { data } = await api.put<{ hiddenByRole?: HiddenByRole }>('/admin/ui-permissions', {
      hiddenByRole: hiddenByRole.value,
    })
    hiddenByRole.value = data.hiddenByRole ?? hiddenByRole.value
    messageType.value = 'success'
    message.value =
      'Permissions enregistrées. Les comptes concernés les verront à la prochaine connexion ou actualisation.'
  } catch {
    messageType.value = 'error'
    message.value = 'Impossible d’enregistrer les permissions des boutons.'
  } finally {
    saving.value = false
  }
}

onMounted(load)

defineExpose({ load, save, loading, saving })
</script>

<template>
  <div class="ui-perm">
    <UiAlert v-if="message" :type="messageType" :message="message" />

    <div class="ui-perm__toolbar">
      <label class="ui-perm__role">
        <span>{{ uiText('Type d’utilisateur') }}</span>
        <select v-model="selectedRole" :aria-label="uiText('Type d’utilisateur')">
          <option v-for="role in UI_ACTION_TARGET_ROLES" :key="role" :value="role">
            {{ uiText(ROLE_LABELS[role as AppUserRole]) }}
          </option>
        </select>
      </label>
      <div class="ui-perm__actions">
        <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading || saving" @click="load">
          Actualiser
        </UiButton>
        <UiButton variant="primary" size="sm" :icon="Save" :disabled="loading || saving" :loading="saving" @click="save">
          Enregistrer
        </UiButton>
      </div>
    </div>

    <p v-if="loading" class="ui-perm__empty">{{ uiText('Chargement…') }}</p>

    <div v-else class="ui-perm__groups">
      <section
        v-for="group in groupedActions"
        :key="group.id"
        class="ui-perm__group"
        :class="{ 'ui-perm__group--wide': isWideGroup(group.actions.length) }"
      >
        <header class="ui-perm__group-head">
          <h3 class="ui-perm__group-title">
            <Shield :size="14" />
            {{ uiText(group.label) }}
          </h3>
          <span class="ui-perm__group-count">{{ group.actions.length }}</span>
        </header>
        <ul class="ui-perm__list">
          <li v-for="action in group.actions" :key="action.id">
            <label class="ui-perm__item">
              <input
                type="checkbox"
                :checked="isVisible(action.id)"
                @change="setVisible(action.id, ($event.target as HTMLInputElement).checked)"
              />
              <span class="ui-perm__item-text">
                <strong>{{ uiText(action.label) }}</strong>
                <small v-if="action.hint">{{ uiText(action.hint) }}</small>
              </span>
            </label>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ui-perm {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
}

.ui-perm__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: flex-end;
  justify-content: space-between;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid var(--border);
}

.ui-perm__role {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 14rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
}

.ui-perm__role select {
  padding: 0.5rem 0.75rem;
  border: 1px solid rgba(27, 79, 156, 0.18);
  border-radius: 10px;
  background: #fff;
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text);
}

.ui-perm__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.ui-perm__empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.ui-perm__groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
  align-items: start;
}

.ui-perm__group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  border: 1px solid rgba(27, 79, 156, 0.12);
  border-radius: 12px;
  padding: 0;
  background: rgba(248, 250, 252, 0.85);
  overflow: hidden;
  min-width: 0;
}

.ui-perm__group--wide {
  grid-column: 1 / -1;
}

.ui-perm__group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.55rem 0.75rem;
  background: rgba(255, 255, 255, 0.92);
  border-bottom: 1px solid rgba(27, 79, 156, 0.08);
}

.ui-perm__group-title {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
  font-size: 0.78rem;
  font-weight: 800;
  color: var(--primary-800, #2d3319);
  letter-spacing: 0.01em;
}

.ui-perm__group-count {
  flex-shrink: 0;
  min-width: 1.35rem;
  height: 1.35rem;
  padding: 0 0.35rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(27, 79, 156, 0.08);
  color: var(--text-muted);
  font-size: 0.6875rem;
  font-weight: 800;
}

.ui-perm__list {
  list-style: none;
  margin: 0;
  padding: 0.35rem 0.45rem 0.5rem;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.2rem;
}

.ui-perm__group--wide .ui-perm__list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.2rem 0.55rem;
}

.ui-perm__item {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.45rem 0.5rem;
  cursor: pointer;
  font-size: 0.8125rem;
  min-width: 0;
  border-radius: 8px;
  transition: background 0.15s ease;
}

.ui-perm__item:hover {
  background: rgba(255, 255, 255, 0.95);
}

.ui-perm__item input {
  margin-top: 0.18rem;
  flex-shrink: 0;
  width: 1rem;
  height: 1rem;
}

.ui-perm__item-text {
  min-width: 0;
}

.ui-perm__item strong {
  display: block;
  font-weight: 650;
  line-height: 1.35;
  color: var(--text);
}

.ui-perm__item small {
  display: block;
  margin-top: 0.12rem;
  color: var(--text-muted);
  font-size: 0.72rem;
  line-height: 1.35;
}

@media (min-width: 1280px) {
  .ui-perm__group--wide .ui-perm__list {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 960px) {
  .ui-perm__groups {
    grid-template-columns: 1fr;
  }

  .ui-perm__group--wide {
    grid-column: auto;
  }

  .ui-perm__group--wide .ui-perm__list {
    grid-template-columns: 1fr;
  }
}
</style>
