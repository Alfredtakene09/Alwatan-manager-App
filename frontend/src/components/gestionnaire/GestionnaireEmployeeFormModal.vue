<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  UserRound,
  Briefcase,
  Banknote,
  FileText,
  Phone,
  Building2,
  MapPin,
  CalendarDays,
  Save,
  UserCheck,
  Palmtree,
  UserX,
} from '@lucide/vue'
import { formatFcfa } from '@/lib/roles'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'

export type GestionnaireEmployeeFormPayload = {
  firstName: string
  lastName: string
  phone?: string
  jobTitle?: string
  service?: string
  address?: string
  birthDate?: string
  hiredAt?: string
  contractType?: string
  contractStatus: string
  fixedSalaryFcfa?: number
  bonusFcfa?: number
  active: boolean
}

export type GestionnaireEmployeeEdit = {
  id: string
  firstName: string
  lastName: string
  phone: string | null
  jobTitle: string | null
  service: string | null
  contractStatus: string
  fixedSalaryFcfa: number | null
  bonusFcfa: number | null
  active: boolean
}

const CONTRACT_TYPE_OPTIONS = [
  { value: 'CDI', label: 'CDI', hint: 'Contrat à durée indéterminée' },
  { value: 'CDD', label: 'CDD', hint: 'Contrat à durée déterminée' },
  { value: 'PRESTATION', label: 'Prestation', hint: 'Honoraires ou mission' },
  { value: 'AUTRE', label: 'Autre', hint: 'Autre modalité' },
] as const

const CONTRACT_STATUS_OPTIONS = [
  { value: 'ACTIF', label: 'Actif', hint: 'En poste au sein de la clinique', icon: UserCheck },
  { value: 'EN_CONGE', label: 'En congé', hint: 'Absence temporaire', icon: Palmtree },
  { value: 'INACTIF', label: 'Inactif', hint: 'Hors effectif actif', icon: UserX },
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

const props = defineProps<{
  open: boolean
  saving?: boolean
  employee?: GestionnaireEmployeeEdit | null
  errorMessage?: string
}>()

const emit = defineEmits<{
  close: []
  submit: [payload: GestionnaireEmployeeFormPayload]
}>()

function emptyForm() {
  return {
    firstName: '',
    lastName: '',
    phone: '',
    jobTitle: '',
    service: '',
    address: '',
    birthDate: '',
    hiredAt: new Date().toISOString().slice(0, 10),
    contractType: 'CDI' as string,
    contractStatus: 'ACTIF',
    fixedSalaryFcfa: '',
    bonusFcfa: '',
    active: true,
  }
}

const form = ref(emptyForm())
const localError = ref('')

watch(
  () => [props.open, props.employee] as const,
  ([isOpen, employee]) => {
    if (!isOpen) return
    localError.value = ''
    if (employee) {
      form.value = {
        firstName: employee.firstName,
        lastName: employee.lastName,
        phone: employee.phone ?? '',
        jobTitle: employee.jobTitle ?? '',
        service: employee.service ?? '',
        address: '',
        birthDate: '',
        hiredAt: new Date().toISOString().slice(0, 10),
        contractType: 'CDI',
        contractStatus: employee.contractStatus,
        fixedSalaryFcfa:
          employee.fixedSalaryFcfa != null ? String(employee.fixedSalaryFcfa) : '',
        bonusFcfa: employee.bonusFcfa != null ? String(employee.bonusFcfa) : '',
        active: employee.active,
      }
    } else {
      form.value = emptyForm()
    }
  },
  { immediate: true },
)

const isEditing = computed(() => Boolean(props.employee?.id))

const displayName = computed(() => {
  const parts = [form.value.firstName.trim(), form.value.lastName.trim()].filter(Boolean)
  return parts.length ? parts.join(' ') : null
})

const initials = computed(() => {
  const f = form.value.firstName.trim().charAt(0)
  const l = form.value.lastName.trim().charAt(0)
  if (f && l) return `${f}${l}`.toUpperCase()
  if (f) return f.toUpperCase()
  return '?'
})

const modalSubtitle = computed(() => {
  if (displayName.value) return displayName.value
  return 'Fiche RH — identité, poste, rémunération et contrat'
})

const salaryPreview = computed(() => {
  const base = Number(form.value.fixedSalaryFcfa)
  const bonus = Number(form.value.bonusFcfa)
  const hasBase = Number.isFinite(base) && base > 0
  const hasBonus = Number.isFinite(bonus) && bonus > 0
  if (!hasBase && !hasBonus) return null
  return {
    base: hasBase ? base : 0,
    bonus: hasBonus ? bonus : 0,
    total: (hasBase ? base : 0) + (hasBonus ? bonus : 0),
  }
})

const canSubmit = computed(() => {
  return form.value.firstName.trim().length >= 2 && form.value.lastName.trim().length >= 2
})

const alertMessage = computed(() => props.errorMessage || localError.value)

function submit() {
  if (!canSubmit.value) {
    localError.value = 'Le prénom et le nom doivent contenir au moins 2 caractères.'
    return
  }
  localError.value = ''
  const payload: GestionnaireEmployeeFormPayload = {
    firstName: form.value.firstName.trim(),
    lastName: form.value.lastName.trim(),
    phone: form.value.phone.trim() || undefined,
    jobTitle: form.value.jobTitle.trim() || undefined,
    service: form.value.service.trim() || undefined,
    address: form.value.address.trim() || undefined,
    birthDate: form.value.birthDate || undefined,
    hiredAt: form.value.hiredAt || undefined,
    contractType: form.value.contractType || undefined,
    contractStatus: form.value.contractStatus,
    active: form.value.active,
  }
  const salary = Number(form.value.fixedSalaryFcfa)
  if (Number.isFinite(salary) && salary >= 0) payload.fixedSalaryFcfa = salary
  const bonus = Number(form.value.bonusFcfa)
  if (Number.isFinite(bonus) && bonus >= 0) payload.bonusFcfa = bonus
  emit('submit', payload)
}
</script>

<template>
  <UiFormModal
    v-if="open"
    title-id="gestionnaire-employee-modal-title"
    :title="isEditing ? 'Modifier l\'employé' : 'Nouvel employé'"
    :subtitle="modalSubtitle"
    :icon="UserRound"
    size="large"
    class="gestionnaire-employee-modal"
    @close="emit('close')"
  >
    <div class="gestionnaire-modal-hero gestionnaire-modal-hero--center employee-hero">
      <div class="employee-hero__avatar" aria-hidden="true">{{ initials }}</div>
      <div class="employee-hero__content">
        <p class="gestionnaire-modal-hero__eyebrow">{{ isEditing ? 'Mise à jour fiche' : 'Nouvelle fiche personnel' }}</p>
        <strong class="gestionnaire-modal-hero__title">{{ displayName ?? 'Nom à renseigner' }}</strong>
        <p v-if="form.jobTitle.trim()" class="gestionnaire-modal-hero__meta">{{ form.jobTitle.trim() }}</p>
        <p v-else class="gestionnaire-modal-hero__meta gestionnaire-modal-hero__meta--muted">Poste non renseigné</p>
      </div>
    </div>

    <UiAlert v-if="alertMessage" type="error" :message="alertMessage" />

    <section class="form-panel gestionnaire-form-panel">
      <h3 class="form-panel__title">
        <UserRound :size="15" />
        Identité
      </h3>
      <div class="form-grid-2">
        <UiInput
          v-model="form.firstName"
          label="Prénom"
          required
          placeholder="Ex. Hassan"
          autocomplete="given-name"
        />
        <UiInput
          v-model="form.lastName"
          label="Nom"
          required
          placeholder="Ex. Mahamat"
          autocomplete="family-name"
        />
      </div>
      <div class="form-grid-2">
        <UiInput
          v-model="form.phone"
          label="Téléphone"
          placeholder="Ex. +235 6x xx xx xx"
          :icon="Phone"
          autocomplete="tel"
        />
        <UiInput
          v-model="form.birthDate"
          label="Date de naissance"
          type="date"
          :icon="CalendarDays"
        />
      </div>
      <UiInput
        v-model="form.address"
        label="Adresse (optionnel)"
        placeholder="Quartier, ville…"
        :icon="MapPin"
      />
    </section>

    <section class="form-panel gestionnaire-form-panel">
      <h3 class="form-panel__title">
        <Briefcase :size="15" />
        Poste &amp; service
      </h3>
      <div class="form-grid-2">
        <UiInput
          v-model="form.jobTitle"
          label="Poste / fonction"
          placeholder="Ex. Infirmier(ère), Agent d'accueil…"
          :icon="Briefcase"
        />
        <UiInput
          v-model="form.service"
          label="Service"
          placeholder="Ex. Laboratoire"
          :icon="Building2"
          list="gestionnaire-service-suggestions"
        />
      </div>
      <datalist id="gestionnaire-service-suggestions">
        <option v-for="service in SERVICE_SUGGESTIONS" :key="service" :value="service" />
      </datalist>
      <UiInput
        v-model="form.hiredAt"
        label="Date d'embauche"
        type="date"
        :icon="CalendarDays"
      />
    </section>

    <section class="form-panel gestionnaire-form-panel gestionnaire-form-panel--accent">
      <h3 class="form-panel__title">
        <Banknote :size="15" />
        Rémunération
      </h3>
      <p class="form-panel__intro">
        Salaire fixe mensuel et prime éventuelle — utilisés pour la paie et les rapports financiers.
      </p>
      <div class="form-grid-2">
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
        <div class="gestionnaire-preview-box__row">
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
    </section>

    <section class="form-panel gestionnaire-form-panel">
      <h3 class="form-panel__title">
        <FileText :size="15" />
        Contrat
      </h3>

      <p class="form-panel__intro">Type de contrat et situation dans l'effectif.</p>

      <div class="contract-type-chips" role="radiogroup" aria-label="Type de contrat">
        <button
          v-for="option in CONTRACT_TYPE_OPTIONS"
          :key="option.value"
          type="button"
          class="contract-type-chips__item"
          :class="{ 'contract-type-chips__item--active': form.contractType === option.value }"
          :title="option.hint"
          @click="form.contractType = option.value"
        >
          {{ option.label }}
        </button>
      </div>

      <div class="status-picker" role="radiogroup" aria-label="Statut du contrat">
        <button
          v-for="option in CONTRACT_STATUS_OPTIONS"
          :key="option.value"
          type="button"
          class="status-picker__option"
          :class="{ 'status-picker__option--active': form.contractStatus === option.value }"
          @click="form.contractStatus = option.value"
        >
          <component :is="option.icon" :size="18" />
          <span class="status-picker__label">{{ option.label }}</span>
          <span class="status-picker__hint">{{ option.hint }}</span>
        </button>
      </div>

      <label class="active-toggle">
        <input v-model="form.active" type="checkbox" class="active-toggle__input" />
        <span class="active-toggle__track" aria-hidden="true">
          <span class="active-toggle__thumb" />
        </span>
        <span class="active-toggle__text">
          <strong>Fiche active</strong>
          <small>Les fiches inactives restent archivées mais ne sont plus proposées à la paie</small>
        </span>
      </label>
    </section>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Annuler</UiButton>
      <UiButton variant="primary" :icon="Save" :disabled="saving || !canSubmit" @click="submit">
        {{ saving ? 'Enregistrement…' : isEditing ? 'Mettre à jour' : 'Créer l\'employé' }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.employee-hero {
  margin-bottom: 0;
}

.employee-hero__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.5rem;
  height: 3.5rem;
  flex-shrink: 0;
  border-radius: 14px;
  background: linear-gradient(145deg, #f59e0b, #d97706);
  color: #fff;
  font-size: 1.125rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  box-shadow: 0 6px 18px rgba(217, 119, 6, 0.35);
}

.employee-hero__content {
  min-width: 0;
}

.contract-type-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.contract-type-chips__item {
  padding: 0.4rem 0.75rem;
  border: 2px solid rgba(217, 119, 6, 0.2);
  border-radius: 999px;
  background: #fff;
  color: #92400e;
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.contract-type-chips__item:hover {
  border-color: rgba(217, 119, 6, 0.45);
}

.contract-type-chips__item--active {
  border-color: #d97706;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
}

.status-picker {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.55rem;
}

.status-picker__option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  padding: 0.75rem 0.8rem;
  border: 2px solid rgba(217, 119, 6, 0.18);
  border-radius: 11px;
  background: #fff;
  color: #78716c;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease;
}

.status-picker__option:hover {
  border-color: rgba(217, 119, 6, 0.4);
  color: #92400e;
}

.status-picker__option--active {
  border-color: #d97706;
  background: #fffbeb;
  color: #92400e;
  box-shadow: 0 0 0 1px rgba(217, 119, 6, 0.12);
}

.status-picker__label {
  font-size: 0.8125rem;
  font-weight: 800;
}

.status-picker__hint {
  font-size: 0.625rem;
  line-height: 1.35;
  opacity: 0.9;
}

.active-toggle {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem 0.85rem;
  border-radius: 10px;
  background: #fffbeb;
  border: 1px solid rgba(217, 119, 6, 0.18);
  cursor: pointer;
}

.active-toggle__input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.active-toggle__track {
  position: relative;
  width: 2.4rem;
  height: 1.35rem;
  margin-top: 0.1rem;
  flex-shrink: 0;
  border-radius: 999px;
  background: #d6d3d1;
  transition: background 0.2s ease;
}

.active-toggle__thumb {
  position: absolute;
  top: 0.15rem;
  left: 0.15rem;
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  transition: transform 0.2s ease;
}

.active-toggle__input:checked + .active-toggle__track {
  background: linear-gradient(135deg, #f59e0b, #d97706);
}

.active-toggle__input:checked + .active-toggle__track .active-toggle__thumb {
  transform: translateX(1.05rem);
}

.active-toggle__text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.active-toggle__text strong {
  font-size: 0.8125rem;
  color: #44403c;
}

.active-toggle__text small {
  font-size: 0.6875rem;
  color: #78716c;
  line-height: 1.35;
}

@media (max-width: 700px) {
  .status-picker {
    grid-template-columns: 1fr;
  }
}
</style>
