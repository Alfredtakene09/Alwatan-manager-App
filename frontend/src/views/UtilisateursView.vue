<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import axios from 'axios'
import { confirmAppModal } from '@/lib/api-modal-helper'
import { Users, Plus, RefreshCw, Save } from '@lucide/vue'
import api from '@/api/client'
import {
  fullName,
  MANAGEABLE_USER_ROLES,
  ROLE_LABELS,
  type ManageableUserRole,
} from '@/lib/roles'
import { employeeNeedsAppAccount } from '@/lib/employee-app-account'
import { catalogRowActionsHtml, statusBadge } from '@/lib/datatable-defaults'
import { ALL_SHIFT_SLOTS, shiftButtonLabel, type ShiftSlot } from '@/lib/cash-shift'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

type LinkedEmployee = {
  id: string
  firstName: string
  lastName: string
  jobTitle?: string | null
  isMedecin: boolean
}

type EmployeeOption = LinkedEmployee & {
  hasUserAccount?: boolean
}

type PlatformUser = {
  id: string
  username: string
  email: string
  firstName: string
  lastName: string
  role: ManageableUserRole
  active: boolean
  employeeId: string
  cashShiftSlot?: ShiftSlot | null
  employee: LinkedEmployee
  createdAt: string
  canDelete?: boolean
  relatedDataCount?: number
}

type RoleFilter = 'ALL' | ManageableUserRole

const users = ref<PlatformUser[]>([])
const employeeOptions = ref<EmployeeOption[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const roleFilter = ref<RoleFilter>('ALL')
const modalOpen = ref(false)
const editingId = ref<string | null>(null)

const form = ref({
  employeeId: '',
  username: '',
  email: '',
  role: 'MEDECIN' as ManageableUserRole,
  password: '',
  cashShiftSlot: '' as '' | ShiftSlot,
})

const isReceptionRole = computed(() => form.value.role === 'RECEPTIONNISTE')

const usersById = computed(() => new Map(users.value.map((user) => [user.id, user])))

const selectedEmployee = computed(() =>
  employeeOptions.value.find((employee) => employee.id === form.value.employeeId),
)

const roleTabs: { value: RoleFilter; label: string }[] = [
  { value: 'ALL', label: 'Tous' },
  ...MANAGEABLE_USER_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
]

const tableRows = computed(() =>
  users.value.map((user) => ({
    id: user.id,
    name: fullName(user.firstName, user.lastName),
    username: user.username,
    email: user.email,
    employeeLabel: fullName(user.employee.firstName, user.employee.lastName),
    roleLabel: ROLE_LABELS[user.role],
    role: user.role,
    shiftLabel:
      user.role === 'RECEPTIONNISTE' && user.cashShiftSlot
        ? shiftButtonLabel(user.cashShiftSlot)
        : '—',
    statusLabel: user.active ? 'Actif' : 'Inactif',
    statusVariant: user.active ? 'success' : 'danger',
    toggleLabel: user.active ? 'Désactiver' : 'Activer',
    isActive: user.active,
    canDelete: user.canDelete ?? false,
    relatedDataCount: user.relatedDataCount ?? 0,
    createdAt: new Date(user.createdAt).toLocaleDateString('fr-FR'),
  })),
)

const columns = [
  {
    data: 'name',
    title: 'Nom',
    responsivePriority: 1,
    render: (name: string) => `<span class="dt-name">${name}</span>`,
  },
  { data: 'username', title: "Nom d'utilisateur", responsivePriority: 2 },
  { data: 'email', title: 'E-mail', responsivePriority: 3 },
  {
    data: 'employeeLabel',
    title: 'Employé lié',
    responsivePriority: 2,
    render: (label: string) => `<span class="dt-date">${label}</span>`,
  },
  {
    data: 'roleLabel',
    title: 'Rôle',
    responsivePriority: 3,
    render: (label: string) => statusBadge(label, 'info'),
  },
  {
    data: 'shiftLabel',
    title: 'Créneau',
    responsivePriority: 4,
    render: (label: string) =>
      label === '—' ? '<span class="dt-muted">—</span>' : `<span class="dt-date">${label}</span>`,
  },
  {
    data: 'statusLabel',
    title: 'Statut',
    responsivePriority: 4,
    render: (label: string, _t: string, row: { statusVariant: string }) =>
      statusBadge(label, row.statusVariant as 'success' | 'danger'),
  },
  { data: 'createdAt', title: 'Créé le', responsivePriority: 5 },
  {
    data: null,
    title: 'Actions',
    orderable: false,
    className: 'dt-actions-col dt-actions-col--catalog all',
    responsivePriority: 1,
    render: (
      _d: unknown,
      _t: string,
      row: { id: string; toggleLabel: string; isActive: boolean; canDelete: boolean },
    ) => catalogRowActionsHtml(row),
  },
]

function resetForm() {
  form.value = {
    employeeId: '',
    username: '',
    email: '',
    role: 'MEDECIN',
    password: '',
    cashShiftSlot: '',
  }
}

async function loadEmployeeOptions(currentEmployeeId?: string) {
  const { data } = await api.get<EmployeeOption[]>('/admin/employees', { params: { active: true } })
  employeeOptions.value = data.filter(
    (employee) =>
      employeeNeedsAppAccount(employee.jobTitle) &&
      (!employee.hasUserAccount || employee.id === currentEmployeeId),
  )
}

async function loadUsers() {
  loading.value = true
  message.value = ''
  try {
    const params = roleFilter.value === 'ALL' ? undefined : { role: roleFilter.value }
    const { data } = await api.get<PlatformUser[]>('/admin/users', { params })
    users.value = data
  } catch {
    users.value = []
    message.value =
      'Impossible de charger les utilisateurs. Vérifiez que le serveur backend est démarré et à jour, puis actualisez.'
    messageType.value = 'error'
  } finally {
    loading.value = false
  }
}

async function openCreateModal() {
  editingId.value = null
  resetForm()
  await loadEmployeeOptions()
  modalOpen.value = true
  message.value = ''
}

async function openEditModal(id: string) {
  const user = usersById.value.get(id)
  if (!user) return
  editingId.value = id
  await loadEmployeeOptions(user.employeeId)
  form.value = {
    employeeId: user.employeeId,
    username: user.username,
    email: user.email,
    role: user.role,
    password: '',
    cashShiftSlot: user.cashShiftSlot ?? '',
  }
  modalOpen.value = true
  message.value = ''
}

function closeModal() {
  modalOpen.value = false
  editingId.value = null
  resetForm()
}

async function saveUser() {
  if (!form.value.employeeId) {
    message.value = 'Sélectionnez un employé à lier au compte.'
    messageType.value = 'error'
    return
  }
  if (!form.value.username.trim()) {
    message.value = 'Renseignez le nom d\'utilisateur du compte.'
    messageType.value = 'error'
    return
  }
  if (form.value.role === 'MEDECIN' && selectedEmployee.value && !selectedEmployee.value.isMedecin) {
    message.value = 'Un compte médecin doit être lié à un employé médecin.'
    messageType.value = 'error'
    return
  }
  if (!editingId.value && form.value.password.length < 6) {
    message.value = 'Le mot de passe doit contenir au moins 6 caractères.'
    messageType.value = 'error'
    return
  }
  if (form.value.role === 'RECEPTIONNISTE' && !form.value.cashShiftSlot) {
    message.value = 'Sélectionnez le créneau caisse du réceptionniste (matin, soir ou nuit).'
    messageType.value = 'error'
    return
  }

  saving.value = true
  message.value = ''
  try {
    const cashShiftSlot =
      form.value.role === 'RECEPTIONNISTE' ? form.value.cashShiftSlot || null : null
    if (editingId.value) {
      const payload: Record<string, string | null | undefined> = {
        username: form.value.username.trim(),
        email: form.value.email.trim() || undefined,
        role: form.value.role,
        employeeId: form.value.employeeId,
        cashShiftSlot,
      }
      if (form.value.password.trim()) payload.password = form.value.password
      await api.put(`/admin/users/${editingId.value}`, payload)
      message.value = 'Utilisateur mis à jour.'
    } else {
      await api.post('/admin/users', {
        username: form.value.username.trim(),
        email: form.value.email.trim() || undefined,
        role: form.value.role,
        password: form.value.password,
        employeeId: form.value.employeeId,
        cashShiftSlot,
      })
      message.value = 'Utilisateur créé avec succès.'
    }
    messageType.value = 'success'
    closeModal()
    await loadUsers()
  } catch (error: unknown) {
    const apiMessage =
      axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
        ? error.response.data.error
        : null
    message.value =
      apiMessage ??
      (editingId.value
        ? 'Impossible de mettre à jour cet utilisateur.'
        : 'Impossible de créer cet utilisateur (nom d\'utilisateur ou employé déjà utilisé).')
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

async function toggleUser(id: string) {
  const user = usersById.value.get(id)
  if (!user) return
  try {
    await api.put(`/admin/users/${id}`, { active: !user.active })
    message.value = user.active ? 'Compte désactivé.' : 'Compte réactivé.'
    messageType.value = 'success'
    await loadUsers()
  } catch {
    message.value = 'Action impossible sur ce compte.'
    messageType.value = 'error'
  }
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === 'string') {
    return error.response.data.error
  }
  return fallback
}

async function deleteUser(id: string) {
  const user = usersById.value.get(id)
  if (!user) return

  if (!user.canDelete) {
    const linked = user.relatedDataCount ?? 0
    if (linked > 0) {
      const suffix = linked > 1 ? 'enregistrements liés' : 'enregistrement lié'
      message.value = `Suppression impossible : ce compte a ${linked} ${suffix}. Désactivez-le plutôt.`
    } else {
      message.value = 'Vous ne pouvez pas supprimer ce compte.'
    }
    messageType.value = 'error'
    return
  }

  const label = fullName(user.firstName, user.lastName)
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer le compte',
    message: `Supprimer définitivement le compte de ${label} (${user.email}) ? L'employé lié sera conservé. Cette action est irréversible.`,
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return

  try {
    const { data } = await api.delete<{ message?: string }>(`/admin/users/${id}`)
    message.value = data.message ?? 'Compte supprimé.'
    messageType.value = 'success'
    await loadUsers()
  } catch (error) {
    message.value = apiErrorMessage(error, 'Suppression impossible.')
    messageType.value = 'error'
  }
}

function onTableAction({ action, id }: { action: string; id: string }) {
  if (action === 'edit') openEditModal(id)
  if (action === 'toggle') toggleUser(id)
  if (action === 'delete') deleteUser(id)
}

function setRoleFilter(value: RoleFilter) {
  roleFilter.value = value
  loadUsers()
}

watch(
  () => form.value.role,
  () => {
    if (
      form.value.role === 'MEDECIN' &&
      selectedEmployee.value &&
      !selectedEmployee.value.isMedecin
    ) {
      form.value.employeeId = ''
    }
  },
)

onMounted(loadUsers)
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Utilisateurs"
        subtitle="Comptes d'accès — les soignants restent dans le registre sans compte"
        :icon="Users"
      />

      <UiAlert v-if="message && !modalOpen" :type="messageType" :message="message" />
    </section>

    <section class="page-with-table__body">
      <UiCard
        title="Comptes utilisateurs"
        description="Créez d'abord l'employé dans Employés, puis liez-le ici pour lui ouvrir un accès"
        class="ui-card--table-panel"
        :icon="Users"
        icon-variant="violet"
      >
        <template #actions>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadUsers">
            Actualiser
          </UiButton>
          <UiButton variant="primary" size="sm" :icon="Plus" @click="openCreateModal">
            Nouvel utilisateur
          </UiButton>
        </template>

        <div class="tabs">
          <button
            v-for="tab in roleTabs"
            :key="tab.value"
            type="button"
            :class="{ active: roleFilter === tab.value }"
            @click="setRoleFilter(tab.value)"
          >
            {{ tab.label }}
          </button>
        </div>

        <p v-if="!loading && !users.length" class="empty">Aucun utilisateur pour ce filtre</p>
        <UiDataTable
          v-else
          fill
          table-key="admin-users"
          compact
          :data="tableRows"
          :columns="columns"
          :loading="loading"
          loading-label="Chargement des utilisateurs…"
          @action="onTableAction"
        />
      </UiCard>
    </section>

    <UiFormModal
      v-if="modalOpen"
      title-id="user-modal-title"
      :title="editingId ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'"
      subtitle="Lier un employé existant à un compte de connexion"
      :icon="Users"
      @close="closeModal"
    >
      <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />

      <section class="form-panel">
        <UiSelect v-model="form.employeeId" label="Employé lié" required>
          <option value="" disabled>Sélectionner un employé</option>
          <option
            v-for="employee in employeeOptions"
            :key="employee.id"
            :value="employee.id"
            :disabled="form.role === 'MEDECIN' && !employee.isMedecin"
          >
            {{ fullName(employee.firstName, employee.lastName) }}
            {{ employee.jobTitle ? ` — ${employee.jobTitle}` : '' }}
            {{ employee.isMedecin ? ' (médecin)' : '' }}
          </option>
        </UiSelect>

        <p v-if="selectedEmployee" class="employee-preview">
          Nom sur le compte :
          <strong>{{ fullName(selectedEmployee.firstName, selectedEmployee.lastName) }}</strong>
        </p>
        <p v-else-if="!employeeOptions.length" class="employee-hint">
          Aucun employé disponible. Créez d'abord un employé sans compte dans la section Employés.
        </p>

        <UiInput
          v-model="form.username"
          label="Nom d'utilisateur"
          type="text"
          autocomplete="username"
          required
          placeholder="p.ex. reception"
        />
        <UiInput
          v-model="form.email"
          label="E-mail (optionnel)"
          type="email"
          placeholder="contact@exemple.com"
        />
        <UiSelect v-model="form.role" label="Rôle application" required>
          <option v-for="role in MANAGEABLE_USER_ROLES" :key="role" :value="role">
            {{ ROLE_LABELS[role] }}
          </option>
        </UiSelect>
        <UiSelect
          v-if="isReceptionRole"
          v-model="form.cashShiftSlot"
          label="Créneau caisse"
          required
        >
          <option value="" disabled>Sélectionner le créneau</option>
          <option v-for="slot in ALL_SHIFT_SLOTS" :key="slot" :value="slot">
            {{ shiftButtonLabel(slot) }}
          </option>
        </UiSelect>
        <p v-if="isReceptionRole" class="employee-preview">
          Créneaux : matin 7h–14h · soir 16h–21h · nuit 21h–6h.
        </p>
        <UiInput
          v-model="form.password"
          :label="editingId ? 'Nouveau mot de passe (optionnel)' : 'Mot de passe'"
          type="password"
          :required="!editingId"
          placeholder="Minimum 6 caractères"
        />
      </section>

      <template #footer>
        <UiButton variant="ghost" @click="closeModal">Annuler</UiButton>
        <UiButton variant="primary" :icon="Save" :disabled="saving" @click="saveUser">
          {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.tabs button {
  padding: 0.45rem 0.85rem;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  cursor: pointer;
  font-weight: 600;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.tabs button.active {
  background: var(--primary-50);
  border-color: var(--primary-500);
  color: var(--primary-800);
}

.empty,
.employee-hint {
  text-align: center;
  color: var(--text-light);
  padding: 2rem 1rem;
  font-size: 0.875rem;
}

.employee-preview {
  margin: 0 0 1rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}
</style>
