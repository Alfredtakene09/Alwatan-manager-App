<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  CheckCircle2,
  ClipboardList,
  RefreshCw,
  X,
  FlaskConical,
  HeartPulse,
  Pencil,
  Plus,
} from '@lucide/vue'
import api from '@/api/client'
import { fullName } from '@/lib/roles'
import { parsePrescribedExamsByKind, parsePrescribedExamCommentsByKind } from '@/lib/lab-notes'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import MedecinStatsGrid from '@/components/MedecinStatsGrid.vue'
import MedecinPrescriptionModal, {
  type PrescriptionVisit,
} from '@/components/MedecinPrescriptionModal.vue'
import { countExamsByKind, emptyExamsByKind, emptyExamCommentsByKind, EXAM_KIND_LABELS, EXAM_KIND_ORDER } from '@/lib/exam-catalog'
import ConsultedPatientsDataTable, {
  type ConsultedVisitRow,
} from '@/components/ui/ConsultedPatientsDataTable.vue'

const visits = ref<ConsultedVisitRow[]>([])
const prescriptionVisit = ref<PrescriptionVisit | null>(null)
const prescriptionMode = ref<'edit' | 'append'>('append')
const viewVisitId = ref<string | null>(null)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const loading = ref(false)
const statsRefreshKey = ref(0)

const viewVisit = computed(() => visits.value.find((v) => v.id === viewVisitId.value) ?? null)
const viewExamsByKind = computed(() =>
  viewVisit.value
    ? parsePrescribedExamsByKind(viewVisit.value.consultation?.clinicalNotes)
    : emptyExamsByKind(),
)
const viewCommentsByKind = computed(() =>
  viewVisit.value
    ? parsePrescribedExamCommentsByKind(viewVisit.value.consultation?.clinicalNotes)
    : emptyExamCommentsByKind(),
)
const viewExamSections = computed(() =>
  EXAM_KIND_ORDER.map((kind) => ({
    kind,
    label: EXAM_KIND_LABELS[kind],
    exams: viewExamsByKind.value[kind],
    comment: viewCommentsByKind.value[kind]?.trim() ?? '',
  })).filter((section) => section.exams.length > 0 || section.comment),
)
const viewVitals = computed(() => viewVisit.value?.vitalSigns?.[0] ?? null)

const visitCountLabel = computed(() => {
  if (loading.value) return 'Chargement…'
  if (!visits.value.length) return 'Aucun patient consulté en attente de suivi'
  return `${visits.value.length} patient(s) en attente de paiement`
})

async function loadVisits() {
  if (prescriptionVisit.value) return
  loading.value = true
  try {
    const { data } = await api.get('/visits', { params: { queue: 'consulted' } })
    visits.value = data
    if (viewVisitId.value && !data.some((v: ConsultedVisitRow) => v.id === viewVisitId.value)) {
      closeViewModal()
    }
  } finally {
    loading.value = false
    statsRefreshKey.value += 1
  }
}

function openPrescriptionModal(id: string, mode: 'edit' | 'append') {
  const visit = visits.value.find((v) => v.id === id)
  if (!visit) return
  closeViewModal()
  prescriptionMode.value = mode
  prescriptionVisit.value = visit
  message.value = ''
}

function closePrescriptionModal() {
  prescriptionVisit.value = null
}

function openViewModal(id: string) {
  if (!visits.value.some((v) => v.id === id)) return
  closePrescriptionModal()
  viewVisitId.value = id
}

function closeViewModal() {
  viewVisitId.value = null
}

function onPrescriptionSaved() {
  message.value =
    prescriptionMode.value === 'append'
      ? 'Nouveaux examens ajoutés avec succès.'
      : 'Prescription mise à jour avec succès.'
  messageType.value = 'success'
  loadVisits()
}

onMounted(loadVisits)
</script>

<template>
  <div class="page-with-table page-with-table--medecin">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Déjà consulté"
        subtitle="Patients consultés — en attente de paiement à la réception"
        :icon="CheckCircle2"
      />

      <UiAlert v-if="message" :type="messageType" :message="message" />

      <MedecinStatsGrid :refresh-key="statsRefreshKey" />
    </section>

    <section class="page-with-table__body">
      <UiCard
        title="Patients déjà consultés"
        :description="visitCountLabel"
        class="ui-card--table-panel"
        :icon="ClipboardList"
        icon-variant="teal"
      >
        <template #actions>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadVisits">
            Actualiser
          </UiButton>
        </template>

        <p v-if="!loading && !visits.length" class="empty">
          Aucun patient consulté pour le moment. Les dossiers en attente de paiement apparaîtront ici.
        </p>
        <ConsultedPatientsDataTable
          v-else-if="visits.length || loading"
          fill
          :visits="visits"
          :selected-id="prescriptionVisit?.id ?? viewVisitId"
          :loading="loading"
          @view="openViewModal"
          @edit="openPrescriptionModal($event, 'edit')"
          @append="openPrescriptionModal($event, 'append')"
        />
      </UiCard>
    </section>

    <MedecinPrescriptionModal
      :visit="prescriptionVisit"
      :mode="prescriptionMode"
      @close="closePrescriptionModal"
      @saved="onPrescriptionSaved"
    />

    <Teleport to="body">
      <div v-if="viewVisit" class="modal-overlay" @click.self="closeViewModal">
        <div class="modal modal--consult" role="dialog" aria-modal="true" aria-labelledby="view-modal-title">
          <header class="modal__header">
            <div>
              <h2 id="view-modal-title">
                {{ fullName(viewVisit.patient.firstName, viewVisit.patient.lastName) }}
              </h2>
              <p>{{ viewVisit.patient.code }} — Examens prescrits</p>
            </div>
            <button type="button" class="modal__close" aria-label="Fermer" @click="closeViewModal">
              <X :size="18" />
            </button>
          </header>

          <div class="modal__body">
            <section class="info-section">
              <h3>Informations patient</h3>
              <dl class="info-grid">
                <div>
                  <dt>Matricule</dt>
                  <dd>{{ viewVisit.patient.code }}</dd>
                </div>
                <div v-if="viewVisit.patient.phone">
                  <dt>Téléphone</dt>
                  <dd>{{ viewVisit.patient.phone }}</dd>
                </div>
                <div v-if="viewVisit.assignedDoctor">
                  <dt>Médecin assigné</dt>
                  <dd>Dr {{ fullName(viewVisit.assignedDoctor.firstName, viewVisit.assignedDoctor.lastName) }}</dd>
                </div>
                <div>
                  <dt>Consulté le</dt>
                  <dd>
                    {{
                      new Date(viewVisit.consultation?.updatedAt ?? viewVisit.updatedAt).toLocaleString('fr-FR')
                    }}
                  </dd>
                </div>
              </dl>
            </section>

            <section v-if="viewVitals" class="info-section info-section--vitals">
              <h3>
                <HeartPulse :size="16" />
                Constantes (réception)
              </h3>
              <dl class="info-grid">
                <div v-if="viewVitals.weightKg">
                  <dt>Poids</dt>
                  <dd>{{ viewVitals.weightKg }} kg</dd>
                </div>
                <div v-if="viewVitals.bloodPressure">
                  <dt>Tension</dt>
                  <dd>{{ viewVitals.bloodPressure }}</dd>
                </div>
                <div v-if="viewVitals.temperatureC">
                  <dt>Température</dt>
                  <dd>{{ viewVitals.temperatureC }} °C</dd>
                </div>
                <div v-if="viewVitals.pulseBpm">
                  <dt>Pouls</dt>
                  <dd>{{ viewVitals.pulseBpm }} bpm</dd>
                </div>
              </dl>
            </section>

            <section class="info-section">
              <h3>
                <FlaskConical :size="16" />
                Examens prescrits
                <span v-if="countExamsByKind(viewExamsByKind)" class="exam-count">
                  ({{ countExamsByKind(viewExamsByKind) }})
                </span>
              </h3>

              <p v-if="!viewExamSections.length" class="exam-empty">Aucun examen prescrit pour cette consultation.</p>

              <div v-else class="exam-sections">
                <div v-for="section in viewExamSections" :key="section.kind" class="exam-section">
                  <h4>{{ section.label }}</h4>
                  <ul v-if="section.exams.length" class="exam-list">
                    <li v-for="exam in section.exams" :key="`${section.kind}-${exam}`">{{ exam }}</li>
                  </ul>
                  <p v-if="section.comment" class="exam-comment">{{ section.comment }}</p>
                </div>
              </div>
            </section>
          </div>

          <footer class="modal__footer">
            <UiButton variant="ghost" @click="closeViewModal">Fermer</UiButton>
            <UiButton variant="primary" :icon="Plus" @click="openPrescriptionModal(viewVisit.id, 'append')">
              Ajouter des examens
            </UiButton>
            <UiButton variant="outline" :icon="Pencil" @click="openPrescriptionModal(viewVisit.id, 'edit')">
              Modifier
            </UiButton>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.empty {
  text-align: center;
  color: var(--text-light);
  padding: 2rem 1rem;
  font-size: 0.875rem;
}

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
  max-width: 36rem;
  max-height: min(90dvh, 720px);
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.modal--consult {
  max-width: 42rem;
}

.modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.35rem 1.5rem 0;
  flex-shrink: 0;
}

.modal__header h2 {
  margin: 0;
  font-size: 1.2rem;
}

.modal__header p {
  margin: 0.35rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.modal__close {
  display: flex;
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
  padding: 1rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.info-section h3 {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.65rem;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--primary-800);
}

.info-section--vitals {
  padding: 0.85rem 1rem;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.65rem 1rem;
  margin: 0;
}

.info-grid dt {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-light);
  margin-bottom: 0.1rem;
}

.info-grid dd {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
}

.modal__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.65rem;
  padding: 1rem 1.5rem 1.35rem;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.exam-count {
  font-weight: 600;
  color: var(--text-muted);
}

.exam-empty {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-light);
}

.exam-sections {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.exam-section h4 {
  margin: 0 0 0.4rem;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--primary-700);
}

.exam-list {
  margin: 0;
  padding-left: 1.15rem;
}

.exam-list li {
  font-size: 0.875rem;
  font-weight: 500;
  padding: 0.15rem 0;
  color: var(--text);
}

.exam-comment {
  margin: 0.35rem 0 0;
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  background: var(--accent-50);
  border: 1px solid var(--accent-100);
  font-size: 0.8125rem;
  color: var(--text);
  line-height: 1.45;
}

@media (max-width: 900px) {
  .info-grid {
    grid-template-columns: 1fr;
  }

  .modal-overlay {
    padding: 0.75rem;
  }
}
</style>
