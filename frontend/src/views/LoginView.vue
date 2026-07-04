<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { User, Lock } from '@lucide/vue'
import { useAuthStore } from '@/stores/auth'
import { CLINIC } from '@/lib/clinic'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiAlert from '@/components/ui/UiAlert.vue'

const DEMO_PASSWORD = 'Clinique2026!'

const DEMO_ACCOUNTS = [
  { id: 'reception', label: 'Réception', username: 'reception' },
  { id: 'medecin', label: 'Médecin', username: 'medecin' },
  { id: 'direction', label: 'Direction', username: 'direction' },
  { id: 'pharmacie', label: 'Pharmacie', username: 'pharmacie' },
  { id: 'laboratoire', label: 'Laboratoire', username: 'laborantin' },
] as const

const auth = useAuthStore()
const router = useRouter()
const username = ref('')
const password = ref('')
const error = ref('')
const selectedDemoId = ref<string | null>(null)
const passwordInputRef = ref<{ focus: () => void } | null>(null)

function selectDemoAccount(id: string) {
  const account = DEMO_ACCOUNTS.find((item) => item.id === id)
  if (!account) return
  selectedDemoId.value = id
  username.value = account.username
  password.value = DEMO_PASSWORD
  error.value = ''
  passwordInputRef.value?.focus()
}

async function submit() {
  error.value = ''
  try {
    const redirect = await auth.login(username.value, password.value)
    router.push(redirect)
  } catch (e) {
    if (axios.isAxiosError(e) && !e.response) {
      error.value = 'Serveur inaccessible. Démarrez le backend : cd backend puis npm run dev (port 4000).'
    } else if (axios.isAxiosError(e) && (e.response?.status === 401)) {
      error.value = 'Identifiants invalides. Vérifiez votre nom d\'utilisateur et mot de passe.'
    } else if (axios.isAxiosError(e) && (e.response?.status === 502 || e.response?.status === 503)) {
      error.value = 'Backend indisponible. Lancez .\\scripts\\start-local.ps1 ou npm run dev dans le dossier backend.'
    } else if (axios.isAxiosError(e) && e.response?.status === 400) {
      error.value = 'Nom d\'utilisateur ou mot de passe invalide.'
    } else {
      error.value = 'Erreur de connexion. Réessayez dans un instant.'
    }
  }
}

onMounted(async () => {
  selectDemoAccount(DEMO_ACCOUNTS[0].id)
  await nextTick()
  passwordInputRef.value?.focus()
})
</script>

<template>
  <div class="login">
    <form class="login__card" @submit.prevent="submit">
      <header class="login__brand">
        <h1 class="login__title">Connexion</h1>
        <img class="login__logo" :src="CLINIC.logo" :alt="CLINIC.nameFr" />
      </header>

      <div class="login__demo">
        <p class="login__demo-label">Comptes démo — mot de passe : <code>Clinique2026!</code></p>
        <div class="demo-buttons">
          <button
            v-for="account in DEMO_ACCOUNTS"
            :key="account.id"
            type="button"
            class="demo-btn"
            :class="{ 'demo-btn--active': selectedDemoId === account.id }"
            @click="selectDemoAccount(account.id)"
          >
            {{ account.label }}
          </button>
        </div>
      </div>

      <UiInput
        v-model="username"
        label="Nom d'utilisateur"
        type="text"
        placeholder="reception"
        :icon="User"
        autocomplete="username"
        required
        @update:model-value="selectedDemoId = null"
      />
      <UiInput
        ref="passwordInputRef"
        v-model="password"
        label="Mot de passe"
        type="password"
        placeholder="••••••••"
        :icon="Lock"
        required
      />

      <UiAlert v-if="error" type="error" :message="error" />

      <UiButton
        type="submit"
        variant="primary"
        size="lg"
        block
        :loading="auth.loading"
        class="login__submit"
      >
        Se connecter
      </UiButton>
    </form>
  </div>
</template>

<style scoped>
.login {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 1.5rem;
  padding-top: max(1.5rem, env(safe-area-inset-top, 0px));
  padding-bottom: max(1.5rem, env(safe-area-inset-bottom, 0px));
  background:
    radial-gradient(ellipse 80% 50% at 50% -10%, rgba(27, 79, 156, 0.12), transparent 55%),
    radial-gradient(ellipse 50% 40% at 100% 100%, rgba(67, 160, 71, 0.08), transparent 50%),
    radial-gradient(ellipse 40% 35% at 0% 90%, rgba(245, 124, 0, 0.06), transparent 45%),
    #f0f5fb;
}

.login__card {
  width: 100%;
  max-width: 26rem;
  padding: 2rem 1.75rem 1.75rem;
  background: #fff;
  border: 1px solid rgba(27, 79, 156, 0.12);
  border-radius: 20px;
  box-shadow:
    0 4px 6px rgba(15, 40, 80, 0.04),
    0 16px 40px rgba(15, 40, 80, 0.1);
}

.login__brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1.35rem;
  border-bottom: 1px solid rgba(27, 79, 156, 0.1);
}

.login__logo {
  width: 8.5rem;
  height: 8.5rem;
  object-fit: contain;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 6px 24px rgba(27, 79, 156, 0.14);
}

.login__title {
  margin: 0 0 1rem;
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: #1b4f9c;
  line-height: 1.15;
}

.login__submit {
  margin-top: 1.25rem;
}

.login__demo {
  margin-bottom: 1.15rem;
  padding-bottom: 1.15rem;
  border-bottom: 1px dashed rgba(27, 79, 156, 0.15);
}

.login__demo-label {
  margin: 0 0 0.65rem;
  font-size: 0.8rem;
  color: var(--text-muted);
  text-align: center;
}

.login__demo code {
  background: #e8f1fb;
  color: #1b4f9c;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-size: 0.75rem;
  border: 1px solid rgba(27, 79, 156, 0.18);
}

.demo-buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.4rem;
}

.demo-btn {
  padding: 0.4rem 0.75rem;
  border: 1.5px solid rgba(27, 79, 156, 0.18);
  border-radius: 999px;
  background: #fff;
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.demo-btn:hover {
  border-color: #2e6bb5;
  color: #1b4f9c;
}

.demo-btn--active {
  background: #e8f1fb;
  border-color: #1b4f9c;
  color: #1b4f9c;
}

@media (max-width: 639px) {
  .login {
    padding: 1rem;
    align-items: flex-start;
    padding-top: max(1rem, env(safe-area-inset-top, 0px));
  }

  .login__card {
    padding: 1.35rem 1.15rem 1.25rem;
    border-radius: 16px;
  }

  .login__logo {
    width: 7rem;
    height: 7rem;
  }

  .login__title {
    font-size: 1.65rem;
  }

  .demo-btn {
    font-size: 0.6875rem;
    padding: 0.35rem 0.6rem;
  }
}
</style>
