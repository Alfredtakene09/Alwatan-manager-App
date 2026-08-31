<script setup lang="ts">
import { Download, Smartphone, Tablet, X } from '@lucide/vue'
import { usePwaInstall } from '@/composables/usePwaInstall'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiButton from '@/components/ui/UiButton.vue'

const { t } = useAppI18n()
const {
  shouldShowBanner,
  canNativeInstall,
  isLanHttp,
  isAndroid,
  isIos,
  isMobile,
  isWindows,
  showAndroidHelp,
  launcherNeedsSync,
  dismissBanner,
  promptNativeInstall,
  downloadShortcut,
  syncDesktopShortcut,
  downloadAndroidShortcut,
  openAndroidHelp,
  closeAndroidHelp,
} = usePwaInstall()

async function onInstallClick() {
  if (canNativeInstall.value) {
    await promptNativeInstall()
    return
  }
  if (isAndroid.value || isIos.value) {
    if (showAndroidHelp.value) closeAndroidHelp()
    else openAndroidHelp()
  }
}
</script>

<template>
  <aside v-if="shouldShowBanner" class="install-banner" role="region" :aria-label="t('pwa.installTitle')">
    <div class="install-banner__icon" aria-hidden="true">
      <component :is="isMobile ? Tablet : Smartphone" :size="22" />
    </div>
    <div class="install-banner__body">
      <p class="install-banner__title">
        <template v-if="launcherNeedsSync">{{ t('pwa.syncShortcutTitle') }}</template>
        <template v-else-if="isAndroid || isIos">{{ t('pwa.installTabletTitle') }}</template>
        <template v-else>{{ t('pwa.installTitle') }}</template>
      </p>
      <p class="install-banner__text">
        <template v-if="launcherNeedsSync">
          {{ t('pwa.syncShortcutHint') }}
        </template>
        <template v-else-if="isAndroid">
          {{ t('pwa.installAndroidHint') }}
        </template>
        <template v-else-if="isIos">
          {{ t('pwa.installIosHint') }}
        </template>
        <template v-else-if="isLanHttp">
          {{ t('pwa.installHttpHint') }}
        </template>
        <template v-else>
          {{ t('pwa.installBody') }}
        </template>
      </p>

      <ol v-if="showAndroidHelp && (isAndroid || isIos)" class="install-banner__steps">
        <template v-if="isAndroid">
          <li>{{ t('pwa.androidStep1') }}</li>
          <li>{{ t('pwa.androidStep2') }}</li>
          <li>{{ t('pwa.androidStep3') }}</li>
        </template>
        <template v-else>
          <li>{{ t('pwa.iosStep1') }}</li>
          <li>{{ t('pwa.iosStep2') }}</li>
          <li>{{ t('pwa.iosStep3') }}</li>
        </template>
      </ol>

      <div class="install-banner__actions">
        <UiButton
          v-if="launcherNeedsSync"
          type="button"
          size="sm"
          :icon="Download"
          @click="syncDesktopShortcut"
        >
          {{ t('pwa.syncShortcutButton') }}
        </UiButton>

        <UiButton
          v-else-if="canNativeInstall"
          type="button"
          size="sm"
          :icon="Smartphone"
          @click="promptNativeInstall"
        >
          {{ t('pwa.installButton') }}
        </UiButton>

        <UiButton
          v-else-if="isAndroid || isIos"
          type="button"
          size="sm"
          :icon="Tablet"
          @click="onInstallClick"
        >
          {{ showAndroidHelp ? t('pwa.hideSteps') : t('pwa.installTabletButton') }}
        </UiButton>

        <UiButton
          v-if="!launcherNeedsSync && isAndroid"
          type="button"
          size="sm"
          :icon="Download"
          @click="downloadAndroidShortcut"
        >
          {{ t('pwa.installAndroidShortcut') }}
        </UiButton>

        <UiButton
          v-if="!launcherNeedsSync && (isWindows || (!isAndroid && !isIos))"
          type="button"
          size="sm"
          :icon="Download"
          @click="downloadShortcut"
        >
          {{ t('pwa.installDesktopShortcut') }}
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

.install-banner__steps {
  margin: 0 0 0.75rem;
  padding-inline-start: 1.2rem;
  font-size: 0.84rem;
  line-height: 1.5;
  color: var(--color-text, #1f2937);
}

.install-banner__steps li + li {
  margin-top: 0.25rem;
}

.install-banner__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.install-banner__close {
  position: absolute;
  top: 0.45rem;
  inset-inline-end: 0.45rem;
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
