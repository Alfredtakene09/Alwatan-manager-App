<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { LogOut } from '@lucide/vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { fullName } from '@/lib/roles'

const props = defineProps<{
  hosp: {
    id: string
    endDate?: string | null
    visit: { patient: { firstName: string; lastName: string } }
    room?: { name: string; type?: string } | null
  } | null
  submitting?: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: [payload: { hospitalizationId: string; endDate: string }]
}>()

const endDate = ref('')

const patientLabel = computed(() =>
  props.hosp
    ? fullName(props.hosp.visit.patient.firstName, props.hosp.visit.patient.lastName)
    : '',
)

const roomLabel = computed(() => props.hosp?.room?.name ?? '')

watch(
  () => props.hosp,
  (hosp) => {
    if (!hosp) {
      endDate.value = ''
      return
    }
    endDate.value = hosp.endDate
      ? new Date(hosp.endDate).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)
  },
  { immediate: true },
)

function onSubmit() {
  if (!props.hosp || !endDate.value) return
  emit('confirm', { hospitalizationId: props.hosp.id, endDate: endDate.value })
}
</script>

<template>
  <UiFormModal
    v-if="hosp"
    title="Clôturer la sortie"
    :subtitle="patientLabel + (roomLabel ? ` — ${roomLabel}` : '')"
    :icon="LogOut"
    @close="emit('close')"
  >
    <UiInput v-model="endDate" label="Date de sortie" type="date" required />

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Annuler</UiButton>
      <UiButton
        variant="primary"
        :icon="LogOut"
        :disabled="!endDate || submitting"
        @click="onSubmit"
      >
        {{ submitting ? 'Clôture…' : 'Valider la sortie' }}
      </UiButton>
    </template>
  </UiFormModal>
</template>
