<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import axios from 'axios'
import { Clock, Save } from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { formatFcfa } from '@/lib/roles'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'

const { uiText } = useAppI18n()

type OvertimeRow = {
  id: string
  businessDate: string
  hoursWorked: number
  minutesWorked: number
  hourlyRateFcfa: number
  amountFcfa: number
  status: string
  comment: string | null
}

const auth = useAuthStore()
const open = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const recent = ref<OvertimeRow[]>([])

const today = () => new Date().toISOString().slice(0, 10)

const form = ref({
  businessDate: today(),
  startTime: '',
  endTime: '',
  hours: '',
  comment: '',
})

const canSubmit = computed(() => auth.user?.role === 'MEDECIN')

const estimatedHours = computed(() => {
  const hours = Number(form.value.hours)
  if (Number.isFinite(hours) && hours > 0) return hours
  if (form.value.startTime && form.value.endTime) {
    const [sh, sm] = form.value.startTime.split(':').map(Number)
    const [eh, em] = form.value.endTime.split(':').map(Number)
    if (![sh, sm, eh, em].every(Number.isFinite)) return null
    let diff = eh * 60 + em - (sh * 60 + sm)
    if (diff <= 0) diff += 24 * 60
    return Math.round((diff / 60) * 100) / 100
  }
  return null
})

function statusLabel(status: string) {
  if (status === 'PENDING') return uiText('En attente')
  if (status === 'VALIDATED') return uiText('Validée')
  if (status === 'REJECTED') return uiText('Refusée')
  if (status === 'PAID') return uiText('Payée')
  if (status === 'CANCELLED') return uiText('Annulée')
  return status
}

function resetForm() {
  form.value = {
    businessDate: today(),
    startTime: '',
    endTime: '',
    hours: '',
    comment: '',
  }
  message.value = ''
}

async function loadMine() {
  try {
    const { data } = await api.get<OvertimeRow[]>('/doctor-overtime/mine')
    recent.value = Array.isArray(data) ? data.slice(0, 8) : []
  } catch {
    recent.value = []
  }
}

async function openModal() {
  resetForm()
  open.value = true
  await loadMine()
}

function closeModal() {
  open.value = false
}

async function submit() {
  if (!estimatedHours.value || estimatedHours.value <= 0) {
    message.value = 'Indiquez la durée (heures) ou un créneau début / fin.'
    messageType.value = 'error'
    return
  }
  saving.value = true
  message.value = ''
  try {
    await api.post('/doctor-overtime', {
      businessDate: form.value.businessDate,
      startTime: form.value.startTime || null,
      endTime: form.value.endTime || null,
      hours: Number(form.value.hours) > 0 ? Number(form.value.hours) : undefined,
      comment: form.value.comment.trim() || null,
    })
    message.value = 'Heures supplémentaires envoyées. En attente de validation du gestionnaire.'
    messageType.value = 'success'
    form.value.hours = ''
    form.value.startTime = ''
    form.value.endTime = ''
    form.value.comment = ''
    await loadMine()
  } catch (error) {
    message.value = axios.isAxiosError(error)
      ? String(error.response?.data?.error ?? 'Envoi impossible.')
      : 'Envoi impossible.'
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

watch(open, (value) => {
  if (!value) resetForm()
})

onMounted(() => {
  // no-op: load on open
})
</script>

<template>
  <template v-if="canSubmit">
    <UiButton
      variant="ghost"
      size="sm"
      class="overtime-trigger"
      :icon="Clock"
      @click="openModal"
    >
      Heures supp.
    </UiButton>

    <UiFormModal
      v-if="open"
      title="Heures supplémentaires"
      subtitle="Saisie envoyée au gestionnaire pour calcul et validation"
      :icon="Clock"
      size="wide"
      @close="closeModal"
    >
      <UiAlert v-if="message" :type="messageType" :message="message" />

      <section class="overtime-form">
        <UiInput v-model="form.businessDate" label="Date" type="date" required />
        <div class="overtime-form__row">
          <UiInput v-model="form.startTime" label="Début (optionnel)" type="time" />
          <UiInput v-model="form.endTime" label="Fin (optionnel)" type="time" />
        </div>
        <UiInput
          v-model="form.hours"
          label="Durée en heures"
          type="number"
          min="0.25"
          step="0.25"
          placeholder="Ex. 2.5"
        />
        <UiInput
          v-model="form.comment"
          label="Commentaire"
          placeholder="Motif / précision (optionnel)"
        />
        <p v-if="estimatedHours" class="overtime-form__hint">
          {{ uiText('Durée retenue :') }} <strong>{{ estimatedHours }} h</strong>
          {{ uiText('— le montant sera calculé après validation du gestionnaire (taux horaire défini sur la fiche médecin).') }}
        </p>
      </section>

      <section v-if="recent.length" class="overtime-recent">
        <h3>{{ uiText('Mes dernières saisies') }}</h3>
        <ul>
          <li v-for="row in recent" :key="row.id">
            <span>{{ row.businessDate }} · {{ row.hoursWorked }} h</span>
            <strong>{{ statusLabel(row.status) }}</strong>
            <em v-if="row.amountFcfa > 0">{{ formatFcfa(row.amountFcfa) }}</em>
          </li>
        </ul>
      </section>

      <template #footer>
        <UiButton variant="ghost" @click="closeModal">Fermer</UiButton>
        <UiButton variant="primary" :icon="Save" :disabled="saving" @click="submit">
          {{ saving ? 'Envoi…' : 'Envoyer pour validation' }}
        </UiButton>
      </template>
    </UiFormModal>
  </template>
</template>

<style scoped>
.overtime-trigger {
  white-space: nowrap;
}

.overtime-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.overtime-form__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.overtime-form__hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.overtime-recent {
  margin-top: 1.25rem;
}

.overtime-recent h3 {
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
}

.overtime-recent ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.overtime-recent li {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.85rem;
  align-items: center;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
}

.overtime-recent strong {
  color: #0f766e;
}

.overtime-recent em {
  font-style: normal;
  margin-left: auto;
  font-weight: 600;
}

@media (max-width: 640px) {
  .overtime-form__row {
    grid-template-columns: 1fr;
  }
}
</style>
