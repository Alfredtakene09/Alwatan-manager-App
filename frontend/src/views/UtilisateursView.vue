<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import axios from 'axios'
import { confirmAppModal } from '@/lib/api-modal-helper'
import { Users, Plus, RefreshCw, Save, Eye } from '@lucide/vue'
import api from '@/api/client'
import {
  fullName,
  MANAGEABLE_USER_ROLES,
  ROLE_LABELS,
  type AppUserRole,
  type ManageableUserRole,
} from '@/lib/roles'
import { employeeNeedsAppAccount, isHiddenPlatformAdminEmployee } from '@/lib/employee-app-account'
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
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

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
  role: AppUserRole
  active: boolean
  employeeId: string
  cashShiftSlot?: ShiftSlot | null
  employee: LinkedEmployee
  createdAt: string
  canDelete?: boolean
  relatedDataCount?: number
}

const users = ref<PlatformUser[]>([])
const employeeOptions = ref<EmployeeOption[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const modalOpen = ref(false)
const viewModalOpen = ref(false)
const editingId = ref<string | null>(null)
const viewingUser = ref<PlatformUser | null>(null)

const form = ref({
  employeeId: '',
  username: '',
  email: '',
  role: 'RECEPTIONNISTE' as ManageableUserRole,
  password: '',
  passwordConfirm: '',
  cashShiftSlot: '' as '' | ShiftSlot,
})

const isReceptionRole = computed(() => form.value.role === 'RECEPTIONNISTE')

const { uiText, localeCode } = useAppI18n()

function roleLabel(role: AppUserRole) {
  return uiText(ROLE_LABELS[role] ?? role)
}

const usersById = computed(() => new Map(users.value.map((user) => [user.id, user])))

/** Employés vraiment sélectionnables selon le rôle (évite les options grisées). */
const selectableEmployees = computed(() => {
  const list =
    form.value.role === 'MEDECIN'
      ? employeeOptions.value.filter((employee) => employee.isMedecin)
      : employeeOptions.value
  return [...list].sort((a, b) =>
    fullName(a.firstName, a.lastName).localeCompare(fullName(b.firstName, b.lastName), 'fr', {
      sensitivity: 'base',
      numeric: true,
    }),
  )
})

const selectedEmployee = computed(() =>
  selectableEmployees.value.find((employee) => employee.id === form.value.employeeId),
)

const employeeEmptyHint = computed(() => {
  if (form.value.role === 'MEDECIN') {
    return uiText(
      'Aucun employé médecin disponible. Créez d’abord un employé coché « médecin » dans Employés.',
    )
  }
  if (!employeeOptions.value.length) {
    return uiText(
      'Aucun employé disponible. Créez d’abord un employé sans compte dans la section Employés.',
    )
  }
  return ''
})

const tableRows = computed(() => {
  localeCode.value
  return users.value.map((user) => ({
    id: user.id,
    name: fullName(user.firstName, user.lastName),
    username: user.username,
    email: user.email,
    employeeLabel: fullName(user.employee.firstName, user.employee.lastName),
    roleLabel: roleLabel(user.role),
    role: user.role,
    statusLabel: user.active ? uiText('Actif') : uiText('Inactif'),
    statusVariant: user.active ? 'success' : 'danger',
    toggleLabel: user.active ? uiText('Désactiver') : uiText('Activer'),
    isActive: user.active,
    canDelete: user.canDelete ?? false,
    relatedDataCount: user.relatedDataCount ?? 0,
  }))
})

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
    data: 'statusLabel',
    title: 'Statut',
    responsivePriority: 4,
    render: (label: string, _t: string, row: { statusVariant: string }) =>
      statusBadge(label, row.statusVariant as 'success' | 'danger'),
  },
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
    ) => catalogRowActionsHtml({ ...row, showView: true }),
  },
]

function resetForm() {
  form.value = {
    employeeId: '',
    username: '',
    email: '',
    role: 'RECEPTIONNISTE',
    password: '',
    passwordConfirm: '',
    cashShiftSlot: '',
  }
}

async function loadEmployeeOptions(currentEmployeeId?: string) {
  const { data } = await api.get<EmployeeOption[]>('/admin/employees', { params: { active: true } })
  employeeOptions.value = data.filter(
    (employee) =>
      !isHiddenPlatformAdminEmployee(employee) &&
      employeeNeedsAppAccount(employee.jobTitle) &&
      (!employee.hasUserAccount || employee.id === currentEmployeeId),
  )
}

async function loadUsers() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<PlatformUser[]>('/admin/users')
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
    role: (MANAGEABLE_USER_ROLES as readonly string[]).includes(user.role)
      ? (user.role as ManageableUserRole)
      : 'RECEPTIONNISTE',
    password: '',
    passwordConfirm: '',
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

function openViewModal(id: string) {
  viewingUser.value = usersById.value.get(id) ?? null
  if (!viewingUser.value) return
  viewModalOpen.value = true
}

function closeViewModal() {
  viewModalOpen.value = false
  viewingUser.value = null
}

function viewingUserShiftLabel(user: PlatformUser) {
  if (user.role === 'RECEPTIONNISTE' && user.cashShiftSlot) {
    return shiftButtonLabel(user.cashShiftSlot)
  }
  return '—'
}

function formatCreatedAt(value: string) {
  return new Date(value).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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
  if (!/^[a-zA-Z0-9._-]+$/.test(form.value.username.trim())) {
    message.value = 'Nom d\'utilisateur invalide. Caractères autorisés : lettres, chiffres, . _ -'
    messageType.value = 'error'
    return
  }
  const email = form.value.email.trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    message.value = 'Adresse e-mail invalide.'
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
  if (!editingId.value && form.value.password !== form.value.passwordConfirm) {
    message.value = 'La confirmation du mot de passe ne correspond pas.'
    messageType.value = 'error'
    return
  }
  if (editingId.value && form.value.password.trim() && form.value.password !== form.value.passwordConfirm) {
    message.value = 'La confirmation du mot de passe ne correspond pas.'
    messageType.value = 'error'
    return
  }
  if (editingId.value && form.value.password.trim() && form.value.password.length < 6) {
    message.value = 'Le nouveau mot de passe doit contenir au moins 6 caractères.'
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
        role: form.value.role,
        employeeId: form.value.employeeId,
        cashShiftSlot,
      }
      if (email) payload.email = email
      if (form.value.password.trim()) payload.password = form.value.password
      await api.put(`/admin/users/${editingId.value}`, payload)
      message.value = 'Utilisateur mis à jour.'
    } else {
      await api.post('/admin/users', {
        username: form.value.username.trim(),
        ...(email ? { email } : {}),
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
      const suffix = uiText(linked > 1 ? 'enregistrements liés' : 'enregistrement lié')
      message.value = translateTemplate(
        'Suppression impossible : ce compte a {n} {suffix}. Désactivez-le plutôt.',
        { n: linked, suffix },
      )
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
    message: translateTemplate(
      'Supprimer définitivement le compte de {name} ({email}) ? L\'employé lié sera conservé. Cette action est irréversible.',
      { name: label, email: user.email },
    ),
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
  if (action === 'view') openViewModal(id)
  if (action === 'edit') openEditModal(id)
  if (action === 'toggle') toggleUser(id)
  if (action === 'delete') deleteUser(id)
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

        <p v-if="!loading && !users.length" class="empty">Aucun utilisateur</p>
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
      size="wide"
      @close="closeModal"
    >
      <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />

      <section class="form-panel">
        <div class="form-grid-2">
          <UiSelect v-model="form.role" label="Rôle application" required>
            <option v-for="role in MANAGEABLE_USER_ROLES" :key="role" :value="role">
              {{ ROLE_LABELS[role] ? uiText(ROLE_LABELS[role]) : role }}
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
        </div>

        <p v-if="isReceptionRole" class="employee-preview">
          Créneaux : matin 7h–14h · soir 16h–21h · nuit 21h–6h.
        </p>

        <UiSelect v-model="form.employeeId" label="Employé lié" required>
          <option value="" disabled>Sélectionner un employé</option>
          <option
            v-for="employee in selectableEmployees"
            :key="employee.id"
            :value="employee.id"
          >
            {{ fullName(employee.firstName, employee.lastName) }}
            {{ employee.jobTitle ? ` — ${employee.jobTitle}` : '' }}
            {{ employee.isMedecin ? uiText(' (médecin)') : '' }}
          </option>
        </UiSelect>

        <p v-if="selectedEmployee" class="employee-preview">
          Nom sur le compte :
          <strong>{{ fullName(selectedEmployee.firstName, selectedEmployee.lastName) }}</strong>
        </p>
        <p v-else-if="employeeEmptyHint" class="employee-hint employee-hint--inline">
          {{ employeeEmptyHint }}
        </p>

        <div class="form-grid-2">
          <UiInput
            v-model="form.username"
            label="Nom d'utilisateur"
            type="text"
            autocomplete="username"
            required
            placeholder="p.ex. reception (lettres, chiffres, . _ -)"
          />
          <UiInput
            v-model="form.email"
            label="E-mail (optionnel)"
            type="email"
            placeholder="Laisser vide si aucun e-mail"
            autocomplete="off"
          />
        </div>

        <div class="form-grid-2">
          <UiInput
            v-model="form.password"
            :label="editingId ? 'Nouveau mot de passe (optionnel)' : 'Mot de passe'"
            type="password"
            :required="!editingId"
            revealable
            autocomplete="new-password"
            placeholder="Minimum 6 caractères"
          />
          <UiInput
            v-model="form.passwordConfirm"
            :label="editingId ? 'Confirmer le nouveau mot de passe' : 'Confirmer le mot de passe'"
            type="password"
            :required="!editingId"
            revealable
            autocomplete="new-password"
            placeholder="Retapez le mot de passe"
          />
        </div>
      </section>

      <template #footer>
        <UiButton variant="ghost" @click="closeModal">Annuler</UiButton>
        <UiButton variant="primary" :icon="Save" :disabled="saving" @click="saveUser">
          {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
        </UiButton>
      </template>
    </UiFormModal>

    <UiFormModal
      v-if="viewModalOpen && viewingUser"
      title-id="user-view-title"
      title="Détail de l'utilisateur"
      :subtitle="fullName(viewingUser.firstName, viewingUser.lastName)"
      :icon="Eye"
      @close="closeViewModal"
    >
      <dl class="user-detail">
        <div class="user-detail__row">
          <dt>Nom complet</dt>
          <dd>{{ fullName(viewingUser.firstName, viewingUser.lastName) }}</dd>
        </div>
        <div class="user-detail__row">
          <dt>Nom d'utilisateur</dt>
          <dd>{{ viewingUser.username }}</dd>
        </div>
        <div class="user-detail__row">
          <dt>E-mail</dt>
          <dd>{{ viewingUser.email || '—' }}</dd>
        </div>
        <div class="user-detail__row">
          <dt>Employé lié</dt>
          <dd>
            {{ fullName(viewingUser.employee.firstName, viewingUser.employee.lastName) }}
            <span v-if="viewingUser.employee.jobTitle" class="user-detail__muted">
              — {{ viewingUser.employee.jobTitle }}
            </span>
          </dd>
        </div>
        <div class="user-detail__row">
          <dt>Rôle</dt>
          <dd>{{ ROLE_LABELS[viewingUser.role] ? uiText(ROLE_LABELS[viewingUser.role]) : viewingUser.role }}</dd>
        </div>
        <div class="user-detail__row">
          <dt>Créneau caisse</dt>
          <dd>{{ viewingUserShiftLabel(viewingUser) }}</dd>
        </div>
        <div class="user-detail__row">
          <dt>Statut</dt>
          <dd>{{ viewingUser.active ? uiText('Actif') : uiText('Inactif') }}</dd>
        </div>
        <div class="user-detail__row">
          <dt>Créé le</dt>
          <dd>{{ formatCreatedAt(viewingUser.createdAt) }}</dd>
        </div>
        <div v-if="(viewingUser.relatedDataCount ?? 0) > 0" class="user-detail__row">
          <dt>Données liées</dt>
          <dd>{{ translateTemplate('{n} enregistrement(s)', { n: viewingUser.relatedDataCount ?? 0 }) }}</dd>
        </div>
      </dl>

      <template #footer>
        <UiButton variant="ghost" @click="closeViewModal">Fermer</UiButton>
        <UiButton variant="primary" @click="openEditModal(viewingUser.id); closeViewModal()">
          Modifier
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.empty,
.employee-hint {
  text-align: center;
  color: var(--text-light);
  padding: 2rem 1rem;
  font-size: 0.875rem;
}

.employee-hint--inline {
  text-align: left;
  padding: 0 0 1rem;
}

.employee-preview {
  margin: 0 0 1rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.user-detail {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0;
}

.user-detail__row {
  display: grid;
  grid-template-columns: 10rem 1fr;
  gap: 0.5rem 1rem;
  align-items: baseline;
}

.user-detail__row dt {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.user-detail__row dd {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--text);
}

.user-detail__muted {
  color: var(--text-muted);
  font-size: 0.875rem;
}
</style>
