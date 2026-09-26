<template>
  <AppOfflineBanner />
  <RouterView />
  <AppModalHost />
  <TouchKeyboard />
  <PwaUpdateBanner />
</template>

<script setup lang="ts">
import AppModalHost from '@/components/ui/AppModalHost.vue'
import TouchKeyboard from '@/components/ui/TouchKeyboard.vue'
import AppOfflineBanner from '@/components/pwa/AppOfflineBanner.vue'
import PwaUpdateBanner from '@/components/pwa/PwaUpdateBanner.vue'
</script>
