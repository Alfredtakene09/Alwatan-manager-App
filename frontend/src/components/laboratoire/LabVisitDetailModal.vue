<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Eye, Printer } from '@lucide/vue'
import api from '@/api/client'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import type { LabsWaitingVisitRow } from '@/components/ui/LabsWaitingDataTable.vue'
import { useLabPanelsStore } from '@/stores/lab-panels'
import { useAuthStore } from '@/stores/auth'
import { useAppI18n } from '@/i18n/useAppI18n'
import { fullName } from '@/lib/roles'
import { formatPatientAge, normalizePatientAgeUnit } from '@/lib/patient-age'
import {
  getFilledLabPanelSections,
  type LabPanelSlug,
} from '@/lib/lab-form-panels'
import {
  parseLabResultsCompletedAt,
  parsePrescribedExamsByKind,
} from '@/lib/lab-notes'
import {
  extractBasePanelLabel,
  extractSelectedFormLabels,
} from '@/lib/lab-prescribed-panels'
import { fetchAndPrintLabVisitResults } from '@/lib/lab-visit-print'

type Person = { firstName: string; lastName: string }

type DossierVisit = LabsWaitingVisitRow & {
  consultation?: LabsWaitingVisitRow['consultation'] & {
    labRecordedBy?: Person | null
  }
}

type DossierResponse = {
  visit: DossierVisit
  panelResults: Partial<Record<LabPanelSlug, Record<string, string>>>
  completed?: boolean
  prescribedPanels?: Array<{ slug: string; label: string; examLabel: string }>
}

const props = defineProps<{
  visitId: string | null
}>()

const open = defineModel<boolean>('open', { default: false })

const { uiText, examNameText, isArabic } = useAppI18n()
const labPanels = useLabPanelsStore()
const auth = useAuthStore()
const dateLocale = computed(() => (isArabic.value ? 'ar-TD' : 'fr-FR'))

const loading = ref(false)
const loadError = ref('')
const printError = ref('')
const printing = ref(false)
const dossier = ref<DossierResponse | null>(null)

const visit = computed(() => dossier.value?.visit ?? null)
const patient = computed(() => visit.value?.patient ?? null)
const patientName = computed(() =>
  patient.value ? fullName(patient.value.firstName, patient.value.lastName) : '—',
)
const doctorName = computed(() => {
  const doctor = visit.value?.consultation?.doctor ?? visit.value?.assignedDoctor
  if (!doctor) return uiText('Patient externe — Réception')
  return `Dr ${fullName(doctor.firstName, doctor.lastName)}`
})
const ageLabel = computed(() => {
  if (!patient.value) return null
  return formatPatientAge(patient.value.age, normalizePatientAgeUnit(patient.value.ageUnit))
})
const completed = computed(() => Boolean(dossier.value?.completed))
const recordedBy = computed(() => {
  const person = visit.value?.consultation?.labRecordedBy
  if (!person) return ''
  return fullName(person.firstName, person.lastName)
})

function formatWhen(raw?: string | null) {
  if (!raw) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return null
  return {
    date: date.toLocaleDateString(dateLocale.value, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    time: date.toLocaleTimeString(dateLocale.value, { hour: '2-digit', minute: '2-digit' }),
  }
}

const sentAt = computed(() =>
  formatWhen(visit.value?.consultation?.labSentToLabAt ?? visit.value?.updatedAt),
)
const completedAt = computed(() =>
  formatWhen(parseLabResultsCompletedAt(visit.value?.consultation?.clinicalNotes)?.toISOString()),
)

const examRows = computed(() => {
  const labels = parsePrescribedExamsByKind(visit.value?.consultation?.clinicalNotes).examen
  const groups = new Map<string, string[]>()
  for (const label of labels) {
    const base = extractBasePanelLabel(label) || label
    const fields = extractSelectedFormLabels(label) ?? []
    const current = groups.get(base) ?? []
    for (const field of fields) {
      if (!current.includes(field)) current.push(field)
    }
    groups.set(base, current)
  }
  const status = completed.value ? uiText('Terminé') : uiText('En attente')
  return [...groups.entries()].map(([base, fields]) => ({
    kind: examNameText(base),
    label: fields.length ? fields.map((field) => examNameText(field)).join(', ') : examNameText(base),
    status,
  }))
})

const resultRows = computed(() => {
  const panels = dossier.value?.prescribedPanels ?? []
  const results = dossier.value?.panelResults ?? {}
  const rows: Array<{ kind: string; label: string; value: string }> = []
  for (const panel of panels) {
    const saved = results[panel.slug]
    if (!saved) continue
    const form = labPanels.getPanel(panel.slug)
    const kind = examNameText(panel.examLabel || panel.label)
    if (!form) continue
    for (const section of getFilledLabPanelSections(form, saved)) {
      for (const field of section.fields) {
        const label = field.reference
          ? `${examNameText(field.label)} (${field.reference})`
          : examNameText(field.label)
        const value = [field.value, field.unit].filter(Boolean).join(' ')
        rows.push({
          kind,
          label: field.comment ? `${label} — ${field.comment}` : label,
          value: value || '—',
        })
      }
    }
  }
  return rows
})

async function load() {
  if (!props.visitId) return
  loading.value = true
  loadError.value = ''
  printError.value = ''
  dossier.value = null
  try {
    await labPanels.fetchPanels()
    const { data } = await api.get<DossierResponse>(`/laboratoire/visits/${props.visitId}`)
    dossier.value = data
  } catch {
    loadError.value = uiText('Impossible de charger le dossier laboratoire.')
  } finally {
    loading.value = false
  }
}

watch(
  () => [open.value, props.visitId] as const,
  ([isOpen, visitId]) => {
    if (isOpen && visitId) void load()
    if (!isOpen) {
      dossier.value = null
      loadError.value = ''
      printError.value = ''
    }
  },
)

function close() {
  open.value = false
}

async function printResults() {
  if (!visit.value) return
  printing.value = true
  printError.value = ''
  const result = await fetchAndPrintLabVisitResults(visit.value, auth.user, 'laboratoire')
  printing.value = false
  if (!result.ok) printError.value = result.error
}
</script>

<template>
  <UiFormModal
    :open="open"
    title="Détail du laboratoire"
    :subtitle="patient ? `${patient.code} — ${patientName}` : undefined"
    :icon="Eye"
    size="wide"
    @close="close"
  >
    <p v-if="loading" class="lab-detail__hint">{{ uiText('Chargement du dossier…') }}</p>
    <p v-else-if="loadError" class="lab-detail__hint">{{ loadError }}</p>

    <div v-else-if="visit && patient" class="lab-detail">
      <section class="lab-detail__section">
        <h3>{{ uiText('Patient') }}</h3>
        <dl class="lab-detail__grid">
          <div>
            <dt>{{ uiText('Matricule') }}</dt>
            <dd>{{ patient.code }}</dd>
          </div>
          <div>
            <dt>{{ uiText('Patient') }}</dt>
            <dd>{{ patientName }}</dd>
          </div>
          <div v-if="patient.phone">
            <dt>{{ uiText('Tél.') }}</dt>
            <dd dir="ltr">{{ patient.phone }}</dd>
          </div>
          <div v-if="ageLabel">
            <dt>{{ uiText('Âge') }}</dt>
            <dd>{{ ageLabel }}</dd>
          </div>
          <div>
            <dt>{{ uiText('Médecin') }}</dt>
            <dd>{{ doctorName }}</dd>
          </div>
        </dl>
      </section>

      <section class="lab-detail__section">
        <h3>{{ uiText('Laboratoire') }}</h3>
        <dl class="lab-detail__grid">
          <div>
            <dt>{{ uiText('Statut') }}</dt>
            <dd>{{ completed ? uiText('Terminé') : uiText('En attente') }}</dd>
          </div>
          <div>
            <dt>{{ uiText('Transféré le') }}</dt>
            <dd>{{ sentAt?.date ?? '—' }}</dd>
          </div>
          <div>
            <dt>{{ uiText('Heure') }}</dt>
            <dd dir="ltr">{{ sentAt?.time ?? '—' }}</dd>
          </div>
          <div v-if="completed && completedAt">
            <dt>{{ uiText('Terminé le') }}</dt>
            <dd>{{ completedAt.date }} · {{ completedAt.time }}</dd>
          </div>
          <div v-if="recordedBy">
            <dt>{{ uiText('Saisi par') }}</dt>
            <dd>{{ recordedBy }}</dd>
          </div>
        </dl>
      </section>

      <section class="lab-detail__section">
        <h3>{{ uiText('Examens') }}</h3>
        <ul v-if="examRows.length" class="lab-detail__rows">
          <li v-for="(row, index) in examRows" :key="`${row.kind}-${index}`">
            <span class="lab-detail__kind">{{ row.kind }}</span>
            <span class="lab-detail__label">{{ row.label }}</span>
            <strong>{{ row.status }}</strong>
          </li>
        </ul>
        <p v-else class="lab-detail__hint">{{ uiText('Aucun examen') }}</p>
      </section>

      <section class="lab-detail__section">
        <h3>{{ uiText('Résultats') }}</h3>
        <ul v-if="resultRows.length" class="lab-detail__rows">
          <li v-for="(row, index) in resultRows" :key="`${row.kind}-${row.label}-${index}`">
            <span class="lab-detail__kind">{{ row.kind }}</span>
            <span class="lab-detail__label">{{ row.label }}</span>
            <strong dir="ltr">{{ row.value }}</strong>
          </li>
        </ul>
        <p v-else class="lab-detail__hint">{{ uiText('Aucun résultat saisi pour le moment.') }}</p>
      </section>

      <p v-if="printError" class="lab-detail__hint">{{ printError }}</p>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="close">{{ uiText('Fermer') }}</UiButton>
      <UiButton
        v-if="completed && resultRows.length"
        variant="primary"
        :icon="Printer"
        :disabled="printing"
        @click="printResults"
      >
        {{ printing ? uiText('Impression…') : uiText('Imprimer') }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.lab-detail {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.lab-detail__section h3 {
  margin: 0 0 0.65rem;
  font-size: 0.8125rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-light, #64748b);
}

.lab-detail__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem 1rem;
  margin: 0;
}

.lab-detail__grid dt {
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-light, #64748b);
}

.lab-detail__grid dd {
  margin: 0.15rem 0 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text, #0f172a);
}

.lab-detail__rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.lab-detail__rows li {
  display: grid;
  grid-template-columns: 7.5rem 1fr auto;
  gap: 0.5rem 0.75rem;
  align-items: baseline;
  padding: 0.55rem 0.65rem;
  border-radius: 0.5rem;
  background: var(--surface-muted, #f8fafc);
  font-size: 0.8125rem;
}

.lab-detail__kind {
  font-weight: 600;
  color: var(--brand-red-700, #b71c1c);
}

.lab-detail__label {
  color: var(--text, #0f172a);
}

.lab-detail__hint {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-light, #64748b);
}

@media (max-width: 640px) {
  .lab-detail__grid {
    grid-template-columns: 1fr;
  }

  .lab-detail__rows li {
    grid-template-columns: 1fr;
  }
}
</style>
