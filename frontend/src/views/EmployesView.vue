<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { UserRound, Plus, RefreshCw, Save, Briefcase, Stethoscope, Banknote, Info, Phone, Users, UserCheck, Building2, Palmtree, UserX } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import {
  CONSULTATION_QUOTA_MODE_OPTIONS,
  CONSULTATION_RENEWAL_POLICY_OPTIONS,
  CONSULTATION_VALIDITY_OPTIONS,
  DOCTOR_COMPENSATION_OPTIONS,
  computeDoctorConsultationShares,
  doctorCompensationLabel,
  doctorQuotaHint,
  formatDoctorQuotaShare,
  type ConsultationQuotaMode,
  type ConsultationRenewalPolicy,
  type DoctorCompensationType,
} from '@/lib/doctor-compensation'
import { employeeJobTitleOptions, loadEmployeeJobTitleLabels } from '@/lib/employee-job-titles'
import { employeeNeedsAppAccount } from '@/lib/employee-app-account'
import { catalogRowActionsHtml, statusBadge } from '@/lib/datatable-defaults'
import { confirmAppModal } from '@/lib/api-modal-helper'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import EmployeeJobTitlesPanel from '@/components/admin/EmployeeJobTitlesPanel.vue'

type EmployeeUser = {
  id: string
  email: string
  role: string
  active: boolean
}

type Employee = {
  id: string
  firstName: string
  lastName: string
  phone?: string | null
  jobTitle?: string | null
  isMedecin: boolean
  doctorCompensationType?: DoctorCompensationType
  consultationTotalFcfa?: number | null
  consultationQuotaMode?: ConsultationQuotaMode
  consultationQuotaPercent?: number | null
  consultationQuotaFcfa?: number | null
  consultationValidityDays?: number | null
  consultationRenewalPolicy?: ConsultationRenewalPolicy
  compensationLabel?: string | null
  fixedSalaryFcfa?: number | null
  bonusFcfa?: number | null
  service?: string | null
  contractType?: string | null
  contractStatus?: string
  active: boolean
  hasUserAccount: boolean
  user?: EmployeeUser | null
  createdAt: string
}

const CONTRACT_TYPE_OPTIONS = [
  { value: 'CDI', label: 'CDI' },
  { value: 'CDD', label: 'CDD' },
  { value: 'PRESTATION', label: 'Prestation' },
  { value: 'AUTRE', label: 'Autre' },
] as const

const CONTRACT_STATUS_OPTIONS = [
  { value: 'ACTIF', label: 'Actif', hint: 'En poste', icon: UserCheck },
  { value: 'EN_CONGE', label: 'En congé', hint: 'Absence temporaire', icon: Palmtree },
  { value: 'INACTIF', label: 'Inactif', hint: 'Hors effectif', icon: UserX },
] as const

const SERVICE_SUGGESTIONS = [
  'Accueil',
  'Comptabilité',
  'Laboratoire',
  'Bloc opératoire',
  'Hospitalisation',
  'Administration',
  'Entretien',
]

const route = useRoute()
const isGestionnaireRegistry = computed(() => route.meta.employeeRegistry === 'gestionnaire')
const apiBase = computed(() => (isGestionnaireRegistry.value ? '/gestionnaire' : '/admin'))
const showPayrollSection = computed(() => isGestionnaireRegistry.value)
const employeesTableKey = computed(() =>
  isGestionnaireRegistry.value ? 'gestionnaire-employees' : 'admin-employees',
)
const jobTitlesTableKey = computed(() =>
  isGestionnaireRegistry.value ? 'gestionnaire-job-titles' : 'admin-job-titles',
)

const employees = ref<Employee[]>([])
const jobTitleLabels = ref<string[]>([])
const activeTab = ref<'employees' | 'job-titles'>('employees')
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const modalOpen = ref(false)
const editingId = ref<string | null>(null)

const form = ref({
  displayName: '',
  phone: '',
  jobTitle: '',
  profile: 'STAFF' as 'STAFF' | 'MEDECIN',
  doctorCompensationType: 'QUOTA' as DoctorCompensationType,
  consultationTotalFcfa: '',
  consultationQuotaMode: 'PERCENT' as ConsultationQuotaMode,
  consultationQuotaPercent: '',
  consultationQuotaFcfa: '',
  consultationValidityDays: '30',
  consultationRenewalPolicy: 'FULL' as ConsultationRenewalPolicy,
  service: '',
  fixedSalaryFcfa: '',
  bonusFcfa: '',
  contractType: 'CDI',
  contractStatus: 'ACTIF',
  active: true,
})

function parseEmployeeDisplayName(input: string): { firstName: string; lastName: string } | null {
  const trimmed = input.trim().replace(/\s+/g, ' ')
  if (!trimmed) return null
  const parts = trimmed.split(' ')
  if (parts.length === 1) {
    if (parts[0].length < 2) return null
    return { firstName: parts[0], lastName: parts[0] }
  }
  const firstName = parts[0]
  const lastName = parts.slice(1).join(' ')
  if (firstName.length < 2 || lastName.length < 2) return null
  return { firstName, lastName }
}

const parsedEmployeeName = computed(() => parseEmployeeDisplayName(form.value.displayName))

const isMedecinProfile = computed(() => form.value.profile === 'MEDECIN')

/** Médecin rémunéré au quota : pas de salaire fixe mensuel. */
const isQuotaDoctor = computed(
  () => isMedecinProfile.value && form.value.doctorCompensationType === 'QUOTA',
)

const showSalaryField = computed(() => !isQuotaDoctor.value)

const modalEmployeeName = computed(() => {
  const trimmed = form.value.displayName.trim()
  if (!trimmed) return null
  return trimmed
})

const employeeInitials = computed(() => {
  const parsed = parsedEmployeeName.value
  if (!parsed) return '?'
  const f = parsed.firstName.charAt(0)
  const l = parsed.lastName.charAt(0)
  return `${f}${l}`.toUpperCase()
})

const employeeProfileLabel = computed(() =>
  isMedecinProfile.value ? 'Profil médecin' : 'Profil personnel',
)

const employeeModalSubtitle = computed(() => {
  if (modalEmployeeName.value) return modalEmployeeName.value
  return 'Fiche personnelle — configurez le poste et, pour un médecin, la rémunération des consultations'
})

const previewDoctor = computed(() => ({
  doctorCompensationType: form.value.doctorCompensationType,
  consultationTotalFcfa: Number(form.value.consultationTotalFcfa) || 0,
  consultationQuotaMode: form.value.consultationQuotaMode,
  consultationQuotaPercent: Number(form.value.consultationQuotaPercent) || null,
  consultationQuotaFcfa: Number(form.value.consultationQuotaFcfa) || null,
  consultationValidityDays: Number(form.value.consultationValidityDays) || null,
  consultationRenewalPolicy: form.value.consultationRenewalPolicy,
}))

const compensationSplit = computed(() => {
  if (!isMedecinProfile.value || form.value.doctorCompensationType !== 'QUOTA') return null
  const total = Number(form.value.consultationTotalFcfa)
  if (!Number.isFinite(total) || total <= 0) return null
  return computeDoctorConsultationShares(total, previewDoctor.value)
})

const quotaPreviewHint = computed(() => {
  if (!isMedecinProfile.value || form.value.doctorCompensationType !== 'QUOTA') return null
  return doctorQuotaHint(previewDoctor.value, Number(form.value.consultationTotalFcfa) || undefined)
})

const renewalPolicyHint = computed(
  () =>
    CONSULTATION_RENEWAL_POLICY_OPTIONS.find((item) => item.value === form.value.consultationRenewalPolicy)
      ?.hint ?? '',
)

const payrollStepNumber = computed(() => (isMedecinProfile.value ? 4 : 3))

const salaryStepNumber = computed(() => {
  if (showPayrollSection.value) return payrollStepNumber.value
  return isMedecinProfile.value ? 4 : 3
})

const salaryPreview = computed(() => {
  const base = showSalaryField.value ? Number(form.value.fixedSalaryFcfa) : NaN
  const bonus = showPayrollSection.value ? Number(form.value.bonusFcfa) : NaN
  const hasBase = Number.isFinite(base) && base > 0
  const hasBonus = Number.isFinite(bonus) && bonus > 0
  if (!hasBase && !hasBonus) return null
  return {
    base: hasBase ? base : 0,
    bonus: hasBonus ? bonus : 0,
    total: (hasBase ? base : 0) + (hasBonus ? bonus : 0),
  }
})

const canSaveEmployee = computed(() => {
  if (!parsedEmployeeName.value) return false
  if (!form.value.jobTitle.trim()) return false
  if (
    isMedecinProfile.value &&
    form.value.doctorCompensationType === 'QUOTA' &&
    (!form.value.consultationTotalFcfa.trim() || !form.value.consultationValidityDays.trim())
  ) {
    return false
  }
  return true
})

const jobTitleOptions = computed(() => employeeJobTitleOptions(form.value.jobTitle, jobTitleLabels.value))

const employeesById = computed(() => new Map(employees.value.map((e) => [e.id, e])))

const employeeStats = computed(() => {
  const list = employees.value
  const active = list.filter((e) => e.active)
  const medecins = list.filter((e) => e.isMedecin)
  const needsAccount = list.filter((e) => employeeNeedsAppAccount(e.jobTitle))
  const withAccount = needsAccount.filter((e) => e.hasUserAccount)
  const withSalary = list.filter((e) => e.fixedSalaryFcfa != null && e.fixedSalaryFcfa > 0)

  return {
    total: list.length,
    activeCount: active.length,
    inactiveCount: list.length - active.length,
    medecinsCount: medecins.length,
    staffCount: list.length - medecins.length,
    needsAccountCount: needsAccount.length,
    withAccountCount: withAccount.length,
    withoutAccountCount: needsAccount.length - withAccount.length,
    withSalaryCount: withSalary.length,
    withoutSalaryCount: list.length - withSalary.length,
  }
})

function employeeCompensationLabel(employee: Employee): string {
  const salaryLabel =
    employee.fixedSalaryFcfa != null && employee.fixedSalaryFcfa > 0
      ? formatFcfa(employee.fixedSalaryFcfa)
      : null

  if (!employee.isMedecin) {
    return salaryLabel ?? '—'
  }

  if (employee.doctorCompensationType === 'FIXED_SALARY') {
    return [doctorCompensationLabel('FIXED_SALARY'), salaryLabel].filter(Boolean).join(' · ') || '—'
  }

  return (
    [
      doctorCompensationLabel(employee.doctorCompensationType),
      employee.consultationTotalFcfa != null
        ? `${employee.consultationTotalFcfa.toLocaleString('fr-FR')} FCFA`
        : null,
      employee.consultationValidityDays ? `Val. ${employee.consultationValidityDays}j` : null,
      employee.consultationRenewalPolicy === 'HALF' ? 'Renouv. 50%' : null,
      `Part ${formatDoctorQuotaShare(employee)}`,
    ]
      .filter(Boolean)
      .join(' · ') || '—'
  )
}

const tableRows = computed(() =>
  employees.value.map((employee) => ({
    id: employee.id,
    name: fullName(employee.firstName, employee.lastName),
    jobTitle: employee.jobTitle || '—',
    compensationLabel: employeeCompensationLabel(employee),
    statusLabel: employee.active ? 'Actif' : 'Inactif',
    statusVariant: employee.active ? 'success' : 'danger',
  })),
)

const columns = [
  {
    data: 'name',
    title: 'Nom',
    responsivePriority: 1,
    render: (name: string) => `<span class="dt-name">${name}</span>`,
  },
  { data: 'jobTitle', title: 'Poste', responsivePriority: 3 },
  {
    data: 'compensationLabel',
    title: 'Rémunération',
    responsivePriority: 4,
    render: (label: string) =>
      label === '—' ? '<span class="dt-muted">—</span>' : `<span class="dt-date">${label}</span>`,
  },
  {
    data: 'statusLabel',
    title: 'Statut',
    responsivePriority: 2,
    render: (label: string, _t: string, row: { statusVariant: string }) =>
      statusBadge(label, row.statusVariant as 'success' | 'danger'),
  },
  {
    data: null,
    title: 'Actions',
    orderable: false,
    className: 'dt-actions-col dt-actions-col--catalog all',
    responsivePriority: 1,
    render: (_d: unknown, _t: string, row: { id: string }) =>
      catalogRowActionsHtml({ id: row.id, showToggle: false, canDelete: true }),
  },
]

function resetForm() {
  form.value = {
    displayName: '',
    phone: '',
    jobTitle: '',
    profile: 'STAFF',
    doctorCompensationType: 'QUOTA',
    consultationTotalFcfa: '',
    consultationQuotaMode: 'PERCENT',
    consultationQuotaPercent: '',
    consultationQuotaFcfa: '',
    consultationValidityDays: '30',
    consultationRenewalPolicy: 'FULL',
    service: '',
    fixedSalaryFcfa: '',
    bonusFcfa: '',
    contractType: 'CDI',
    contractStatus: 'ACTIF',
    active: true,
  }
}

async function loadJobTitleLabels() {
  jobTitleLabels.value = await loadEmployeeJobTitleLabels(true, apiBase.value)
}

async function loadEmployees() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<Employee[]>(`${apiBase.value}/employees`, { params: { active: false } })
    employees.value = data
  } catch {
    employees.value = []
    message.value = 'Impossible de charger les employés.'
    messageType.value = 'error'
  } finally {
    loading.value = false
  }
}

function openCreateModal() {
  editingId.value = null
  resetForm()
  modalOpen.value = true
  message.value = ''
}

function openEditModal(id: string) {
  const employee = employeesById.value.get(id)
  if (!employee) return
  editingId.value = id
  form.value = {
    displayName: fullName(employee.firstName, employee.lastName),
    phone: employee.phone ?? '',
    jobTitle: employee.jobTitle ?? '',
    profile: employee.isMedecin ? 'MEDECIN' : 'STAFF',
    doctorCompensationType: employee.doctorCompensationType ?? 'QUOTA',
    consultationTotalFcfa:
      employee.consultationTotalFcfa != null ? String(employee.consultationTotalFcfa) : '',
    consultationQuotaMode: employee.consultationQuotaMode ?? 'PERCENT',
    consultationQuotaPercent:
      employee.consultationQuotaPercent != null ? String(employee.consultationQuotaPercent) : '',
    consultationQuotaFcfa:
      employee.consultationQuotaFcfa != null ? String(employee.consultationQuotaFcfa) : '',
    consultationValidityDays:
      employee.consultationValidityDays != null
        ? String(employee.consultationValidityDays)
        : '30',
    consultationRenewalPolicy: employee.consultationRenewalPolicy ?? 'FULL',
    service: employee.service ?? '',
    fixedSalaryFcfa:
      employee.fixedSalaryFcfa != null ? String(employee.fixedSalaryFcfa) : '',
    bonusFcfa: employee.bonusFcfa != null ? String(employee.bonusFcfa) : '',
    contractType: employee.contractType ?? 'CDI',
    contractStatus: employee.contractStatus ?? 'ACTIF',
    active: employee.active,
  }
  modalOpen.value = true
  message.value = ''
}

function closeModal() {
  modalOpen.value = false
  editingId.value = null
  resetForm()
}

function compensationPayload() {
  if (!isMedecinProfile.value) return { isMedecin: false as const }
  return {
    isMedecin: true as const,
    doctorCompensationType: form.value.doctorCompensationType,
    consultationTotalFcfa:
      form.value.doctorCompensationType === 'QUOTA' && form.value.consultationTotalFcfa.trim()
        ? Number(form.value.consultationTotalFcfa)
        : undefined,
    consultationQuotaMode:
      form.value.doctorCompensationType === 'QUOTA' ? form.value.consultationQuotaMode : undefined,
    consultationQuotaPercent:
      form.value.doctorCompensationType === 'QUOTA' &&
      form.value.consultationQuotaMode === 'PERCENT' &&
      form.value.consultationQuotaPercent.trim()
        ? Number(form.value.consultationQuotaPercent)
        : undefined,
    consultationQuotaFcfa:
      form.value.doctorCompensationType === 'QUOTA' &&
      form.value.consultationQuotaMode === 'FIXED_AMOUNT' &&
      form.value.consultationQuotaFcfa.trim()
        ? Number(form.value.consultationQuotaFcfa)
        : undefined,
    consultationValidityDays:
      form.value.doctorCompensationType === 'QUOTA' && form.value.consultationValidityDays.trim()
        ? Number(form.value.consultationValidityDays)
        : undefined,
    consultationRenewalPolicy:
      form.value.doctorCompensationType === 'QUOTA'
        ? form.value.consultationRenewalPolicy
        : undefined,
  }
}

function payrollPayload() {
  const payload: Record<string, unknown> = {}
  if (showPayrollSection.value) {
    payload.service = form.value.service.trim() || undefined
    payload.contractType = form.value.contractType || undefined
    payload.contractStatus = form.value.contractStatus
    const bonus = Number(form.value.bonusFcfa)
    if (Number.isFinite(bonus) && bonus >= 0) payload.bonusFcfa = bonus
  }
  // Salaire fixe pour le personnel et les médecins en salaire fixe (pas pour le quota)
  if (showSalaryField.value) {
    const salary = Number(form.value.fixedSalaryFcfa)
    if (Number.isFinite(salary) && salary >= 0) payload.fixedSalaryFcfa = salary
  }
  return payload
}

function onDoctorCompensationTypeChange(type: DoctorCompensationType) {
  form.value.doctorCompensationType = type
  if (type === 'QUOTA') {
    form.value.fixedSalaryFcfa = ''
  }
}

function onProfileChange(profile: 'STAFF' | 'MEDECIN') {
  form.value.profile = profile
  if (profile === 'MEDECIN' && form.value.doctorCompensationType === 'QUOTA') {
    form.value.fixedSalaryFcfa = ''
  }
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === 'string') {
    return error.response.data.error
  }
  return fallback
}

async function saveEmployee() {
  const nameParts = parseEmployeeDisplayName(form.value.displayName)
  if (!nameParts) {
    message.value =
      'Saisissez le nom complet (prénom et nom, séparés par un espace, 2 caractères minimum chacun).'
    messageType.value = 'error'
    return
  }
  if (!form.value.jobTitle.trim()) {
    message.value = 'Sélectionnez un poste / fonction.'
    messageType.value = 'error'
    return
  }
  if (
    isMedecinProfile.value &&
    form.value.doctorCompensationType === 'QUOTA' &&
    (!form.value.consultationTotalFcfa.trim() || !form.value.consultationValidityDays.trim())
  ) {
    message.value = 'Renseignez le prix de consultation et la durée de validité.'
    messageType.value = 'error'
    return
  }

  saving.value = true
  message.value = ''
  try {
    const payload = {
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      phone: form.value.phone.trim() || undefined,
      jobTitle: form.value.jobTitle.trim() || undefined,
      active: form.value.active,
      ...compensationPayload(),
      ...payrollPayload(),
    }
    if (editingId.value) {
      await api.put(`${apiBase.value}/employees/${editingId.value}`, payload)
      message.value = 'Employé mis à jour.'
    } else {
      await api.post(`${apiBase.value}/employees`, payload)
      message.value = 'Employé créé avec succès.'
    }
    messageType.value = 'success'
    closeModal()
    await loadEmployees()
  } catch (error) {
    message.value = apiErrorMessage(
      error,
      editingId.value
        ? 'Impossible de mettre à jour cet employé.'
        : 'Impossible de créer cet employé.',
    )
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

async function deleteEmployee(id: string) {
  const employee = employeesById.value.get(id)
  if (!employee) return

  const name = fullName(employee.firstName, employee.lastName)
  if (employee.hasUserAccount) {
    message.value = `Impossible de supprimer « ${name} » : un compte application y est lié. Supprimez d'abord le compte.`
    messageType.value = 'error'
    return
  }

  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer l\'employé',
    message: `Supprimer définitivement « ${name} » ? Cette action est irréversible.`,
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return

  try {
    const { data } = await api.delete<{ ok: boolean; message?: string }>(
      `${apiBase.value}/employees/${id}`,
    )
    message.value = data.message ?? 'Employé supprimé.'
    messageType.value = 'success'
    await loadEmployees()
  } catch (error) {
    message.value = apiErrorMessage(error, 'Suppression impossible.')
    messageType.value = 'error'
  }
}

function onTableAction({ action, id }: { action: string; id: string }) {
  if (action === 'edit') openEditModal(id)
  if (action === 'delete') deleteEmployee(id)
}

onMounted(async () => {
  await Promise.all([loadEmployees(), loadJobTitleLabels()])
})
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader title="Personnel" :icon="UserRound" />
      <UiAlert v-if="message && !modalOpen && activeTab === 'employees'" :type="messageType" :message="message" />

      <div class="page-tabs" role="tablist" aria-label="Sections employés">
        <button
          type="button"
          class="page-tab"
          :class="{ 'page-tab--active': activeTab === 'employees' }"
          @click="activeTab = 'employees'"
        >
          <UserRound :size="14" />
          Employés
        </button>
        <button
          type="button"
          class="page-tab"
          :class="{ 'page-tab--active': activeTab === 'job-titles' }"
          @click="activeTab = 'job-titles'"
        >
          <Briefcase :size="14" />
          Postes
        </button>
      </div>
    </section>

    <section v-if="activeTab === 'employees'" class="page-with-table__body">
      <div class="stats-grid">
        <UiStatCard
          label="Effectif"
          :value="employeeStats.total"
          :icon="Users"
          variant="violet"
          mini
        />
        <UiStatCard
          label="Médecins"
          :value="employeeStats.medecinsCount"
          :icon="Stethoscope"
          variant="teal"
          mini
        />
        <UiStatCard
          label="Comptes"
          :value="employeeStats.withAccountCount"
          :icon="UserCheck"
          variant="green"
          mini
        />
        <UiStatCard
          label="Salaires"
          :value="employeeStats.withSalaryCount"
          :icon="Banknote"
          variant="amber"
          mini
        />
      </div>

      <UiCard
        title="Employés"
        class="ui-card--table-panel"
        :icon="UserRound"
        icon-variant="violet"
      >
        <template #actions>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadEmployees">
            Actualiser
          </UiButton>
          <UiButton variant="primary" size="sm" :icon="Plus" @click="openCreateModal">
            Ajouter
          </UiButton>
        </template>

        <p v-if="!loading && !employees.length" class="empty">Aucun employé enregistré</p>
        <UiDataTable
          v-else
          fill
          :table-key="employeesTableKey"
          compact
          :data="tableRows"
          :columns="columns"
          :loading="loading"
          loading-label="Chargement…"
          @action="onTableAction"
        />
      </UiCard>
    </section>

    <section v-else class="page-with-table__body">
      <EmployeeJobTitlesPanel
        :api-base="apiBase"
        :table-key="jobTitlesTableKey"
        @changed="loadJobTitleLabels"
      />
    </section>

    <UiFormModal
      v-if="modalOpen"
      title-id="employee-modal-title"
      :title="editingId ? 'Modifier l\'employé' : 'Nouvel employé'"
      :subtitle="employeeModalSubtitle"
      :icon="isMedecinProfile ? Stethoscope : UserRound"
      :size="isMedecinProfile || showPayrollSection || showSalaryField ? 'large' : 'wide'"
      class="employee-form-modal"
      @close="closeModal"
    >
      <div
        class="employee-hero"
        :class="{ 'employee-hero--doctor': isMedecinProfile }"
      >
        <div class="employee-hero__avatar" aria-hidden="true">{{ employeeInitials }}</div>
        <div class="employee-hero__content">
          <p class="employee-hero__eyebrow">
            {{ editingId ? 'Mise à jour fiche' : 'Nouvelle fiche personnel' }}
          </p>
          <strong class="employee-hero__name">{{ modalEmployeeName ?? 'Nom à renseigner' }}</strong>
          <div class="employee-hero__badges">
            <span class="employee-hero__badge">{{ employeeProfileLabel }}</span>
            <span v-if="form.jobTitle.trim()" class="employee-hero__badge employee-hero__badge--muted">
              {{ form.jobTitle.trim() }}
            </span>
          </div>
        </div>
      </div>

      <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />

      <section class="form-panel">
        <h3 class="form-panel__title">
          <span class="form-panel__step">1</span>
          <UserRound :size="15" />
          Identité
        </h3>
        <p class="form-panel__intro">Prénom et nom séparés par un espace dans le champ nom complet.</p>
        <div class="form-grid-2">
          <UiInput v-model="form.displayName" label="Nom complet" required placeholder="Ex. Hassan Mahamat" />
          <UiInput
            v-model="form.phone"
            label="Téléphone"
            placeholder="Ex. +235 6x xx xx xx"
            :icon="Phone"
          />
        </div>
      </section>

      <section class="form-panel">
        <h3 class="form-panel__title">
          <span class="form-panel__step">2</span>
          <Briefcase :size="15" />
          Poste &amp; profil
        </h3>
        <UiSelect v-model="form.jobTitle" label="Poste / fonction" required>
          <option value="" disabled>Sélectionnez un poste</option>
          <option v-for="title in jobTitleOptions" :key="title" :value="title">
            {{ title }}
          </option>
        </UiSelect>

        <div class="profile-picker" role="radiogroup" aria-label="Profil employé">
          <button
            type="button"
            class="profile-picker__option"
            :class="{ 'profile-picker__option--active': form.profile === 'STAFF' }"
            @click="onProfileChange('STAFF')"
          >
            <Briefcase :size="18" />
            <span class="profile-picker__label">Personnel</span>
            <span class="profile-picker__hint">Administration, technique, accueil…</span>
          </button>
          <button
            type="button"
            class="profile-picker__option"
            :class="{ 'profile-picker__option--active': form.profile === 'MEDECIN' }"
            @click="onProfileChange('MEDECIN')"
          >
            <Stethoscope :size="18" />
            <span class="profile-picker__label">Médecin</span>
            <span class="profile-picker__hint">Consultations et rémunération</span>
          </button>
        </div>

        <label class="status-toggle">
          <input v-model="form.active" type="checkbox" class="status-toggle__input" />
          <span class="status-toggle__box" aria-hidden="true" />
          <span class="status-toggle__text">
            <strong>Employé actif</strong>
            <small>Les employés inactifs restent dans le registre mais ne sont plus proposés</small>
          </span>
        </label>
      </section>

      <section v-if="isMedecinProfile" class="form-panel form-panel--accent">
        <h3 class="form-panel__title">
          <span class="form-panel__step">3</span>
          <Banknote :size="15" />
          Rémunération consultations
        </h3>
        <p class="form-panel__intro">
          Définit le tarif affiché à la réception et la part reversée au médecin.
        </p>

        <div class="comp-type-picker" role="radiogroup" aria-label="Type de rémunération">
          <button
            v-for="option in DOCTOR_COMPENSATION_OPTIONS"
            :key="option.value"
            type="button"
            class="comp-type-picker__option"
            :class="{ 'comp-type-picker__option--active': form.doctorCompensationType === option.value }"
            @click="onDoctorCompensationTypeChange(option.value)"
          >
            <strong>{{ option.label }}</strong>
            <span>{{ option.hint }}</span>
          </button>
        </div>

        <div v-if="form.doctorCompensationType === 'FIXED_SALARY'" class="info-callout">
          <Info :size="16" />
          <p>
            Renseignez le salaire mensuel ci-dessous. Le montant de chaque consultation sera saisi
            manuellement à la réception — aucun tarif fixe ni validité n'est appliqué automatiquement.
          </p>
        </div>

        <div v-else class="info-callout">
          <Info :size="16" />
          <p>
            Rémunération par quota sur les consultations : aucun salaire fixe mensuel n'est demandé.
          </p>
        </div>

        <template v-if="form.doctorCompensationType === 'QUOTA'">
          <div class="form-grid-compact">
            <UiInput
              v-model="form.consultationTotalFcfa"
              label="Prix (FCFA)"
              type="number"
              min="1"
              placeholder="5000"
              required
            />
            <UiSelect v-model="form.consultationQuotaMode" label="Mode part">
              <option
                v-for="option in CONSULTATION_QUOTA_MODE_OPTIONS"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </UiSelect>
            <UiInput
              v-if="form.consultationQuotaMode === 'PERCENT'"
              v-model="form.consultationQuotaPercent"
              label="Part (%)"
              type="number"
              min="1"
              max="99"
              placeholder="60"
            />
            <UiInput
              v-else
              v-model="form.consultationQuotaFcfa"
              label="Part (FCFA)"
              type="number"
              min="1"
              placeholder="3000"
            />
            <UiSelect v-model="form.consultationValidityDays" label="Validité" required>
              <option
                v-for="option in CONSULTATION_VALIDITY_OPTIONS"
                :key="option.value"
                :value="String(option.value)"
              >
                {{ option.label }}
              </option>
            </UiSelect>
          </div>

          <div class="form-grid-compact form-grid-compact--2">
            <UiSelect v-model="form.consultationRenewalPolicy" label="Après expiration">
              <option
                v-for="option in CONSULTATION_RENEWAL_POLICY_OPTIONS"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </UiSelect>
          </div>

          <p v-if="renewalPolicyHint" class="form-panel__hint">{{ renewalPolicyHint }}</p>

          <div v-if="compensationSplit" class="comp-preview">
            <div class="comp-preview__row">
              <span>Patient paie</span>
              <strong>{{ formatFcfa(Number(form.consultationTotalFcfa)) }}</strong>
            </div>
            <div class="comp-preview__row comp-preview__row--doctor">
              <span>
                Part médecin
                <em>({{ formatDoctorQuotaShare(previewDoctor) }})</em>
              </span>
              <strong>{{ formatFcfa(compensationSplit.doctorShareFcfa) }}</strong>
            </div>
            <div class="comp-preview__row comp-preview__row--clinic">
              <span>Part clinique</span>
              <strong>{{ formatFcfa(compensationSplit.clinicShareFcfa) }}</strong>
            </div>
            <p v-if="quotaPreviewHint" class="comp-preview__footnote">{{ quotaPreviewHint }}</p>
          </div>
        </template>
      </section>

      <section
        v-if="showSalaryField && !showPayrollSection"
        class="form-panel form-panel--accent"
      >
        <h3 class="form-panel__title">
          <span class="form-panel__step">{{ salaryStepNumber }}</span>
          <Banknote :size="15" />
          Salaire
        </h3>
        <p class="form-panel__intro">
          Salaire fixe mensuel — utilisé pour la paie
          {{ isMedecinProfile ? ' (médecin en rémunération fixe)' : '' }}.
        </p>
        <UiInput
          v-model="form.fixedSalaryFcfa"
          label="Salaire fixe (FCFA)"
          type="number"
          min="0"
          placeholder="Ex. 150 000"
        />
        <div v-if="salaryPreview" class="comp-preview">
          <div class="comp-preview__row">
            <span>Salaire mensuel</span>
            <strong>{{ formatFcfa(salaryPreview.base) }}</strong>
          </div>
        </div>
      </section>

      <section
        v-if="showPayrollSection"
        class="form-panel gestionnaire-form-panel gestionnaire-form-panel--accent"
      >
        <h3 class="form-panel__title">
          <span class="form-panel__step">{{ payrollStepNumber }}</span>
          <Banknote :size="15" />
          {{ showSalaryField ? 'Salaire & contrat' : 'Contrat' }}
        </h3>
        <p class="form-panel__intro">
          <template v-if="showSalaryField">
            Salaire fixe mensuel, prime et situation contractuelle — utilisés pour la paie.
          </template>
          <template v-else>
            Situation contractuelle — la rémunération se fait par quota sur les consultations.
          </template>
        </p>

        <UiInput
          v-model="form.service"
          label="Service"
          placeholder="Ex. Laboratoire"
          :icon="Building2"
          list="employee-service-suggestions"
        />
        <datalist id="employee-service-suggestions">
          <option v-for="service in SERVICE_SUGGESTIONS" :key="service" :value="service" />
        </datalist>

        <div v-if="showSalaryField" class="form-grid-2">
          <UiInput
            v-model="form.fixedSalaryFcfa"
            label="Salaire fixe (FCFA)"
            type="number"
            min="0"
            placeholder="Ex. 150 000"
          />
          <UiInput
            v-model="form.bonusFcfa"
            label="Prime (FCFA)"
            type="number"
            min="0"
            placeholder="Ex. 25 000"
          />
        </div>

        <div v-if="salaryPreview" class="gestionnaire-preview-box">
          <div v-if="salaryPreview.base > 0" class="gestionnaire-preview-box__row">
            <span>Salaire fixe</span>
            <strong>{{ formatFcfa(salaryPreview.base) }}</strong>
          </div>
          <div v-if="salaryPreview.bonus > 0" class="gestionnaire-preview-box__row">
            <span>Prime</span>
            <strong>{{ formatFcfa(salaryPreview.bonus) }}</strong>
          </div>
          <div class="gestionnaire-preview-box__row gestionnaire-preview-box__row--total">
            <span>Total indicatif</span>
            <strong>{{ formatFcfa(salaryPreview.total) }}</strong>
          </div>
        </div>

        <p class="form-panel__intro">Type de contrat</p>
        <div class="gestionnaire-chips" role="radiogroup" aria-label="Type de contrat">
          <button
            v-for="option in CONTRACT_TYPE_OPTIONS"
            :key="option.value"
            type="button"
            class="gestionnaire-chips__item"
            :class="{ 'gestionnaire-chips__item--active': form.contractType === option.value }"
            @click="form.contractType = option.value"
          >
            {{ option.label }}
          </button>
        </div>

        <p class="form-panel__intro">Statut dans l'effectif</p>
        <div class="gestionnaire-payment-methods" role="radiogroup" aria-label="Statut du contrat">
          <button
            v-for="option in CONTRACT_STATUS_OPTIONS"
            :key="option.value"
            type="button"
            class="gestionnaire-payment-methods__option"
            :class="{ 'gestionnaire-payment-methods__option--active': form.contractStatus === option.value }"
            @click="form.contractStatus = option.value"
          >
            <component :is="option.icon" :size="18" />
            <span class="gestionnaire-payment-methods__label">{{ option.label }}</span>
            <span class="form-panel__hint">{{ option.hint }}</span>
          </button>
        </div>
      </section>

      <template #footer>
        <UiButton variant="ghost" @click="closeModal">Annuler</UiButton>
        <UiButton
          variant="primary"
          :icon="Save"
          :disabled="saving || !canSaveEmployee"
          @click="saveEmployee"
        >
          {{ saving ? 'Enregistrement…' : editingId ? 'Mettre à jour' : 'Créer l\'employé' }}
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.employee-hero {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.1rem;
  border-radius: 14px;
  background: linear-gradient(135deg, #f4f6ef 0%, #e8edd8 55%, #fff 100%);
  border: 1px solid rgba(107, 124, 62, 0.22);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.employee-hero--doctor {
  background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 50%, #fff 100%);
  border-color: rgba(13, 148, 136, 0.25);
}

.employee-hero__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.5rem;
  height: 3.5rem;
  flex-shrink: 0;
  border-radius: 14px;
  background: linear-gradient(145deg, var(--primary-500), var(--primary-700));
  color: #fff;
  font-size: 1.125rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  box-shadow: 0 6px 18px rgba(90, 104, 51, 0.3);
}

.employee-hero--doctor .employee-hero__avatar {
  background: linear-gradient(145deg, #14b8a6, #0d9488);
  box-shadow: 0 6px 18px rgba(13, 148, 136, 0.28);
}

.employee-hero__eyebrow {
  margin: 0 0 0.15rem;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--primary-700);
}

.employee-hero--doctor .employee-hero__eyebrow {
  color: #0f766e;
}

.employee-hero__name {
  display: block;
  font-size: 1.05rem;
  color: var(--primary-900, #2d3319);
  line-height: 1.3;
}

.employee-hero__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.35rem;
}

.employee-hero__badge {
  display: inline-flex;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: rgba(107, 124, 62, 0.12);
  color: var(--primary-800);
  font-size: 0.6875rem;
  font-weight: 700;
}

.employee-hero--doctor .employee-hero__badge {
  background: rgba(13, 148, 136, 0.12);
  color: #0f766e;
}

.employee-hero__badge--muted {
  background: rgba(15, 23, 42, 0.06);
  color: var(--text-muted);
  font-weight: 600;
}

.employee-form-modal :deep(.form-panel__title) {
  gap: 0.35rem;
}

.form-panel__step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 999px;
  background: var(--primary-600);
  color: #fff;
  font-size: 0.625rem;
  font-weight: 800;
  letter-spacing: 0;
}

.empty {
  text-align: center;
  color: var(--text-light);
  padding: 1.25rem 0.75rem;
  font-size: 0.8125rem;
}

.profile-picker {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
}

.profile-picker__option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  padding: 0.85rem 0.9rem;
  border: 2px solid var(--border);
  border-radius: 11px;
  background: var(--surface-muted, #f4f6ef);
  color: var(--text-muted);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease,
    color 0.15s ease;
}

.profile-picker__option:hover {
  border-color: rgba(107, 124, 62, 0.45);
  color: var(--primary-800);
}

.profile-picker__option--active {
  border-color: var(--primary-500);
  background: #fff;
  color: var(--primary-800);
  box-shadow: 0 0 0 1px rgba(107, 124, 62, 0.15);
}

.profile-picker__label {
  font-size: 0.875rem;
  font-weight: 800;
}

.profile-picker__hint {
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.35;
  opacity: 0.9;
}

.status-toggle {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  padding: 0.75rem 0.85rem;
  border-radius: 10px;
  background: var(--surface-muted, #f4f6ef);
  border: 1px solid var(--border);
  cursor: pointer;
}

.status-toggle__input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.status-toggle__box {
  width: 1.15rem;
  height: 1.15rem;
  margin-top: 0.1rem;
  flex-shrink: 0;
  border: 2px solid var(--border);
  border-radius: 4px;
  background: #fff;
  position: relative;
}

.status-toggle__input:checked + .status-toggle__box {
  border-color: var(--primary-600);
  background: var(--primary-600);
}

.status-toggle__input:checked + .status-toggle__box::after {
  content: '';
  position: absolute;
  left: 0.2rem;
  top: 0.02rem;
  width: 0.3rem;
  height: 0.55rem;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.status-toggle__text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.status-toggle__text strong {
  font-size: 0.8125rem;
  color: var(--text);
}

.status-toggle__text small {
  font-size: 0.6875rem;
  color: var(--text-muted);
  line-height: 1.35;
}

.comp-type-picker {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
}

.comp-type-picker__option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  padding: 0.8rem 0.9rem;
  border: 2px solid var(--border);
  border-radius: 10px;
  background: #fff;
  color: var(--text-muted);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.comp-type-picker__option strong {
  font-size: 0.8125rem;
  color: var(--text);
}

.comp-type-picker__option span {
  font-size: 0.6875rem;
  line-height: 1.35;
}

.comp-type-picker__option--active {
  border-color: var(--primary-500);
  box-shadow: 0 0 0 1px rgba(107, 124, 62, 0.12);
}

.comp-type-picker__option--active strong {
  color: var(--primary-800);
}

.info-callout {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.75rem 0.85rem;
  border-radius: 10px;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.18);
  color: #1e3a5f;
}

.info-callout p {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.45;
}

.comp-preview {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.85rem 0.95rem;
  border-radius: 10px;
  background: #fff;
  border: 1px dashed rgba(107, 124, 62, 0.35);
}

.comp-preview__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.comp-preview__row strong {
  font-size: 0.9375rem;
  color: var(--text);
}

.comp-preview__row em {
  font-style: normal;
  font-size: 0.6875rem;
  color: var(--text-light);
}

.comp-preview__row--doctor strong {
  color: var(--primary-700);
}

.comp-preview__row--clinic strong {
  color: var(--brand-red-700);
}

.comp-preview__footnote {
  margin: 0.25rem 0 0;
  padding-top: 0.45rem;
  border-top: 1px solid var(--border);
  font-size: 0.6875rem;
  color: var(--text-muted);
  line-height: 1.4;
}

@media (max-width: 700px) {
  .profile-picker,
  .comp-type-picker {
    grid-template-columns: 1fr;
  }
}
</style>
