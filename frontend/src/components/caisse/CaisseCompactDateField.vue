<script setup lang="ts">
withDefaults(
  defineProps<{
    disabled?: boolean
    inactive?: boolean
  }>(),
  {
    disabled: false,
    inactive: false,
  },
)

const model = defineModel<string>({ required: true })
</script>

<template>
  <label
    class="caisse-compact-date"
    :class="{ 'caisse-compact-date--inactive': inactive || disabled }"
  >
    <span class="caisse-compact-date__label">Date</span>
    <input
      v-model="model"
      type="date"
      class="caisse-compact-date__input"
      :disabled="disabled"
      aria-label="Date"
    />
  </label>
</template>

<style scoped>
.caisse-compact-date {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.25rem;
  padding: 0.2rem 0.65rem 0.2rem 0.75rem;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(15, 23, 42, 0.08);
  transition: opacity 0.15s ease;
}

.caisse-compact-date--inactive {
  opacity: 0.55;
}

.caisse-compact-date__label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
}

.caisse-compact-date__input {
  width: 10.5rem;
  height: 2rem;
  padding: 0 0.55rem;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--text);
  font-family: inherit;
  font-size: 0.8125rem;
  line-height: 1.2;
}

.caisse-compact-date__input:focus {
  outline: none;
  border-color: var(--accent-500);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.caisse-compact-date__input:disabled {
  background: #f8fafc;
  color: var(--text-muted);
  cursor: not-allowed;
}
</style>
