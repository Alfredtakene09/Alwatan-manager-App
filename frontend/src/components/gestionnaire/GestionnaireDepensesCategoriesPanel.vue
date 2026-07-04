<script setup lang="ts">
import { onMounted, ref } from 'vue'
import axios from 'axios'
import { Plus, Pencil, Trash2, Tags } from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal, showApiErrorModal } from '@/lib/api-modal-helper'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import GestionnaireRowAction from '@/components/gestionnaire/GestionnaireRowAction.vue'
import GestionnaireRowActionGroup from '@/components/gestionnaire/GestionnaireRowActionGroup.vue'
import GestionnaireExpenseCategoryFormModal, {
  type ExpenseCategoryEdit,
  type ExpenseCategoryFormPayload,
} from '@/components/gestionnaire/GestionnaireExpenseCategoryFormModal.vue'
import '@/assets/gestionnaire-page.css'

type ExpenseCategory = ExpenseCategoryEdit

const rows = ref<ExpenseCategory[]>([])
const loading = ref(false)
const saving = ref(false)
const showModal = ref(false)
const editingCategory = ref<ExpenseCategoryEdit | null>(null)
const formError = ref('')

async function loadRows() {
  loading.value = true
  try {
    const { data } = await api.get<ExpenseCategory[]>('/gestionnaire/expense-categories')
    rows.value = data
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingCategory.value = null
  formError.value = ''
  showModal.value = true
}

function openEdit(row: ExpenseCategory) {
  editingCategory.value = {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    sortOrder: row.sortOrder,
  }
  formError.value = ''
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  editingCategory.value = null
  formError.value = ''
}

function nextSortOrder() {
  if (!rows.value.length) return 0
  return Math.max(...rows.value.map((r) => r.sortOrder), -1) + 1
}

async function submitForm(payload: ExpenseCategoryFormPayload) {
  saving.value = true
  formError.value = ''
  try {
    const body = {
      ...payload,
      sortOrder: editingCategory.value?.sortOrder ?? nextSortOrder(),
    }
    if (editingCategory.value?.id) {
      await api.put(`/gestionnaire/expense-categories/${editingCategory.value.id}`, body)
    } else {
      await api.post('/gestionnaire/expense-categories', body)
    }
    closeModal()
    await loadRows()
  } catch (error) {
    formError.value =
      axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
        ? error.response.data.error
        : 'Enregistrement impossible.'
  } finally {
    saving.value = false
  }
}

async function deleteCategory(row: ExpenseCategory) {
  const ok = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer la catégorie',
    message: `« ${row.name} » sera supprimée définitivement. Les dépenses associées resteront enregistrées sans cette catégorie.`,
    confirmLabel: 'Supprimer',
  })
  if (!ok) return
  try {
    await api.delete(`/gestionnaire/expense-categories/${row.id}`)
    await loadRows()
  } catch (error) {
    await showApiErrorModal(error, 'Suppression impossible.')
  }
}

onMounted(loadRows)

defineExpose({ reload: loadRows })
</script>

<template>
  <UiCard class="categories-card">
    <div class="categories-card__head">
      <div class="categories-card__intro">
        <div class="categories-card__icon" aria-hidden="true">
          <Tags :size="18" />
        </div>
        <div>
          <h2 class="categories-card__title">Catégories de dépenses</h2>
          <p class="categories-card__desc">Organisez les natures de sorties de caisse</p>
        </div>
      </div>
      <UiButton :icon="Plus" size="sm" @click="openCreate">Nouvelle catégorie</UiButton>
    </div>

    <div v-if="loading" class="categories-state">Chargement…</div>

    <div v-else-if="!rows.length" class="categories-empty">
      <div class="categories-empty__icon" aria-hidden="true">
        <Tags :size="28" />
      </div>
      <p class="categories-empty__title">Aucune catégorie</p>
      <p class="categories-empty__text">Créez des catégories pour classer vos dépenses.</p>
      <UiButton :icon="Plus" size="sm" @click="openCreate">Créer une catégorie</UiButton>
    </div>

    <div v-else class="categories-table-wrap">
      <table class="gestionnaire-table categories-table">
        <thead>
          <tr>
            <th>Catégorie</th>
            <th class="col-actions"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>
              <span class="category-cell">
                <span
                  class="category-cell__swatch"
                  :style="{ background: row.color }"
                />
                <span class="category-cell__name">{{ row.name }}</span>
              </span>
            </td>
            <td class="actions">
              <GestionnaireRowActionGroup>
                <GestionnaireRowAction
                  :icon="Pencil"
                  label="Modifier"
                  variant="edit"
                  @click="openEdit(row)"
                />
                <GestionnaireRowAction
                  :icon="Trash2"
                  label="Supprimer"
                  variant="danger"
                  @click="deleteCategory(row)"
                />
              </GestionnaireRowActionGroup>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </UiCard>

  <GestionnaireExpenseCategoryFormModal
    :open="showModal"
    :saving="saving"
    :category="editingCategory"
    :error-message="formError"
    @close="closeModal"
    @submit="submitForm"
  />
</template>

<style scoped>
.categories-card :deep(.ui-card__body) {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.categories-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.categories-card__intro {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.categories-card__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.35rem;
  height: 2.35rem;
  border-radius: 11px;
  background: rgba(245, 158, 11, 0.14);
  color: #b45309;
  flex-shrink: 0;
}

.categories-card__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
  color: #1c1917;
  letter-spacing: -0.02em;
}

.categories-card__desc {
  margin: 0.15rem 0 0;
  font-size: 0.8125rem;
  color: #78716c;
}

.categories-state {
  padding: 2rem 1rem;
  text-align: center;
  color: #78716c;
  font-size: 0.875rem;
}

.categories-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.45rem;
  padding: 2rem 1.25rem;
  border-radius: 14px;
  background: linear-gradient(180deg, #fffbeb 0%, #fff 100%);
  border: 1px dashed rgba(217, 119, 6, 0.28);
}

.categories-empty__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.5rem;
  height: 3.5rem;
  margin-bottom: 0.2rem;
  border-radius: 999px;
  background: #fff;
  color: #d97706;
  border: 1px solid rgba(217, 119, 6, 0.2);
}

.categories-empty__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  color: #44403c;
}

.categories-empty__text {
  margin: 0 0 0.35rem;
  font-size: 0.875rem;
  color: #78716c;
}

.categories-table-wrap {
  overflow-x: auto;
  border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.06);
}

.categories-table tbody tr:hover {
  background: rgba(255, 251, 235, 0.65);
}

.category-cell {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
}

.category-cell__swatch {
  width: 1rem;
  height: 1rem;
  border-radius: 6px;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
}

.category-cell__name {
  font-weight: 600;
  color: #292524;
}
</style>
