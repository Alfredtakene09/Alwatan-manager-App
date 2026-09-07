<script setup lang="ts">
import { ref } from 'vue'
import { RefreshCw } from '@lucide/vue'
import { usePwaInstall } from '@/composables/usePwaInstall'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiButton from '@/components/ui/UiButton.vue'

withDefaults(
  defineProps<{
    /** Affichage compact (barre du haut) ou carte (connexion). */
    compact?: boolean
  }>(),
  { compact: false },
)

const { t } = useAppI18n()
const {
  isAndroid,
  showUpdateShortcutButton,
  syncDesktopShortcut,
  downloadAndroidShortcut,
} = usePwaInstall()

const busy = ref(false)
const status = ref<'idle' | 'ok' | 'fallback'>('idle')
/** Masquage immédiat après clic (en plus de showUpdateShortcutButton). */
const hiddenAfterUpdate = ref(false)

async function onClick() {
  if (busy.value) return
  if (isAndroid.value) {
    downloadAndroidShortcut()
    hiddenAfterUpdate.value = true
    return
  }

  busy.value = true
  status.value = 'idle'
  try {
    const mode = await syncDesktopShortcut()
    status.value = mode === 'download' ? 'fallback' : 'ok'
    // Disparaît après mise à jour (bref message si non compact).
    window.setTimeout(() => {
      hiddenAfterUpdate.value = true
    }, mode === 'download' ? 2500 : 900)
  } finally {
    window.setTimeout(() => {
      busy.value = false
    }, 800)
  }
}
</script>

<template>
  <div
    v-if="showUpdateShortcutButton && !hiddenAfterUpdate"
    class="update-shortcut"
    :class="{ 'update-shortcut--compact': compact }"
  >
    <UiButton
      type="button"
      :size="compact ? 'sm' : 'md'"
      :variant="compact ? 'outline' : 'secondary'"
      :icon="RefreshCw"
      :block="!compact"
      :loading="busy"
      :disabled="busy"
      @click="onClick"
    >
      {{ busy ? t('pwa.updatingShortcut') : t('pwa.updateShortcutButton') }}
    </UiButton>
    <p v-if="!compact" class="update-shortcut__hint">
      <template v-if="status === 'ok'">{{ t('pwa.updateShortcutDone') }}</template>
      <template v-else-if="status === 'fallback'">{{ t('pwa.updateShortcutFirstInstall') }}</template>
      <template v-else>{{ t('pwa.updateShortcutHint') }}</template>
    </p>
  </div>
</template>

<style scoped>
.update-shortcut {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.update-shortcut--compact {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
}

.update-shortcut__hint {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.4;
  color: var(--color-text-muted, #4b5563);
}
</style>
