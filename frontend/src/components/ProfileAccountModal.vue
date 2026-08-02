<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import axios from 'axios'
import { UserRound, Save, KeyRound, Shield, AtSign } from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { fullName, type AppUserRole } from '@/lib/roles'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const auth = useAuthStore()
const { uiText, roleLabel } = useAppI18n()

const profileForm = ref({
  firstName: '',
  lastName: '',
  username: '',
})

const passwordForm = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const saving = ref(false)
const formError = ref('')

const initials = computed(() => {
  if (!auth.user) return '?'
  return `${auth.user.firstName[0] ?? ''}${auth.user.lastName[0] ?? ''}`.toUpperCase()
})

const displayName = computed(() =>
  auth.user ? fullName(auth.user.firstName, auth.user.lastName) : '—',
)

const translatedRole = computed(() =>
  auth.user ? roleLabel(auth.user.role as AppUserRole) : '',
)

const roleAccent = computed(() => {
  const role = auth.user?.role as AppUserRole | undefined
  const map: Partial<Record<AppUserRole, string>> = {
    ADMIN: '#7c3aed',
    GESTIONNAIRE: '#d97706',
    COMPTABLE: '#2563eb',
    RECEPTIONNISTE: '#0d9488',
    MEDECIN: '#059669',
    LABORANTIN: '#0891b2',
    PHARMACIEN: '#db2777',
    LOGISTIQUE: '#4f46e5',
    SOIGNANT: '#ea580c',
  }
  return role ? map[role] ?? 'var(--primary-600)' : 'var(--primary-600)'
})

const wantsPasswordChange = computed(() => {
  const { currentPassword, newPassword, confirmPassword } = passwordForm.value
  return Boolean(currentPassword || newPassword || confirmPassword)
})

const canSave = computed(() => {
  const username = profileForm.value.username.trim()
  const profileOk =
    profileForm.value.firstName.trim().length >= 2 &&
    profileForm.value.lastName.trim().length >= 2 &&
    username.length >= 2 &&
    /^[a-zA-Z0-9._-]+$/.test(username)

  if (!profileOk) return false
  if (!wantsPasswordChange.value) return true

  return (
    passwordForm.value.currentPassword.length >= 4 &&
    passwordForm.value.newPassword.length >= 6 &&
    passwordForm.value.newPassword === passwordForm.value.confirmPassword
  )
})

function resetForms() {
  if (!auth.user) return
  profileForm.value = {
    firstName: auth.user.firstName,
    lastName: auth.user.lastName,
    username: auth.user.username ?? '',
  }
  passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
  formError.value = ''
}

function closeModal() {
  resetForms()
  emit('close')
}

watch(
  () => props.open,
  (open) => {
    if (open) resetForms()
  },
)

async function saveAll() {
  formError.value = ''

  if (!canSave.value) {
    if (wantsPasswordChange.value) {
      if (passwordForm.value.newPassword !== passwordForm.value.confirmPassword) {
        formError.value = 'Les mots de passe ne correspondent pas.'
        return
      }
      formError.value = 'Vérifiez les champs du mot de passe.'
      return
    }
    formError.value = "Vérifiez le prénom, le nom et le nom d'utilisateur."
    return
  }

  saving.value = true
  try {
    const { data } = await api.patch<{ user: typeof auth.user }>('/auth/profile', {
      firstName: profileForm.value.firstName.trim(),
      lastName: profileForm.value.lastName.trim(),
      username: profileForm.value.username.trim(),
    })
    if (data.user) auth.user = data.user

    if (wantsPasswordChange.value) {
      await api.patch('/auth/password', {
        currentPassword: passwordForm.value.currentPassword,
        newPassword: passwordForm.value.newPassword,
      })
      passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
    }

    closeModal()
  } catch (error) {
    formError.value =
      axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
        ? error.response.data.error
        : 'Enregistrement impossible.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiFormModal
    :open="open"
    title-id="profile-account-modal-title"
    title="Mon compte"
    :icon="UserRound"
    size="wide"
    @close="closeModal"
  >
    <div v-if="auth.user" class="profile-modal">
      <div class="profile-modal__identity" :style="{ '--role-accent': roleAccent }">
        <div class="profile-modal__avatar">
          <span>{{ initials }}</span>
        </div>
        <div>
          <strong class="profile-modal__name">{{ displayName }}</strong>
          <div class="profile-modal__chips">
            <span class="profile-chip profile-chip--role">
              <Shield :size="12" />
              {{ translatedRole }}
            </span>
            <span class="profile-chip profile-chip--user">
              <AtSign :size="12" />
              {{ auth.user.username || auth.user.email }}
            </span>
          </div>
        </div>
      </div>

      <UiAlert v-if="formError" type="error" :message="formError" />

      <div class="profile-modal__fields">
        <div class="form-grid-2">
          <UiInput
            v-model="profileForm.firstName"
            label="Prénom"
            required
            autocomplete="given-name"
          />
          <UiInput
            v-model="profileForm.lastName"
            label="Nom"
            required
            autocomplete="family-name"
          />
        </div>
        <UiInput
          v-model="profileForm.username"
          label="Nom d'utilisateur"
          required
          :icon="AtSign"
          autocomplete="username"
        />
      </div>

      <div class="profile-modal__divider">
        <KeyRound :size="14" />
        <span>{{ uiText('Mot de passe') }}</span>
        <span class="profile-modal__optional">{{ uiText('(optionnel)') }}</span>
      </div>

      <div class="profile-modal__fields">
        <UiInput
          v-model="passwordForm.currentPassword"
          label="Mot de passe actuel"
          type="password"
          revealable
          :icon="KeyRound"
          autocomplete="current-password"
        />
        <div class="form-grid-2">
          <UiInput
            v-model="passwordForm.newPassword"
            label="Nouveau mot de passe"
            type="password"
            revealable
            autocomplete="new-password"
          />
          <UiInput
            v-model="passwordForm.confirmPassword"
            label="Confirmer le mot de passe"
            type="password"
            revealable
            autocomplete="new-password"
          />
        </div>
      </div>
    </div>

    <template #footer>
      <UiButton variant="ghost" :disabled="saving" @click="closeModal">Annuler</UiButton>
      <UiButton
        variant="primary"
        :icon="Save"
        :disabled="saving || !canSave"
        @click="saveAll"
      >
        {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.profile-modal {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.profile-modal__identity {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: linear-gradient(135deg, #f4f6ef 0%, #eef2e8 100%);
  border: 1px solid rgba(107, 124, 62, 0.16);
}

.profile-modal__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.1rem;
  height: 3.1rem;
  flex-shrink: 0;
  border-radius: 14px;
  background: linear-gradient(145deg, var(--primary-500), var(--primary-700));
  color: #fff;
  font-size: 1.05rem;
  font-weight: 800;
  box-shadow: 0 4px 14px rgba(107, 124, 62, 0.25);
  outline: 2px solid color-mix(in srgb, var(--role-accent) 45%, transparent);
  outline-offset: 2px;
}

.profile-modal__name {
  display: block;
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.02em;
}

.profile-modal__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.35rem;
}

.profile-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  padding: 0.24rem 0.5rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
}

.profile-chip--role {
  color: var(--role-accent);
  background: color-mix(in srgb, var(--role-accent) 12%, white);
  border: 1px solid color-mix(in srgb, var(--role-accent) 24%, transparent);
}

.profile-chip--user {
  color: #57534e;
  background: #f5f5f4;
  border: 1px solid rgba(15, 23, 42, 0.08);
}

.profile-modal__fields {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.profile-modal__divider {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.15rem;
  padding-top: 0.85rem;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--text);
}

.profile-modal__optional {
  font-weight: 500;
  color: var(--text-muted);
}

@media (max-width: 640px) {
  .profile-modal__identity {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
