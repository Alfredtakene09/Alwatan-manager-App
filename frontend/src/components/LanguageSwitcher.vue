<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LOCALES, setAppLocale, type AppLocale } from '@/i18n'

const { locale, t } = useI18n()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const current = computed(() => locale.value as AppLocale)
const activeLocale = computed(() => LOCALES.find((item) => item.code === current.value) ?? LOCALES[0])

function selectLocale(code: AppLocale) {
  setAppLocale(code)
  open.value = false
}

function toggle() {
  open.value = !open.value
}

function onPointerDown(event: PointerEvent) {
  if (!open.value || !rootRef.value) return
  if (!rootRef.value.contains(event.target as Node)) open.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="rootRef" class="lang-switcher" :class="{ 'lang-switcher--open': open }">
    <button
      type="button"
      class="lang-switcher__trigger"
      :aria-label="t('common.language')"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <span class="lang-switcher__flag" aria-hidden="true">
        <svg v-if="activeLocale.code === 'fr'" viewBox="0 0 24 16" class="lang-switcher__flag-svg">
          <rect width="8" height="16" fill="#002395" />
          <rect x="8" width="8" height="16" fill="#fff" />
          <rect x="16" width="8" height="16" fill="#ed2939" />
        </svg>
        <svg v-else-if="activeLocale.code === 'ar'" viewBox="0 0 24 16" class="lang-switcher__flag-svg">
          <rect width="24" height="16" fill="#006c35" />
          <path d="M5 4.2v8h1V9.2l1.4 1.8L8.8 9.2V12.2h1V4.2H8.6L7.4 7.2 6.2 4.2H5z" fill="#fff" />
          <path d="M11 10.8h8v1.1H11z" fill="#fff" />
          <path d="M18.2 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zm0 1.1a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4z" fill="#fff" />
        </svg>
        <svg v-else viewBox="0 0 24 16" class="lang-switcher__flag-svg">
          <rect width="24" height="16" fill="#b22234" />
          <rect y="1.23" width="24" height="1.23" fill="#fff" />
          <rect y="3.69" width="24" height="1.23" fill="#fff" />
          <rect y="6.15" width="24" height="1.23" fill="#fff" />
          <rect y="8.62" width="24" height="1.23" fill="#fff" />
          <rect y="11.08" width="24" height="1.23" fill="#fff" />
          <rect y="13.54" width="24" height="1.23" fill="#fff" />
          <rect width="9.6" height="8.6" fill="#3c3b6e" />
        </svg>
      </span>
      <span class="lang-switcher__code">{{ activeLocale.codeLabel }}</span>
      <span class="lang-switcher__caret" aria-hidden="true">▾</span>
    </button>

    <ul v-show="open" class="lang-switcher__menu" role="listbox" :aria-label="t('common.language')">
      <li v-for="item in LOCALES" :key="item.code" role="option" :aria-selected="current === item.code">
        <button
          type="button"
          class="lang-switcher__option"
          :class="{ 'lang-switcher__option--active': current === item.code }"
          @click="selectLocale(item.code)"
        >
          <span class="lang-switcher__flag" aria-hidden="true">
            <svg v-if="item.code === 'fr'" viewBox="0 0 24 16" class="lang-switcher__flag-svg">
              <rect width="8" height="16" fill="#002395" />
              <rect x="8" width="8" height="16" fill="#fff" />
              <rect x="16" width="8" height="16" fill="#ed2939" />
            </svg>
            <svg v-else-if="item.code === 'ar'" viewBox="0 0 24 16" class="lang-switcher__flag-svg">
              <rect width="24" height="16" fill="#006c35" />
              <path d="M5 4.2v8h1V9.2l1.4 1.8L8.8 9.2V12.2h1V4.2H8.6L7.4 7.2 6.2 4.2H5z" fill="#fff" />
              <path d="M11 10.8h8v1.1H11z" fill="#fff" />
              <path d="M18.2 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zm0 1.1a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4z" fill="#fff" />
            </svg>
            <svg v-else viewBox="0 0 24 16" class="lang-switcher__flag-svg">
              <rect width="24" height="16" fill="#b22234" />
              <rect y="1.23" width="24" height="1.23" fill="#fff" />
              <rect y="3.69" width="24" height="1.23" fill="#fff" />
              <rect y="6.15" width="24" height="1.23" fill="#fff" />
              <rect y="8.62" width="24" height="1.23" fill="#fff" />
              <rect y="11.08" width="24" height="1.23" fill="#fff" />
              <rect y="13.54" width="24" height="1.23" fill="#fff" />
              <rect width="9.6" height="8.6" fill="#3c3b6e" />
            </svg>
          </span>
          <span class="lang-switcher__code">{{ item.codeLabel }}</span>
          <span class="lang-switcher__name">{{ item.name }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.lang-switcher {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  direction: ltr;
}

.lang-switcher__trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.32rem 0.55rem 0.32rem 0.4rem;
  border: 1.5px solid rgba(27, 79, 156, 0.18);
  border-radius: 999px;
  background: #fff;
  color: #1b4f9c;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(15, 40, 80, 0.06);
  line-height: 1;
}

.lang-switcher__trigger:hover,
.lang-switcher--open .lang-switcher__trigger {
  border-color: #1b4f9c;
  background: #e8f1fb;
}

.lang-switcher__flag {
  display: inline-flex;
  width: 1.35rem;
  height: 0.9rem;
  border-radius: 2px;
  overflow: hidden;
  box-shadow: 0 0 0 1px rgba(15, 40, 80, 0.12);
  flex-shrink: 0;
}

.lang-switcher__flag-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.lang-switcher__code {
  font-variant-numeric: tabular-nums;
}

.lang-switcher__caret {
  font-size: 0.65rem;
  opacity: 0.7;
  transform: translateY(-0.05rem);
}

.lang-switcher__menu {
  position: absolute;
  top: calc(100% + 0.35rem);
  inset-inline-end: 0;
  z-index: 50;
  min-width: 9.5rem;
  margin: 0;
  padding: 0.3rem;
  list-style: none;
  background: #fff;
  border: 1px solid rgba(27, 79, 156, 0.14);
  border-radius: 12px;
  box-shadow: 0 10px 28px rgba(15, 40, 80, 0.14);
}

.lang-switcher__option {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  padding: 0.45rem 0.55rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #334155;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  text-align: start;
}

.lang-switcher__option:hover {
  background: #eef4fb;
  color: #1b4f9c;
}

.lang-switcher__option--active {
  background: #1b4f9c;
  color: #fff;
}

.lang-switcher__option--active:hover {
  background: #163f7d;
  color: #fff;
}

.lang-switcher__name {
  margin-inline-start: auto;
  font-weight: 600;
  opacity: 0.85;
}
</style>
