<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import {
  X,
  FlaskConical,
  HeartPulse,
  ClipboardEdit,
  Printer,
  Phone,
  Stethoscope,
  Calendar,
  Send,
} from '@lucide/vue'
import { fullName } from '@/lib/roles'
import {
  parsePrescribedExamsByKind,
  parsePrescribedExamCommentsByKind,
  parseLabResultsCompletedAt,
} from '@/lib/lab-notes'
import { buildPrescribedByLabel } from '@/lib/lab-panel-print'
import { patientCategoryLabel, type PatientCategory } from '@/lib/patient-category'
import UiButton from '@/components/ui/UiButton.vue'
import type { LabsWaitingVisitRow } from '@/components/ui/LabsWaitingDataTable.vue'

const props = defineProps<{
  visit: LabsWaitingVisitRow | null
  completed?: boolean
}>()

const emit = defineEmits<{
  close: []
  saisir: [visitId: string]
  print: [visitId: string]
}>()

const labExams = computed(() =>
  props.visit ? parsePrescribedExamsByKind(props.visit.consultation?.clinicalNotes).examen : [],
)

const labComment = computed(() => {
  if (!props.visit) return ''
  return parsePrescribedExamCommentsByKind(props.visit.consultation?.clinicalNotes).examen?.trim() ?? ''
})

const vitals = computed(() => props.visit?.vitalSigns?.[0] ?? null)

const categoryLabel = computed(() => {
  if (!props.visit) return 'Standard'
  const { category } = props.visit.patient
  if (category) return patientCategoryLabel(category as PatientCategory)
  return 'Standard'
})

const doctorLabel = computed(() => {
  if (!props.visit) return '—'
  return buildPrescribedByLabel(
    props.visit.consultation?.doctor ?? props.visit.assignedDoctor ?? null,
  )
})

const transferredAt = computed(() => {
  const raw = props.visit?.consultation?.labSentToLabAt ?? props.visit?.updatedAt
  if (!raw) return '—'
  return new Date(raw).toLocaleString('fr-FR')
})

const completedAt = computed(() => {
  if (!props.visit) return null
  const parsed = parseLabResultsCompletedAt(props.visit.consultation?.clinicalNotes)
  if (parsed) return parsed.toLocaleString('fr-FR')
  if (props.completed && props.visit.consultation?.updatedAt) {
    return new Date(props.visit.consultation.updatedAt).toLocaleString('fr-FR')
  }
  return null
})

const sentByLabel = computed(() => {
  const user = props.visit?.consultation?.labApprovedBy
  if (!user) return null
  return fullName(user.firstName, user.lastName)
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.visit) emit('close')
}

watch(
  () => props.visit,
  (visit) => {
    document.body.style.overflow = visit ? 'hidden' : ''
  },
)

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})

function saisir() {
  if (!props.visit) return
  emit('saisir', props.visit.id)
}

function printResults() {
  if (!props.visit) return
  emit('print', props.visit.id)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="lab-modal">
      <div v-if="visit" class="modal-overlay" @click.self="emit('close')">
        <div class="modal modal--lab" role="dialog" aria-modal="true" aria-labelledby="lab-modal-title">
          <header class="modal__header">
            <div>
              <h2 id="lab-modal-title">
                {{ fullName(visit.patient.firstName, visit.patient.lastName) }}
              </h2>
              <p>
                {{ visit.patient.code }} — {{ categoryLabel }}
                <span v-if="completed" class="modal__badge">Clôturé</span>
              </p>
            </div>
            <button type="button" class="modal__close" aria-label="Fermer" @click="emit('close')">
              <X :size="18" />
            </button>
          </header>

          <div class="modal__body">
            <section class="info-grid">
              <article v-if="visit.patient.phone" class="info-card">
                <Phone :size="16" class="info-card__icon" />
                <div>
                  <span class="info-card__label">Téléphone</span>
                  <strong>{{ visit.patient.phone }}</strong>
                </div>
              </article>
              <article class="info-card">
                <Stethoscope :size="16" class="info-card__icon" />
                <div>
                  <span class="info-card__label">Prescripteur</span>
                  <strong>{{ doctorLabel }}</strong>
                </div>
              </article>
              <article v-if="completedAt" class="info-card">
                <Calendar :size="16" class="info-card__icon" />
                <div>
                  <span class="info-card__label">Terminé le</span>
                  <strong>{{ completedAt }}</strong>
                </div>
              </article>
              <article v-if="!completed" class="info-card">
                <Calendar :size="16" class="info-card__icon" />
                <div>
                  <span class="info-card__label">Transféré le</span>
                  <strong>{{ transferredAt }}</strong>
                </div>
              </article>
              <article v-if="sentByLabel" class="info-card">
                <Send :size="16" class="info-card__icon" />
                <div>
                  <span class="info-card__label">Envoyé par</span>
                  <strong>{{ sentByLabel }}</strong>
                </div>
              </article>
            </section>

            <section v-if="vitals" class="vitals-strip">
              <h3>
                <HeartPulse :size="15" />
                Constantes réception
              </h3>
              <div class="vitals-strip__items">
                <span v-if="vitals.weightKg" class="vital-pill">Poids {{ vitals.weightKg }} kg</span>
                <span v-if="vitals.bloodPressure" class="vital-pill">TA {{ vitals.bloodPressure }}</span>
                <span v-if="vitals.temperatureC" class="vital-pill">{{ vitals.temperatureC }} °C</span>
                <span v-if="vitals.pulseBpm" class="vital-pill">{{ vitals.pulseBpm }} bpm</span>
              </div>
            </section>

            <section class="exams-block">
              <header class="exams-block__head">
                <FlaskConical :size="17" />
                <h3>Examens laboratoire</h3>
                <span v-if="labExams.length" class="exams-block__count">{{ labExams.length }}</span>
              </header>

              <p v-if="!labExams.length" class="exams-block__empty">Aucun examen de laboratoire prescrit.</p>

              <ul v-else class="exam-tags">
                <li v-for="exam in labExams" :key="exam">{{ exam }}</li>
              </ul>

              <p v-if="labComment" class="exams-block__comment">
                <strong>Commentaire :</strong> {{ labComment }}
              </p>
            </section>
          </div>

          <footer class="modal__footer">
            <UiButton variant="ghost" @click="emit('close')">Fermer</UiButton>
            <UiButton
              v-if="completed"
              variant="outline"
              :icon="Printer"
              @click="printResults"
            >
              Imprimer
            </UiButton>
            <UiButton variant="primary" :icon="ClipboardEdit" @click="saisir">
              {{ completed ? 'Consulter les résultats' : 'Saisir les résultats' }}
            </UiButton>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(4px);
}

.modal {
  width: 100%;
  max-width: 32rem;
  max-height: min(90dvh, 680px);
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.modal--lab {
  max-width: 36rem;
}

.modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem 1.35rem 0;
  flex-shrink: 0;
}

.modal__header h2 {
  margin: 0;
  font-size: 1.125rem;
}

.modal__header p {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  margin: 0.35rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.modal__badge {
  display: inline-flex;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: #dcfce7;
  color: #166534;
}

.modal__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: 0;
  border-radius: 8px;
  background: #f1f5f9;
  color: var(--text-muted);
  cursor: pointer;
}

.modal__close:hover {
  background: #e2e8f0;
  color: var(--text);
}

.modal__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem 1.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.85rem 1.35rem 1.15rem;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.5rem;
}

.info-card {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  padding: 0.65rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #f8fafc;
}

.info-card__icon {
  flex-shrink: 0;
  margin-top: 0.1rem;
  color: #0d9488;
}

.info-card__label {
  display: block;
  margin-bottom: 0.1rem;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.info-card strong {
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.35;
}

.vitals-strip {
  padding: 0.75rem 0.85rem;
  border: 1px solid #99f6e4;
  border-radius: var(--radius-sm);
  background: #f0fdfa;
}

.vitals-strip h3 {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0 0 0.5rem;
  font-size: 0.8125rem;
  color: #0f766e;
}

.vitals-strip__items {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.vital-pill {
  padding: 0.25rem 0.55rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  background: #fff;
  border: 1px solid #99f6e4;
  color: #115e59;
}

.exams-block {
  padding: 0.85rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.exams-block__head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.65rem;
  color: #0f766e;
}

.exams-block__head h3 {
  margin: 0;
  flex: 1;
  font-size: 0.875rem;
}

.exams-block__count {
  min-width: 1.35rem;
  height: 1.35rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
  background: #14b8a6;
  color: #fff;
}

.exams-block__empty {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-muted);
}

.exam-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.exam-tags li {
  padding: 0.3rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 500;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #065f46;
}

.exams-block__comment {
  margin: 0.75rem 0 0;
  padding-top: 0.65rem;
  border-top: 1px dashed var(--border);
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.45;
}

.exams-block__comment strong {
  color: var(--text);
}

.lab-modal-enter-active,
.lab-modal-leave-active {
  transition: opacity 0.2s ease;
}

.lab-modal-enter-active .modal,
.lab-modal-leave-active .modal {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.lab-modal-enter-from,
.lab-modal-leave-to {
  opacity: 0;
}

.lab-modal-enter-from .modal,
.lab-modal-leave-to .modal {
  transform: scale(0.96);
  opacity: 0;
}
</style>
