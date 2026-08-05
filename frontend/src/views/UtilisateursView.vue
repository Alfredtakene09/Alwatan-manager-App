<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import axios from 'axios'
import { confirmAppModal } from '@/lib/api-modal-helper'
import { Users, Plus, RefreshCw, Save, Eye, Search, Unlock } from '@lucide/vue'
import api from '@/api/client'
import {
  fullName,
  ADMIN_ASSIGNABLE_USER_ROLES,
  ROLE_LABELS,
  type AppUserRole,
  type AdminAssignableUserRole,
} from '@/lib/roles'
import { isHiddenPlatformAdminEmployee } from '@/lib/employee-app-account'
import { catalogRowActionsHtml, DT_ICONS, statusBadge } from '@/lib/datatable-defaults'
import { shiftButtonLabel, type ShiftSlot } from '@/lib/cash-shift'
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
import { useAuthStore } from '@/stores/auth'

type LinkedEmployee = {
  id: string
  firstName: string
  lastName: string
  jobTitle?: string | null
  isMedecin: boolean
}

type EmployeeOption = LinkedEmployee & {
  hasUserAccount?: boolean
  active?: boolean
}

type PlatformUser = {
  id: string
  username: string
  email: string
  firstName: string
  lastName: string
  role: AppUserRole
  active: boolean
  locked?: boolean
  lockedAt?: string | null
  failedLoginAttempts?: number
  employeeId: string
  cashShiftSlot?: ShiftSlot | null
  employee?: LinkedEmployee | null
  createdAt: string
  canDelete?: boolean
  relatedDataCount?: number
}

const auth = useAuthStore()
const isAdmin = computed(() => auth.user?.role === 'ADMIN')

const users = ref<PlatformUser[]>([])
const employeeOptions = ref<EmployeeOption[]>([])
const loading = ref(false)
const saving = ref(false)
const unlocking = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const modalOpen = ref(false)
const viewModalOpen = ref(false)
const unlockModalOpen = ref(false)
const editingId = ref<string | null>(null)
const viewingUser = ref<PlatformUser | null>(null)
const unlockingUser = ref<PlatformUser | null>(null)
const unlockPassword = ref('')
const unlockPasswordConfirm = ref('')
const employeeFilter = ref<'ALL' | 'MEDECINS'>('ALL')
const searchQuery = ref('')
const roleFilter = ref<'ALL' | AppUserRole>('ALL')

const form = ref({
  employeeId: '',
  username: '',
  email: '',
  role: 'RECEPTIONNISTE' as AdminAssignableUserRole,
  password: '',
  passwordConfirm: '',
  cashShiftSlot: '' as '' | ShiftSlot,
  /** String pour UiSelect (évite le faux conflit booléen / "true"). */
  active: 'true' as 'true' | 'false',
})
/** Employé lié au moment de l’ouverture de l’édition (filet de sécurité). */
const editingOriginalEmployeeId = ref<string | null>(null)

const { uiText, localeCode } = useAppI18n()

function roleLabel(role: AppUserRole) {
  return uiText(ROLE_LABELS[role] ?? role)
}

function employeeMatchesDoctorProfile(employee: Pick<EmployeeOption, 'isMedecin' | 'jobTitle'>) {
  if (employee.isMedecin) return true
  const normalizedTitle = (employee.jobTitle ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
  if (!normalizedTitle) return false
  if (
    /assistant|techni|infirm|aide[- ]?soign|laborantin|pharmacien|reception|hygien|securit|entretien/.test(
      normalizedTitle,
    )
  ) {
    return false
  }
  return /medecin|docteur|doctor|chirurgien|gynecolog|ophtalmolog|radiolog|anesthes|pediatr|cardiolog|dermatolog|psychiatr|neurolog|urolog|rhumatolog|gastro|generaliste|specialiste/.test(
    normalizedTitle,
  )
}

const usersById = computed(() => new Map(users.value.map((user) => [user.id, user])))

/** Employés sélectionnables : non liés (+ l’employé courant en édition). */
const selectableEmployees = computed(() => {
  const currentEmployeeId = form.value.employeeId || editingOriginalEmployeeId.value
  const list = employeeOptions.value.filter((employee) => {
    const isCurrentLinked =
      Boolean(editingId.value) && currentEmployeeId != null && employee.id === currentEmployeeId
    // En édition, ne pas proposer les autres comptes déjà liés (évite un mauvais id envoyé).
    if (employee.hasUserAccount && !isCurrentLinked) return false
    if (isCurrentLinked) return true
    if (employeeFilter.value === 'MEDECINS') return employeeMatchesDoctorProfile(employee)
    return true
  })
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

const selectableDoctorsCount = computed(
  () => selectableEmployees.value.filter((employee) => employeeMatchesDoctorProfile(employee)).length,
)

const doctorAvailabilityHint = computed(() => {
  if (form.value.role !== 'MEDECIN') return ''
  if (selectableDoctorsCount.value === 0) return ''
  return translateTemplate('{n} médecin(s) disponible(s).', { n: selectableDoctorsCount.value })
})

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

const filteredUsers = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const role = roleFilter.value
  return users.value
    .filter((user) => {
      if (role !== 'ALL' && user.role !== role) return false
      if (!q) return true
      const haystack = [
        user.firstName,
        user.lastName,
        fullName(user.firstName, user.lastName),
        user.username,
        user.email,
        ROLE_LABELS[user.role] ?? user.role,
        user.employee ? fullName(user.employee.firstName, user.employee.lastName) : '',
        user.employee?.jobTitle ?? '',
        user.active ? 'actif' : 'inactif',
        user.locked ? 'verrouille' : '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
    .sort((a, b) =>
      fullName(a.firstName, a.lastName).localeCompare(fullName(b.firstName, b.lastName), 'fr', {
        sensitivity: 'base',
        numeric: true,
      }),
    )
})

const tableRows = computed(() => {
  localeCode.value
  return filteredUsers.value.map((user) => {
    const locked = Boolean(user.locked)
    return {
      id: user.id,
      name: fullName(user.firstName, user.lastName),
      username: user.username,
      email: user.email,
      employeeLabel: user.employee
        ? fullName(user.employee.firstName, user.employee.lastName)
        : 'Employé indisponible',
      roleLabel: roleLabel(user.role),
      role: user.role,
      statusLabel: locked
        ? uiText('Verrouillé')
        : user.active
          ? uiText('Actif')
          : uiText('Inactif'),
      statusVariant: locked ? 'warning' : user.active ? 'success' : 'danger',
      toggleLabel: user.active ? uiText('Désactiver') : uiText('Activer'),
      isActive: user.active,
      locked,
      canUnlock: isAdmin.value && locked,
      canDelete: user.canDelete ?? false,
      relatedDataCount: user.relatedDataCount ?? 0,
    }
  })
})

const columns = [
  {
    data: 'name',
    title: 'Nom',
    responsivePriority: 1,
    render: (name: string) => `<span class="dt-name">${name}</span>`,
  },
  {
    data: 'username',
    title: "Nom d'utilisateur",
    responsivePriority: 1,
    className: 'dt-col-username',
  },
  {
    data: 'roleLabel',
    title: 'Rôle',
    responsivePriority: 1,
    render: (label: string) => statusBadge(label, 'info'),
  },
  {
    data: 'statusLabel',
    title: 'Statut',
    responsivePriority: 1,
    className: 'dt-col-status',
    render: (label: string, _t: string, row: { statusVariant: string }) =>
      statusBadge(label, row.statusVariant as 'success' | 'danger' | 'warning'),
  },
  {
    data: 'employeeLabel',
    title: 'Employé lié',
    responsivePriority: 3,
    render: (label: string) => `<span class="dt-date">${label}</span>`,
  },
  {
    data: 'email',
    title: 'E-mail',
    responsivePriority: 4,
    className: 'dt-col-email',
  },
  {
    data: null,
    title: 'Actions',
    orderable: false,
    className: 'dt-actions-col dt-actions-col--catalog dt-actions-col--sticky all',
    responsivePriority: 1,
    render: (
      _d: unknown,
      _t: string,
      row: {
        id: string
        toggleLabel: string
        isActive: boolean
        canDelete: boolean
        canUnlock: boolean
      },
    ) => {
      const base = catalogRowActionsHtml({
        ...row,
        showView: true,
        showEdit: true,
        showToggle: true,
        canDelete: true,
      })
      if (!row.canUnlock) return base
      const unlockLabel = uiText('Déverrouiller')
      return base.replace(
        '</div>',
        `<button type="button" class="dt-btn dt-btn--icon dt-btn--catalog-on" data-action="unlock" title="${unlockLabel}" aria-label="${unlockLabel}">${DT_ICONS.undo}</button></div>`,
      )
    },
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
    active: 'true',
  }
  editingOriginalEmployeeId.value = null
  employeeFilter.value = 'ALL'
}

async function loadEmployeeOptions(
  currentEmployeeId?: string,
  currentEmployee?: LinkedEmployee | null,
) {
  const { data } = await api.get<EmployeeOption[]>('/admin/employees', {
    // Inclure les inactifs pour ne pas perdre l'employé déjà lié.
    params: { active: false },
  })
  let options = data.filter(
    (employee) => employee.active !== false && !isHiddenPlatformAdminEmployee(employee),
  )

  // Remettre l'employé lié même s'il est inactif / hors filtre.
  if (currentEmployeeId && !options.some((employee) => employee.id === currentEmployeeId)) {
    const fromList = data.find((employee) => employee.id === currentEmployeeId)
    if (fromList) {
      options = [...options, fromList]
    } else if (currentEmployee) {
      options = [
        ...options,
        {
          ...currentEmployee,
          hasUserAccount: true,
        },
      ]
    }
  }

  employeeOptions.value = options
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
  if (form.value.role === 'MEDECIN') employeeFilter.value = 'MEDECINS'
  await loadEmployeeOptions()
  modalOpen.value = true
  message.value = ''
}

async function openEditModal(id: string) {
  const user = usersById.value.get(id)
  if (!user) return
  editingId.value = id
  editingOriginalEmployeeId.value = user.employeeId
  await loadEmployeeOptions(user.employeeId, user.employee)
  form.value = {
    employeeId: user.employeeId,
    username: user.username,
    email: user.email,
    role: user.role as AdminAssignableUserRole,
    password: '',
    passwordConfirm: '',
    cashShiftSlot: user.cashShiftSlot ?? '',
    active: user.active ? 'true' : 'false',
  }
  employeeFilter.value = form.value.role === 'MEDECIN' ? 'MEDECINS' : 'ALL'
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

function viewingEmployeeLabel(user: PlatformUser) {
  if (!user.employee) return 'Employé indisponible'
  return fullName(user.employee.firstName, user.employee.lastName)
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
  const isEditing = Boolean(editingId.value)
  const currentId = editingId.value
  // Filet : si le select a perdu l’employé lié, reprendre l’original.
  const employeeId =
    form.value.employeeId ||
    (isEditing ? editingOriginalEmployeeId.value : null) ||
    ''
  if (employeeId && employeeId !== form.value.employeeId) {
    form.value.employeeId = employeeId
  }

  if (!employeeId) {
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
  if (
    form.value.role === 'MEDECIN' &&
    selectedEmployee.value &&
    !employeeMatchesDoctorProfile(selectedEmployee.value)
  ) {
    message.value = 'Un compte médecin doit être lié à un employé médecin.'
    messageType.value = 'error'
    return
  }
  if (!isEditing && form.value.password.length < 6) {
    message.value = 'Le mot de passe doit contenir au moins 6 caractères.'
    messageType.value = 'error'
    return
  }
  if (!isEditing && form.value.password !== form.value.passwordConfirm) {
    message.value = 'La confirmation du mot de passe ne correspond pas.'
    messageType.value = 'error'
    return
  }
  if (isEditing && form.value.password.trim() && form.value.password !== form.value.passwordConfirm) {
    message.value = 'La confirmation du mot de passe ne correspond pas.'
    messageType.value = 'error'
    return
  }
  if (isEditing && form.value.password.trim() && form.value.password.length < 6) {
    message.value = 'Le nouveau mot de passe doit contenir au moins 6 caractères.'
    messageType.value = 'error'
    return
  }
  if (isEditing && form.value.password.trim() && !isAdmin.value) {
    message.value = 'Seul un administrateur peut réinitialiser le mot de passe.'
    messageType.value = 'error'
    return
  }
  saving.value = true
  message.value = ''
  try {
    const cashShiftSlot =
      form.value.role === 'RECEPTIONNISTE' ? form.value.cashShiftSlot || null : null
    const active = form.value.active === 'true'
    if (isEditing && currentId) {
      const payload: Record<string, string | boolean | null | undefined> = {
        username: form.value.username.trim(),
        role: form.value.role,
        employeeId,
        cashShiftSlot,
        active,
      }
      if (email) payload.email = email
      if (isAdmin.value && form.value.password.trim()) payload.password = form.value.password
      await api.put(`/admin/users/${currentId}`, payload)
      message.value = 'Utilisateur mis à jour.'
    } else {
      await api.post('/admin/users', {
        username: form.value.username.trim(),
        ...(email ? { email } : {}),
        role: form.value.role,
        password: form.value.password,
        employeeId,
        cashShiftSlot,
        active: true,
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
      (isEditing
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

  const label = fullName(user.firstName, user.lastName)
  if (user.active) {
    const confirmed = await confirmAppModal({
      type: 'WARNING',
      title: 'Désactiver le compte',
      message: translateTemplate(
        'Désactiver le compte de {name} ? Cette personne ne pourra plus se connecter.',
        { name: label },
      ),
      confirmLabel: 'Désactiver',
    })
    if (!confirmed) return
  } else {
    const confirmed = await confirmAppModal({
      type: 'CONFIRM',
      title: 'Réactiver le compte',
      message: translateTemplate('Réactiver le compte de {name} ?', { name: label }),
      confirmLabel: 'Activer',
    })
    if (!confirmed) return
  }

  try {
    await api.put(`/admin/users/${id}`, { active: !user.active })
    message.value = user.active ? 'Compte désactivé.' : 'Compte réactivé.'
    messageType.value = 'success'
    await loadUsers()
  } catch (error) {
    message.value = apiErrorMessage(error, 'Action impossible sur ce compte.')
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
  if (action === 'unlock') openUnlockModal(id)
}

function openUnlockModal(id: string) {
  if (!isAdmin.value) {
    message.value = 'Seul un administrateur peut déverrouiller un compte.'
    messageType.value = 'error'
    return
  }
  const user = usersById.value.get(id)
  if (!user?.locked) return
  unlockingUser.value = user
  unlockPassword.value = ''
  unlockPasswordConfirm.value = ''
  unlockModalOpen.value = true
  message.value = ''
}

function closeUnlockModal() {
  unlockModalOpen.value = false
  unlockingUser.value = null
  unlockPassword.value = ''
  unlockPasswordConfirm.value = ''
}

async function confirmUnlock() {
  if (!unlockingUser.value || !isAdmin.value) return
  if (unlockPassword.value.length < 6) {
    message.value = 'Le nouveau mot de passe doit contenir au moins 6 caractères.'
    messageType.value = 'error'
    return
  }
  if (unlockPassword.value !== unlockPasswordConfirm.value) {
    message.value = 'La confirmation du mot de passe ne correspond pas.'
    messageType.value = 'error'
    return
  }
  unlocking.value = true
  message.value = ''
  try {
    await api.post(`/admin/users/${unlockingUser.value.id}/unlock`, {
      newPassword: unlockPassword.value,
    })
    message.value = 'Compte déverrouillé. L’utilisateur peut se reconnecter.'
    messageType.value = 'success'
    closeUnlockModal()
    await loadUsers()
  } catch (error: unknown) {
    const apiMessage =
      axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
        ? error.response.data.error
        : null
    message.value = apiMessage ?? 'Impossible de déverrouiller ce compte.'
    messageType.value = 'error'
  } finally {
    unlocking.value = false
  }
}

watch(
  () => form.value.role,
  () => {
    if (form.value.role === 'MEDECIN') {
      employeeFilter.value = 'MEDECINS'
    } else if (employeeFilter.value === 'MEDECINS') {
      employeeFilter.value = 'ALL'
    }
    // Ne pas effacer l'employé lié pendant une modification (évite faux « déjà lié »).
    if (!editingId.value && form.value.employeeId && !selectedEmployee.value) {
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

        <div class="users-filters">
          <label class="users-search">
            <Search :size="16" class="users-search__icon" aria-hidden="true" />
            <input
              v-model="searchQuery"
              type="search"
              class="users-search__input"
              :placeholder="uiText('Rechercher un utilisateur…')"
              :aria-label="uiText('Rechercher un utilisateur')"
            />
          </label>
          <select
            v-model="roleFilter"
            class="users-role-filter"
            :aria-label="uiText('Filtrer par rôle')"
          >
            <option value="ALL">{{ uiText('Tous les rôles') }}</option>
            <option v-for="role in ADMIN_ASSIGNABLE_USER_ROLES" :key="role" :value="role">
              {{ ROLE_LABELS[role] ? uiText(ROLE_LABELS[role]) : role }}
            </option>
          </select>
        </div>

        <p v-if="!loading && !users.length" class="empty">{{ uiText('Aucun utilisateur') }}</p>
        <p v-else-if="!loading && users.length && !filteredUsers.length" class="empty">
          {{ uiText('Aucun utilisateur pour ce filtre') }}
        </p>
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
            <option v-for="role in ADMIN_ASSIGNABLE_USER_ROLES" :key="role" :value="role">
              {{ ROLE_LABELS[role] ? uiText(ROLE_LABELS[role]) : role }}
            </option>
          </UiSelect>
        </div>

        <UiSelect v-model="form.employeeId" label="Employé lié" required>
          <option value="" disabled>Sélectionner un employé</option>
          <option
            v-for="employee in selectableEmployees"
            :key="employee.id"
            :value="employee.id"
          >
            {{ fullName(employee.firstName, employee.lastName) }}
            {{ employee.jobTitle ? ` — ${employee.jobTitle}` : '' }}
            {{ employeeMatchesDoctorProfile(employee) ? uiText(' (médecin)') : '' }}
            {{
              editingId && employee.id === (form.employeeId || editingOriginalEmployeeId)
                ? uiText(' (lié à ce compte)')
                : ''
            }}
          </option>
        </UiSelect>
        <div class="employee-filter-toggle" role="group" :aria-label="uiText('Filtre employés')">
          <button
            type="button"
            class="employee-filter-toggle__btn"
            :class="{ 'employee-filter-toggle__btn--active': employeeFilter === 'ALL' }"
            @click="employeeFilter = 'ALL'"
          >
            {{ uiText('Tous') }}
          </button>
          <button
            type="button"
            class="employee-filter-toggle__btn"
            :class="{ 'employee-filter-toggle__btn--active': employeeFilter === 'MEDECINS' }"
            @click="employeeFilter = 'MEDECINS'"
          >
            {{ uiText('Médecins') }}
          </button>
        </div>

        <p v-if="selectedEmployee" class="employee-preview">
          Nom sur le compte :
          <strong>{{ fullName(selectedEmployee.firstName, selectedEmployee.lastName) }}</strong>
        </p>
        <p v-else-if="doctorAvailabilityHint" class="employee-hint employee-hint--inline employee-hint--available">
          {{ doctorAvailabilityHint }}
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

        <div v-if="editingId" class="form-grid-2">
          <UiSelect v-model="form.active" label="Statut du compte" required>
            <option value="true">{{ uiText('Actif') }}</option>
            <option value="false">{{ uiText('Inactif') }}</option>
          </UiSelect>
        </div>

        <div v-if="!editingId || isAdmin" class="form-grid-2">
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
        <p v-else-if="editingId && !isAdmin" class="employee-hint employee-hint--inline">
          {{ uiText('Seul un administrateur peut réinitialiser le mot de passe.') }}
        </p>
        <UiAlert
          v-if="editingId && usersById.get(editingId)?.locked"
          type="warning"
          :message="
            isAdmin
              ? uiText('Compte verrouillé — définissez un nouveau mot de passe pour le déverrouiller, ou utilisez le bouton Déverrouiller.')
              : uiText('Compte verrouillé — seul un administrateur peut le déverrouiller.')
          "
        />
      </section>

      <template #footer>
        <UiButton variant="ghost" @click="closeModal">Annuler</UiButton>
        <UiButton variant="primary" :icon="Save" :disabled="saving" @click="saveUser">
          {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
        </UiButton>
      </template>
    </UiFormModal>

    <UiFormModal
      v-if="unlockModalOpen && unlockingUser"
      title-id="user-unlock-title"
      :title="uiText('Déverrouiller le compte')"
      :icon="Unlock"
      @close="closeUnlockModal"
    >
      <UiAlert v-if="message && unlockModalOpen" :type="messageType" :message="message" />
      <p class="employee-hint employee-hint--inline">
        {{
          translateTemplate(
            'Définir un nouveau mot de passe pour {name} ({username}).',
            {
              name: fullName(unlockingUser.firstName, unlockingUser.lastName),
              username: unlockingUser.username,
            },
          )
        }}
      </p>
      <div class="form-grid-2">
        <UiInput
          v-model="unlockPassword"
          :label="uiText('Nouveau mot de passe')"
          type="password"
          required
          revealable
          autocomplete="new-password"
          placeholder="Minimum 6 caractères"
        />
        <UiInput
          v-model="unlockPasswordConfirm"
          :label="uiText('Confirmer le mot de passe')"
          type="password"
          required
          revealable
          autocomplete="new-password"
          placeholder="Retapez le mot de passe"
        />
      </div>
      <template #footer>
        <UiButton variant="ghost" @click="closeUnlockModal">Annuler</UiButton>
        <UiButton
          variant="primary"
          :icon="Unlock"
          :disabled="unlocking"
          @click="confirmUnlock"
        >
          {{ unlocking ? uiText('Déverrouillage…') : uiText('Déverrouiller') }}
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
            {{ viewingEmployeeLabel(viewingUser) }}
            <span v-if="viewingUser.employee?.jobTitle" class="user-detail__muted">
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

.users-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.85rem;
}

.users-search {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex: 1 1 14rem;
  min-width: 12rem;
  max-width: 28rem;
  padding: 0.35rem 0.7rem;
  border: 1px solid rgba(27, 79, 156, 0.18);
  border-radius: 10px;
  background: #fff;
}

.users-search__icon {
  flex-shrink: 0;
  color: #1b4f9c;
  opacity: 0.75;
}

.users-search__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: 0.875rem;
  color: var(--text);
}

.users-search__input::placeholder {
  color: var(--text-light, #94a3b8);
}

.users-role-filter {
  flex: 0 1 13rem;
  min-width: 10rem;
  max-width: 16rem;
  padding: 0.4rem 0.65rem;
  border: 1px solid rgba(27, 79, 156, 0.18);
  border-radius: 10px;
  background: #fff;
  font-family: inherit;
  font-size: 0.875rem;
  color: var(--text);
  cursor: pointer;
}

.employee-hint--inline {
  text-align: left;
  padding: 0 0 1rem;
}

.employee-hint--available {
  color: var(--success-700, #15803d);
}

.employee-preview {
  margin: 0 0 1rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.employee-filter-toggle {
  display: inline-grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem;
  margin: -0.35rem 0 0.55rem;
}

.employee-filter-toggle__btn {
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  padding: 0.38rem 0.65rem;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.employee-filter-toggle__btn--active {
  border-color: var(--primary-500);
  background: var(--primary-50);
  color: var(--primary-800);
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
