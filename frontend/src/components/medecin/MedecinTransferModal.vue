<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowRightLeft, X } from '@lucide/vue'
import { fullName } from '@/lib/roles'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiButton from '@/components/ui/UiButton.vue'
import UiSelect from '@/components/ui/UiSelect.vue'

export type TransferServiceDoctor = {
  id: string
  firstName: string
  lastName: string
}

export type TransferServiceOption = {
  id: string
  name: string
  doctorCount: number
  doctors?: TransferServiceDoctor[]
}

const props = defineProps<{
  patientName: string
  patientCode: string
  services: TransferServiceOption[]
  currentServiceId?: string | null
  currentDoctorId?: string | null
  transferring: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: [payload: { clinicServiceId: string; doctorId: string }]
}>()

const { uiText, clinicServiceText } = useAppI18n()
const selectedServiceId = ref('')
const selectedDoctorId = ref('')

const serviceOptions = computed(() => props.services)

const selectedService = computed(
  () => serviceOptions.value.find((service) => service.id === selectedServiceId.value) ?? null,
)

const doctorOptions = computed(() => {
  const doctors = selectedService.value?.doctors ?? []
  const hideCurrentDoctor =
    Boolean(props.currentDoctorId) && selectedServiceId.value === (props.currentServiceId ?? '')
  return [...doctors]
    .filter((doctor) => !hideCurrentDoctor || doctor.id !== props.currentDoctorId)
    .sort((a, b) => {
      const byLast = a.lastName.localeCompare(b.lastName, 'fr', { sensitivity: 'base' })
      if (byLast !== 0) return byLast
      return a.firstName.localeCompare(b.firstName, 'fr', { sensitivity: 'base' })
    })
})

const canSubmit = computed(
  () => Boolean(selectedServiceId.value && selectedDoctorId.value && doctorOptions.value.length),
)

watch(selectedServiceId, (serviceId) => {
  const service = serviceOptions.value.find((item) => item.id === serviceId)
  const hideCurrentDoctor =
    Boolean(props.currentDoctorId) && serviceId === (props.currentServiceId ?? '')
  const doctors = (service?.doctors ?? []).filter(
    (doctor) => !hideCurrentDoctor || doctor.id !== props.currentDoctorId,
  )
  selectedDoctorId.value = doctors.length === 1 ? doctors[0].id : ''
})

function doctorLabel(doctor: TransferServiceDoctor) {
  return `Dr ${fullName(doctor.firstName, doctor.lastName)}`
}

function submit() {
  if (!canSubmit.value) return
  emit('confirm', {
    clinicServiceId: selectedServiceId.value,
    doctorId: selectedDoctorId.value,
  })
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal modal--transfer" role="dialog" aria-modal="true" aria-labelledby="transfer-modal-title">
      <header class="modal__header">
        <div>
          <h2 id="transfer-modal-title">{{ uiText('Transférer le patient') }}</h2>
          <p>{{ patientName }} — {{ patientCode }}</p>
        </div>
        <button type="button" class="modal__close" :aria-label="uiText('Fermer')" @click="emit('close')">
          <X :size="18" />
        </button>
      </header>

      <div class="modal__body">
        <UiSelect v-model="selectedServiceId" label="Service destinataire" required>
          <option value="" disabled>{{ uiText('Choisir un service…') }}</option>
          <option v-for="service in serviceOptions" :key="service.id" :value="service.id">
            {{ clinicServiceText(service.name)
            }}{{ service.doctorCount ? '' : ` (${uiText('aucun médecin rattaché')})` }}
          </option>
        </UiSelect>

        <UiSelect
          v-model="selectedDoctorId"
          label="Médecin destinataire"
          required
          :disabled="!selectedServiceId"
        >
          <option value="" disabled>{{ uiText('Choisir un médecin…') }}</option>
          <option v-for="doctor in doctorOptions" :key="doctor.id" :value="doctor.id">
            {{ doctorLabel(doctor) }}
          </option>
        </UiSelect>

        <p v-if="!serviceOptions.length" class="transfer-hint transfer-hint--danger">
          {{ uiText('Aucun service disponible. Créez-en un dans la page Services.') }}
        </p>
        <p v-else-if="selectedServiceId && !doctorOptions.length" class="transfer-hint transfer-hint--danger">
          {{ uiText('Aucun médecin rattaché à ce service. Affectez un médecin dans la page Services.') }}
        </p>
        <p v-else class="transfer-hint">
          {{ uiText('Le patient quittera votre file et apparaîtra chez le médecin choisi.') }}
        </p>
      </div>

      <footer class="modal__footer">
        <UiButton variant="ghost" @click="emit('close')">{{ uiText('Annuler') }}</UiButton>
        <UiButton
          variant="primary"
          :icon="ArrowRightLeft"
          :disabled="transferring || !canSubmit"
          @click="submit"
        >
          {{ uiText(transferring ? 'Transfert…' : 'Confirmer le transfert') }}
        </UiButton>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.45);
}

.modal--transfer {
  width: min(420px, 100%);
  background: var(--surface, #fff);
  border-radius: 16px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.2);
  overflow: hidden;
}

.modal__header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.1rem 1.25rem 0.75rem;
}

.modal__header h2 {
  margin: 0;
  font-size: 1.05rem;
}

.modal__header p {
  margin: 0.25rem 0 0;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.modal__close {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.modal__body {
  padding: 0.5rem 1.25rem 1rem;
}

.transfer-hint {
  margin: 0.75rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.4;
}

.transfer-hint--danger {
  color: var(--danger, #b91c1c);
}

.modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.85rem 1.25rem 1.15rem;
}
</style>
