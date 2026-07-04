<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Info,
  Trash2,
  X,
  XCircle,
} from '@lucide/vue'
import type { AppModalType } from '@/lib/app-modal'
import { useAppModal } from '@/composables/useAppModal'
import UiButton from '@/components/ui/UiButton.vue'

const { state, confirmModal, cancelModal } = useAppModal()

const MODAL_META: Record<
  AppModalType,
  { icon: typeof Info; variant: string; confirmVariant: 'primary' | 'danger' | 'ghost' }
> = {
  CONFIRM: { icon: CheckCircle2, variant: 'confirm', confirmVariant: 'primary' },
  DELETE: { icon: Trash2, variant: 'delete', confirmVariant: 'danger' },
  SUCCESS: { icon: CheckCircle2, variant: 'success', confirmVariant: 'primary' },
  WARNING: { icon: AlertTriangle, variant: 'warning', confirmVariant: 'primary' },
  DUPLICATE: { icon: Copy, variant: 'duplicate', confirmVariant: 'primary' },
  ERROR: { icon: XCircle, variant: 'error', confirmVariant: 'primary' },
  INFO: { icon: Info, variant: 'info', confirmVariant: 'primary' },
}

const meta = computed(() => MODAL_META[state.type])
const existingEntries = computed(() =>
  state.existingData ? Object.entries(state.existingData) : [],
)

function onKeydown(event: KeyboardEvent) {
  if (!state.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelModal()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="app-modal">
      <div
        v-if="state.open"
        class="app-modal-overlay"
        role="presentation"
        @click.self="cancelModal"
      >
        <div
          class="app-modal"
          :class="`app-modal--${meta.variant}`"
          role="alertdialog"
          aria-modal="true"
          :aria-labelledby="'app-modal-title'"
          :aria-describedby="'app-modal-message'"
        >
          <button type="button" class="app-modal__close" aria-label="Fermer" @click="cancelModal">
            <X :size="18" />
          </button>

          <div class="app-modal__icon-wrap">
            <component :is="meta.icon" :size="34" class="app-modal__icon" />
          </div>

          <h2 id="app-modal-title" class="app-modal__title">{{ state.title }}</h2>
          <p id="app-modal-message" class="app-modal__message">{{ state.message }}</p>

          <div v-if="existingEntries.length" class="app-modal__existing">
            <p class="app-modal__existing-title">Enregistrement existant</p>
            <dl>
              <div v-for="[label, value] in existingEntries" :key="label" class="app-modal__existing-row">
                <dt>{{ label }}</dt>
                <dd>{{ value }}</dd>
              </div>
            </dl>
          </div>

          <div class="app-modal__actions">
            <UiButton
              v-if="state.showCancel"
              variant="ghost"
              @click="cancelModal"
            >
              {{ state.cancelLabel }}
            </UiButton>
            <UiButton
              :variant="meta.confirmVariant"
              @click="confirmModal"
            >
              {{ state.confirmLabel }}
            </UiButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
