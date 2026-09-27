<template>
  <AppOfflineBanner />
  <RouterView />
  <AppModalHost />
  <TouchKeyboard v-if="touchKeyboardEnabled" />
  <PwaUpdateBanner />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import AppModalHost from '@/components/ui/AppModalHost.vue'
import TouchKeyboard from '@/components/ui/TouchKeyboard.vue'
import AppOfflineBanner from '@/components/pwa/AppOfflineBanner.vue'
import PwaUpdateBanner from '@/components/pwa/PwaUpdateBanner.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const touchKeyboardEnabled = computed(() => auth.user?.role !== 'RECEPTIONNISTE')
</script>
