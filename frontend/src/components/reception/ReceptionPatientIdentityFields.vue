<script setup lang="ts">
import { computed } from 'vue'
import { Phone } from '@lucide/vue'
import UiInput from '@/components/ui/UiInput.vue'
import { PATIENT_AGE_UNITS, type PatientAgeUnit } from '@/lib/patient-age'

const fullName = defineModel<string>('fullName', { required: true })
const age = defineModel<string>('age', { required: true })
const ageUnit = defineModel<PatientAgeUnit>('ageUnit', { default: 'YEARS' })
const phone = defineModel<string>('phone', { default: '' })
const gender = defineModel<string>('gender', { default: 'F' })

const activeAgeConfig = computed(
  () => PATIENT_AGE_UNITS.find((row) => row.value === ageUnit.value) ?? PATIENT_AGE_UNITS[0],
)
</script>

<template>
  <div class="patient-identity">
    <div class="patient-identity__row patient-identity__row--name-phone">
      <UiInput
        v-model="fullName"
        label="Nom et prénom"
        placeholder="Ex. Fatimé Abakar"
        required
      />
      <UiInput
        v-model="phone"
        label="Téléphone"
        placeholder="06 XX XX XX XX"
        :icon="Phone"
      />
    </div>

    <div class="patient-identity__row patient-identity__row--age-gender">
      <div class="age-field">
        <span class="field-label">Âge <span class="field-label__req">*</span></span>
        <div class="age-field__body">
          <UiInput
            v-model="age"
            :label="''"
            type="number"
            min="0"
            :max="activeAgeConfig.max"
            :placeholder="activeAgeConfig.placeholder"
            required
            class="age-field__input"
          />
          <div class="age-units" role="group" aria-label="Unité d'âge">
            <button
              v-for="unit in PATIENT_AGE_UNITS"
              :key="unit.value"
              type="button"
              class="age-unit"
              :class="{ 'age-unit--active': ageUnit === unit.value }"
              @click="ageUnit = unit.value"
            >
              {{ unit.label }}
            </button>
          </div>
        </div>
      </div>

      <div class="gender-field">
        <span class="field-label">Genre</span>
        <div class="gender-options" role="group" aria-label="Genre">
          <button
            type="button"
            class="gender-option"
            :class="{ 'gender-option--active': gender === 'F' }"
            @click="gender = 'F'"
          >
            Féminin
          </button>
          <button
            type="button"
            class="gender-option"
            :class="{ 'gender-option--active': gender === 'M' }"
            @click="gender = 'M'"
          >
            Masculin
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.patient-identity {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.patient-identity__row {
  display: grid;
  gap: 0.65rem;
}

.patient-identity__row--name-phone {
  grid-template-columns: 1fr 1fr;
}

.patient-identity__row--age-gender {
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  align-items: start;
}

.field-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 0.35rem;
}

.field-label__req {
  color: var(--danger-500, #dc2626);
}

.age-field__body {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.age-field__input {
  width: 6.25rem;
}

.age-field__input :deep(.ui-field__label) {
  display: none;
}

.age-field__input :deep(.ui-field__input) {
  padding-top: 0.55rem;
  padding-bottom: 0.55rem;
  font-size: 0.9375rem;
  font-weight: 600;
}

.age-units {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.3rem;
}

.age-unit {
  padding: 0.52rem 0.35rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.age-unit--active {
  border-color: var(--primary-500);
  background: var(--primary-50);
  color: var(--primary-800);
}

.gender-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem;
}

.gender-option {
  padding: 0.52rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
  white-space: nowrap;
}

.gender-option--active {
  border-color: var(--primary-500);
  background: var(--primary-50);
  color: var(--primary-800);
}

@media (max-width: 480px) {
  .patient-identity__row--name-phone,
  .patient-identity__row--age-gender {
    grid-template-columns: 1fr;
  }

  .age-field__input {
    width: 100%;
    max-width: 7rem;
  }
}
</style>
