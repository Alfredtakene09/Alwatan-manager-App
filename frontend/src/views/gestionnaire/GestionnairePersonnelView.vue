<script setup lang="ts">
import { onMounted, ref } from 'vue'
import axios from 'axios'
import { Users, Plus, Pencil } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import GestionnaireEmployeeFormModal, {
  type GestionnaireEmployeeEdit,
  type GestionnaireEmployeeFormPayload,
} from '@/components/gestionnaire/GestionnaireEmployeeFormModal.vue'
import GestionnaireRowAction from '@/components/gestionnaire/GestionnaireRowAction.vue'
import GestionnaireRowActionGroup from '@/components/gestionnaire/GestionnaireRowActionGroup.vue'
import '@/assets/gestionnaire-page.css'

type Employee = GestionnaireEmployeeEdit

const rows = ref<Employee[]>([])
const loading = ref(false)
const saving = ref(false)
const showModal = ref(false)
const editingEmployee = ref<Employee | null>(null)
const formError = ref('')

const statusFilter = ref('')
const serviceFilter = ref('')

const contractOptions = [
  { value: 'ACTIF', label: 'Actif' },
  { value: 'EN_CONGE', label: 'En congé' },
  { value: 'INACTIF', label: 'Inactif' },
]

function openCreate() {
  editingEmployee.value = null
  formError.value = ''
  showModal.value = true
}

function openEdit(row: Employee) {
  editingEmployee.value = row
  formError.value = ''
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  editingEmployee.value = null
  formError.value = ''
}

async function loadRows() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (statusFilter.value) params.set('status', statusFilter.value)
    if (serviceFilter.value.trim()) params.set('service', serviceFilter.value.trim())
    const qs = params.toString()
    const { data } = await api.get<Employee[]>(`/gestionnaire/employees${qs ? `?${qs}` : ''}`)
    rows.value = data
  } finally {
    loading.value = false
  }
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === 'string') {
    return error.response.data.error
  }
  return fallback
}

async function submitForm(payload: GestionnaireEmployeeFormPayload) {
  saving.value = true
  formError.value = ''
  try {
    if (editingEmployee.value) {
      await api.put(`/gestionnaire/employees/${editingEmployee.value.id}`, payload)
    } else {
      await api.post('/gestionnaire/employees', payload)
    }
    closeModal()
    await loadRows()
  } catch (error) {
    formError.value = apiErrorMessage(
      error,
      editingEmployee.value
        ? 'Impossible de mettre à jour cet employé.'
        : 'Impossible de créer cet employé.',
    )
  } finally {
    saving.value = false
  }
}

onMounted(loadRows)
</script>

<template>
  <div class="gestionnaire-page">
    <UiPageHeader title="Personnel" subtitle="Fiches employés et contrats" :icon="Users">
      <template #actions>
        <UiButton
          :icon="Plus"
          class="gestionnaire-icon-btn"
          aria-label="Nouvel employé"
          title="Nouvel employé"
          @click="openCreate"
        />
      </template>
    </UiPageHeader>

    <UiCard class="personnel-card" title="Liste du personnel" description="Filtres par service et statut">
      <div class="filters">
        <UiSelect
          v-model="statusFilter"
          label="Statut"
          @update:model-value="loadRows"
        >
          <option value="">Tous</option>
          <option v-for="opt in contractOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </UiSelect>
        <UiInput v-model="serviceFilter" label="Service" placeholder="Filtrer…" />
        <UiButton size="sm" variant="ghost" @click="loadRows">Filtrer</UiButton>
      </div>

      <div v-if="loading" class="chart-empty">Chargement…</div>
      <div v-else-if="!rows.length" class="chart-empty">Aucun employé</div>
      <div v-else class="personnel-table-wrap">
        <table class="gestionnaire-table personnel-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Poste</th>
              <th>Service</th>
              <th>Téléphone</th>
              <th>Salaire fixe</th>
              <th>Statut</th>
              <th class="col-actions"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td>{{ fullName(row.firstName, row.lastName) }}</td>
              <td>{{ row.jobTitle ?? '—' }}</td>
              <td>{{ row.service ?? '—' }}</td>
              <td>{{ row.phone ?? '—' }}</td>
              <td>{{ row.fixedSalaryFcfa != null ? formatFcfa(row.fixedSalaryFcfa) : '—' }}</td>
              <td>
                <span class="status-badge status-badge--validated">{{ row.contractStatus }}</span>
              </td>
              <td class="actions">
                <GestionnaireRowActionGroup>
                  <GestionnaireRowAction
                    :icon="Pencil"
                    label="Modifier"
                    variant="edit"
                    @click="openEdit(row)"
                  />
                </GestionnaireRowActionGroup>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCard>

    <GestionnaireEmployeeFormModal
      :open="showModal"
      :saving="saving"
      :employee="editingEmployee"
      :error-message="formError"
      @close="closeModal"
      @submit="submitForm"
    />
  </div>
</template>

<style scoped>
.personnel-card {
  padding: 0.25rem;
}

.personnel-table-wrap {
  margin-top: 0.75rem;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 12px;
  overflow-x: auto;
}

.personnel-table th,
.personnel-table td {
  padding: 0.8rem 1rem;
}

.personnel-table td:first-child {
  font-weight: 600;
}
</style>
