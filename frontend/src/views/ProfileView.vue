<script setup lang="ts">
import { computed, ref } from 'vue'
import axios from 'axios'
import {
  UserRound,
  Save,
  KeyRound,
  Mail,
  Shield,
  User,
  Lock,
  CheckCircle2,
  AtSign,
} from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { fullName, ROLE_LABELS, type AppUserRole } from '@/lib/roles'
import { showSuccessModal } from '@/lib/api-modal-helper'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'

const auth = useAuthStore()

const profileForm = ref({
  firstName: auth.user?.firstName ?? '',
  lastName: auth.user?.lastName ?? '',
  email: auth.user?.email ?? '',
})

const passwordForm = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const profileSaving = ref(false)
const passwordSaving = ref(false)
const profileError = ref('')
const passwordError = ref('')
const profileSuccess = ref('')

const initials = computed(() => {
  if (!auth.user) return '?'
  return `${auth.user.firstName[0] ?? ''}${auth.user.lastName[0] ?? ''}`.toUpperCase()
})

const displayName = computed(() =>
  auth.user ? fullName(auth.user.firstName, auth.user.lastName) : '—',
)

const roleLabel = computed(() =>
  auth.user ? ROLE_LABELS[auth.user.role] : '',
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
    SOIGNANT: '#ea580c',
  }
  return role ? map[role] ?? 'var(--primary-600)' : 'var(--primary-600)'
})

const passwordMatch = computed(
  () =>
    passwordForm.value.newPassword.length > 0 &&
    passwordForm.value.newPassword === passwordForm.value.confirmPassword,
)

const canSaveProfile = computed(() => {
  return (
    profileForm.value.firstName.trim().length >= 2 &&
    profileForm.value.lastName.trim().length >= 2 &&
    profileForm.value.email.trim().length > 0
  )
})

const canSavePassword = computed(() => {
  return (
    passwordForm.value.currentPassword.length >= 4 &&
    passwordForm.value.newPassword.length >= 6 &&
    passwordForm.value.newPassword === passwordForm.value.confirmPassword
  )
})

function resetProfileForm() {
  if (!auth.user) return
  profileForm.value = {
    firstName: auth.user.firstName,
    lastName: auth.user.lastName,
    email: auth.user.email,
  }
  profileError.value = ''
  profileSuccess.value = ''
}

async function saveProfile() {
  if (!canSaveProfile.value) {
    profileError.value = 'Vérifiez le prénom, le nom et l\'e-mail.'
    return
  }
  profileSaving.value = true
  profileError.value = ''
  profileSuccess.value = ''
  try {
    const { data } = await api.patch<{ user: typeof auth.user }>('/auth/profile', {
      firstName: profileForm.value.firstName.trim(),
      lastName: profileForm.value.lastName.trim(),
      email: profileForm.value.email.trim(),
    })
    if (data.user) auth.user = data.user
    profileSuccess.value = 'Profil mis à jour avec succès.'
  } catch (error) {
    profileError.value =
      axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
        ? error.response.data.error
        : 'Mise à jour impossible.'
  } finally {
    profileSaving.value = false
  }
}

async function savePassword() {
  passwordError.value = ''
  if (passwordForm.value.newPassword !== passwordForm.value.confirmPassword) {
    passwordError.value = 'Les mots de passe ne correspondent pas.'
    return
  }
  if (!canSavePassword.value) {
    passwordError.value = 'Vérifiez les champs mot de passe.'
    return
  }
  passwordSaving.value = true
  try {
    await api.patch('/auth/password', {
      currentPassword: passwordForm.value.currentPassword,
      newPassword: passwordForm.value.newPassword,
    })
    passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
    await showSuccessModal('Mot de passe modifié', 'Votre mot de passe a été mis à jour.')
  } catch (error) {
    passwordError.value =
      axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
        ? error.response.data.error
        : 'Modification impossible.'
  } finally {
    passwordSaving.value = false
  }
}

resetProfileForm()
</script>

<template>
  <div class="profile-page">
    <header class="profile-hero">
      <div class="profile-hero__glow" aria-hidden="true" />
      <div class="profile-hero__content">
        <div class="profile-hero__top">
          <div class="profile-hero__icon-wrap" aria-hidden="true">
            <UserRound :size="26" />
          </div>
          <div class="profile-hero__titles">
            <p class="profile-hero__eyebrow">Espace personnel</p>
            <h1 class="profile-hero__title">Mon compte</h1>
            <p class="profile-hero__subtitle">
              Gérez votre identité et vos identifiants de connexion
            </p>
          </div>
        </div>

        <div v-if="auth.user" class="profile-identity">
          <div class="profile-identity__avatar" :style="{ '--role-accent': roleAccent }">
            <span>{{ initials }}</span>
            <span class="profile-identity__ring" aria-hidden="true" />
          </div>
          <div class="profile-identity__body">
            <strong class="profile-identity__name">{{ displayName }}</strong>
            <div class="profile-identity__chips">
              <span class="profile-chip profile-chip--role" :style="{ '--chip-color': roleAccent }">
                <Shield :size="12" />
                {{ roleLabel }}
              </span>
              <span class="profile-chip profile-chip--email">
                <AtSign :size="12" />
                {{ auth.user.email }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>

    <div class="profile-grid">
      <section class="profile-panel">
        <div class="profile-panel__head">
          <div class="profile-panel__icon profile-panel__icon--identity">
            <User :size="18" />
          </div>
          <div>
            <h2 class="profile-panel__title">Informations personnelles</h2>
            <p class="profile-panel__desc">Nom affiché dans l'application et adresse de connexion</p>
          </div>
        </div>

        <UiAlert v-if="profileError" type="error" :message="profileError" />
        <div v-if="profileSuccess" class="profile-success">
          <CheckCircle2 :size="16" />
          {{ profileSuccess }}
        </div>

        <div class="profile-fields">
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
            v-model="profileForm.email"
            label="Adresse e-mail (identifiant)"
            type="email"
            required
            :icon="Mail"
            autocomplete="username"
          />

          <p v-if="auth.user" class="profile-hint">
            <Shield :size="14" />
            Le rôle <strong>{{ roleLabel }}</strong> est attribué par l'administration et ne peut pas être modifié ici.
          </p>
        </div>

        <div class="profile-panel__footer">
          <UiButton variant="ghost" @click="resetProfileForm">Annuler</UiButton>
          <UiButton
            variant="primary"
            :icon="Save"
            :disabled="profileSaving || !canSaveProfile"
            @click="saveProfile"
          >
            {{ profileSaving ? 'Enregistrement…' : 'Enregistrer le profil' }}
          </UiButton>
        </div>
      </section>

      <section class="profile-panel profile-panel--security">
        <div class="profile-panel__head">
          <div class="profile-panel__icon profile-panel__icon--security">
            <Lock :size="18" />
          </div>
          <div>
            <h2 class="profile-panel__title">Mot de passe</h2>
            <p class="profile-panel__desc">Sécurisez votre accès à la clinique</p>
          </div>
        </div>

        <UiAlert v-if="passwordError" type="error" :message="passwordError" />

        <div class="profile-fields">
          <UiInput
            v-model="passwordForm.currentPassword"
            label="Mot de passe actuel"
            type="password"
            required
            :icon="KeyRound"
            autocomplete="current-password"
          />
          <div class="form-grid-2">
            <UiInput
              v-model="passwordForm.newPassword"
              label="Nouveau mot de passe"
              type="password"
              required
              autocomplete="new-password"
            />
            <UiInput
              v-model="passwordForm.confirmPassword"
              label="Confirmer le mot de passe"
              type="password"
              required
              autocomplete="new-password"
            />
          </div>

          <ul class="profile-security-tips">
            <li :class="{ 'profile-security-tips__item--ok': passwordForm.newPassword.length >= 6 }">
              Au moins 6 caractères
            </li>
            <li :class="{ 'profile-security-tips__item--ok': passwordMatch }">
              Confirmation identique au nouveau mot de passe
            </li>
          </ul>
        </div>

        <div class="profile-panel__footer">
          <UiButton
            variant="primary"
            :icon="KeyRound"
            :disabled="passwordSaving || !canSavePassword"
            @click="savePassword"
          >
            {{ passwordSaving ? 'Traitement…' : 'Changer le mot de passe' }}
          </UiButton>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.profile-page {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  max-width: 56rem;
  margin: 0 auto;
}

.profile-hero {
  position: relative;
  overflow: hidden;
  border-radius: 18px;
  border: 1px solid rgba(107, 124, 62, 0.2);
  background: linear-gradient(135deg, #f4f6ef 0%, #e8efe0 38%, #fff 100%);
  box-shadow: 0 10px 32px rgba(107, 124, 62, 0.1);
}

.profile-hero__glow {
  position: absolute;
  top: -3rem;
  right: -2rem;
  width: 12rem;
  height: 12rem;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(107, 124, 62, 0.18) 0%, transparent 70%);
  pointer-events: none;
}

.profile-hero__content {
  position: relative;
  padding: 1.35rem 1.4rem 1.2rem;
}

.profile-hero__top {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1.15rem;
}

.profile-hero__icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.25rem;
  height: 3.25rem;
  flex-shrink: 0;
  border-radius: 14px;
  background: #fff;
  color: var(--primary-700);
  border: 1px solid rgba(107, 124, 62, 0.22);
  box-shadow: 0 4px 14px rgba(107, 124, 62, 0.12);
}

.profile-hero__eyebrow {
  margin: 0 0 0.2rem;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--primary-700);
}

.profile-hero__title {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--primary-900, #2d3a1f);
  line-height: 1.15;
}

.profile-hero__subtitle {
  margin: 0.35rem 0 0;
  font-size: 0.9rem;
  color: var(--text-muted);
  line-height: 1.45;
  max-width: 28rem;
}

.profile-identity {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.95rem 1rem;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(107, 124, 62, 0.14);
  backdrop-filter: blur(6px);
}

.profile-identity__avatar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.75rem;
  height: 3.75rem;
  flex-shrink: 0;
  border-radius: 16px;
  background: linear-gradient(145deg, var(--primary-500), var(--primary-700));
  color: #fff;
  font-size: 1.2rem;
  font-weight: 800;
  box-shadow: 0 6px 18px rgba(107, 124, 62, 0.28);
}

.profile-identity__ring {
  position: absolute;
  inset: -3px;
  border-radius: 18px;
  border: 2px solid color-mix(in srgb, var(--role-accent) 55%, transparent);
  pointer-events: none;
}

.profile-identity__name {
  display: block;
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.02em;
}

.profile-identity__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.45rem;
}

.profile-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.28rem 0.55rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
}

.profile-chip--role {
  color: var(--chip-color);
  background: color-mix(in srgb, var(--chip-color) 12%, white);
  border: 1px solid color-mix(in srgb, var(--chip-color) 24%, transparent);
}

.profile-chip--email {
  color: #57534e;
  background: #f5f5f4;
  border: 1px solid rgba(15, 23, 42, 0.08);
}

.profile-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  align-items: start;
}

.profile-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1.15rem 1.2rem 1.1rem;
  border-radius: 16px;
  background: #fff;
  border: 1px solid rgba(15, 23, 42, 0.07);
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.05);
}

.profile-panel--security {
  background: linear-gradient(180deg, #fafafa 0%, #fff 40%);
}

.profile-panel__head {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.profile-panel__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.35rem;
  height: 2.35rem;
  flex-shrink: 0;
  border-radius: 11px;
}

.profile-panel__icon--identity {
  background: rgba(107, 124, 62, 0.12);
  color: var(--primary-700);
}

.profile-panel__icon--security {
  background: rgba(37, 99, 235, 0.1);
  color: #2563eb;
}

.profile-panel__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.02em;
}

.profile-panel__desc {
  margin: 0.15rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.4;
}

.profile-fields {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.profile-success {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.65rem 0.8rem;
  border-radius: 10px;
  background: #ecfdf5;
  border: 1px solid rgba(22, 163, 74, 0.2);
  color: #166534;
  font-size: 0.8125rem;
  font-weight: 600;
}

.profile-hint {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  margin: 0;
  padding: 0.7rem 0.8rem;
  border-radius: 10px;
  background: rgba(244, 246, 239, 0.9);
  border: 1px solid var(--border);
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.45;
}

.profile-hint strong {
  color: var(--text);
}

.profile-security-tips {
  margin: 0;
  padding: 0.75rem 0.85rem 0.75rem 1.65rem;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid rgba(15, 23, 42, 0.06);
  font-size: 0.8125rem;
  color: #78716c;
  line-height: 1.5;
}

.profile-security-tips li {
  margin-bottom: 0.2rem;
}

.profile-security-tips li:last-child {
  margin-bottom: 0;
}

.profile-security-tips__item--ok {
  color: #15803d;
  font-weight: 600;
}

.profile-panel__footer {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 0.15rem;
  padding-top: 0.65rem;
  border-top: 1px solid rgba(15, 23, 42, 0.06);
}

@media (max-width: 900px) {
  .profile-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .profile-hero__top {
    flex-direction: column;
  }

  .profile-identity {
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
  }

  .profile-panel__footer {
    flex-direction: column-reverse;
    align-items: stretch;
  }

  .profile-panel__footer :deep(.ui-btn) {
    justify-content: center;
  }
}
</style>
