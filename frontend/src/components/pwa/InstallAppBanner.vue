<script setup lang="ts">
import { Download, Smartphone, X } from '@lucide/vue'
import { usePwaInstall } from '@/composables/usePwaInstall'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiButton from '@/components/ui/UiButton.vue'

const { t } = useAppI18n()
const {
  canNativeInstall,
  isSecureContext,
  shouldShowBanner,
  dismissBanner,
  promptNativeInstall,
  downloadWindowsAppLauncher,
} = usePwaInstall()

async function onInstallClick() {
  if (canNativeInstall.value) {
    await promptNativeInstall()
    return
  }
  downloadWindowsAppLauncher()
}
</script>

<template>
  <aside v-if="shouldShowBanner" class="install-banner" role="region" :aria-label="t('pwa.installTitle')">
    <div class="install-banner__icon" aria-hidden="true">
      <Smartphone :size="22" />
    </div>
    <div class="install-banner__body">
      <p class="install-banner__title">{{ t('pwa.installTitle') }}</p>
      <p class="install-banner__text">
        {{ canNativeInstall ? t('pwa.installBody') : t('pwa.installHttpHint') }}
      </p>
      <div class="install-banner__actions">
        <UiButton type="button" size="sm" :icon="canNativeInstall ? Smartphone : Download" @click="onInstallClick">
          {{ canNativeInstall ? t('pwa.installButton') : t('pwa.downloadLauncher') }}
        </UiButton>
        <UiButton v-if="!isSecureContext && canNativeInstall" type="button" size="sm" variant="outline" :icon="Download" @click="downloadWindowsAppLauncher">
          {{ t('pwa.downloadLauncher') }}
        </UiButton>
        <UiButton type="button" size="sm" variant="ghost" @click="dismissBanner">
          {{ t('pwa.installDismiss') }}
        </UiButton>
      </div>
    </div>
    <button type="button" class="install-banner__close" :aria-label="t('pwa.installDismiss')" @click="dismissBanner">
      <X :size="18" />
    </button>
  </aside>
</template>

<style scoped>
.install-banner {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  margin: 0 0 1rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--color-primary, #1b4f9c) 25%, #c5d4ea);
  background: color-mix(in srgb, var(--color-primary, #1b4f9c) 8%, #fff);
  position: relative;
}

.install-banner__icon {
  flex-shrink: 0;
  color: var(--color-primary, #1b4f9c);
  margin-top: 0.1rem;
}

.install-banner__title {
  margin: 0 0 0.25rem;
  font-weight: 600;
  font-size: 0.95rem;
}

.install-banner__text {
  margin: 0 0 0.65rem;
  font-size: 0.85rem;
  line-height: 1.45;
  color: var(--color-text-muted, #4b5563);
}

.install-banner__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.install-banner__close {
  position: absolute;
  top: 0.45rem;
  right: 0.45rem;
  border: none;
  background: transparent;
  color: inherit;
  opacity: 0.65;
  cursor: pointer;
  padding: 0.2rem;
  line-height: 0;
}

.install-banner__close:hover {
  opacity: 1;
}
</style>
