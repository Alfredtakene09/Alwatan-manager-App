<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { User, Lock } from '@lucide/vue'
import { useAuthStore } from '@/stores/auth'
import { CLINIC } from '@/lib/clinic'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import LanguageSwitcher from '@/components/LanguageSwitcher.vue'
import InstallAppBanner from '@/components/pwa/InstallAppBanner.vue'

const auth = useAuthStore()
const router = useRouter()
const { t, isArabic } = useAppI18n()
const username = ref('')
const password = ref('')
const error = ref('')
const usernameInputRef = ref<{ focus: () => void } | null>(null)

async function submit() {
  error.value = ''
  try {
    const redirect = await auth.login(username.value, password.value)
    router.push(redirect)
  } catch (e) {
    if (axios.isAxiosError(e) && !e.response) {
      error.value = t('login.errors.unreachable')
    } else if (axios.isAxiosError(e)) {
      const code = String(e.response?.data?.code ?? '')
      const apiMsg =
        typeof e.response?.data?.error === 'string' ? e.response.data.error : ''
      if (code === 'ACCOUNT_LOCKED') {
        error.value = apiMsg || t('login.errors.locked')
      } else if (code === 'SESSION_ACTIVE' || e.response?.status === 409) {
        error.value = apiMsg || t('login.errors.sessionActive')
      } else if (code === 'LAST_ATTEMPT') {
        error.value = apiMsg || t('login.errors.lastAttempt')
      } else if (e.response?.status === 403) {
        error.value = apiMsg || t('login.errors.locked')
      } else if (e.response?.status === 401) {
        error.value = apiMsg || t('login.errors.invalid')
      } else if (e.response?.status === 502 || e.response?.status === 503) {
        error.value = t('login.errors.unavailable')
      } else if (e.response?.status === 400) {
        error.value = t('login.errors.badRequest')
      } else {
        error.value = t('login.errors.generic')
      }
    } else {
      error.value = t('login.errors.generic')
    }
  }
}

onMounted(async () => {
  sessionStorage.removeItem('alwatan-auth-redirect')
  const params = new URLSearchParams(window.location.search)
  const sessionReason = params.get('session')
  if (sessionReason === 'expired') {
    error.value = t('login.errors.sessionExpired')
  } else if (sessionReason === 'idle') {
    error.value = t('login.errors.sessionIdle')
  } else if (sessionReason === 'locked') {
    error.value = t('login.errors.locked')
  } else if (sessionReason === 'replaced') {
    error.value = t('login.errors.sessionReplaced')
  }
  if (sessionReason) {
    params.delete('session')
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`
    window.history.replaceState({}, '', next)
  }
  await nextTick()
  usernameInputRef.value?.focus()
})
</script>

<template>
  <div class="login">
    <div class="login__lang">
      <LanguageSwitcher />
    </div>

    <div class="login__stack">
      <InstallAppBanner />

      <form
        class="login__card"
        :class="{ 'lang-ar': isArabic }"
        :lang="isArabic ? 'ar' : undefined"
        @submit.prevent="submit"
      >
        <header class="login__brand">
          <h1 class="login__title">{{ t('login.title') }}</h1>
          <img class="login__logo" :src="CLINIC.logo" :alt="CLINIC.nameFr" />
        </header>

        <UiInput
          ref="usernameInputRef"
          v-model="username"
          :label="t('login.username')"
          type="text"
          :placeholder="t('login.usernamePlaceholder')"
          :icon="User"
          autocomplete="username"
          required
        />
        <UiInput
          v-model="password"
          :label="t('login.password')"
          type="password"
          placeholder="••••••••"
          :icon="Lock"
          revealable
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
          {{ t('login.submit') }}
        </UiButton>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login {
  position: relative;
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

.login__lang {
  position: absolute;
  top: max(1rem, env(safe-area-inset-top, 0px));
  inset-inline-end: max(1rem, env(safe-area-inset-end, 0px));
  z-index: 2;
}

.login__stack {
  width: 100%;
  max-width: 32rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.login__card {
  width: 100%;
  max-width: 26rem;
  margin: 0 auto;
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

@media (max-width: 639px) {
  .login {
    padding: 1rem;
    align-items: flex-start;
    padding-top: max(3.5rem, calc(env(safe-area-inset-top, 0px) + 3rem));
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
}
</style>
