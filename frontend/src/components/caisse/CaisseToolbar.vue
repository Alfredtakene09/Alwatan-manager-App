<template>
  <div class="caisse-toolbar">
    <slot />
  </div>
</template>

<style scoped>
.caisse-toolbar {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  width: fit-content;
  max-width: 100%;
  padding: 0.3rem;
  border-radius: 12px;
  background: var(--surface-muted, #eef2e6);
  border: 1px solid var(--border);
}

@media (max-width: 720px) {
  .caisse-toolbar {
    display: flex;
    width: 100%;
  }
}
</style>
