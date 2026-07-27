<script setup lang="ts">
import { WifiOff } from '@lucide/vue'
import { useNetworkStatus } from '@/composables/usePwaUpdate'
import { useAppI18n } from '@/i18n/useAppI18n'

const { t } = useAppI18n()
const { offline } = useNetworkStatus()
</script>

<template>
  <div v-if="offline" class="offline-banner" role="alert">
    <WifiOff :size="18" aria-hidden="true" />
    <span>{{ t('pwa.offline') }}</span>
  </div>
</template>

<style scoped>
.offline-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.55rem 1rem;
  background: #b45309;
  color: #fff;
  font-size: 0.9rem;
  font-weight: 500;
}
</style>
