<script setup lang="ts">
import { ref } from 'vue'
import { RefreshCw } from '@lucide/vue'
import { usePwaUpdate } from '@/composables/usePwaUpdate'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiButton from '@/components/ui/UiButton.vue'

const { t } = useAppI18n()
const { needRefresh, applyUpdate } = usePwaUpdate()
const updating = ref(false)

async function onUpdateClick() {
  if (updating.value) return
  updating.value = true
  try {
    await applyUpdate()
  } catch {
    updating.value = false
  }
}
</script>

<template>
  <div v-if="needRefresh" class="pwa-update" role="status">
    <span>{{ t('pwa.updateAvailable') }}</span>
    <UiButton
      type="button"
      size="sm"
      variant="secondary"
      :icon="RefreshCw"
      :disabled="updating"
      @click="onUpdateClick"
    >
      {{ updating ? t('pwa.updating') : t('pwa.updateReload') }}
    </UiButton>
  </div>
</template>

<style scoped>
.pwa-update {
  position: fixed;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  max-width: calc(100vw - 2rem);
  padding: 0.75rem 1.1rem;
  border-radius: 14px;
  background: #1b4f9c;
  color: #fff;
  box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
  font-size: 0.9rem;
  line-height: 1.35;
}
</style>
