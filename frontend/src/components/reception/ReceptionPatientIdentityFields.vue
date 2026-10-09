<script setup lang="ts">
import { computed } from 'vue'
import { Phone } from '@lucide/vue'
import UiInput from '@/components/ui/UiInput.vue'
import { PATIENT_AGE_UNITS, type PatientAgeUnit } from '@/lib/patient-age'
import { useAppI18n } from '@/i18n/useAppI18n'

const fullName = defineModel<string>('fullName', { required: true })
const age = defineModel<string>('age', { required: true })
const ageUnit = defineModel<PatientAgeUnit>('ageUnit', { default: 'YEARS' })
const phone = defineModel<string>('phone', { default: '' })
const gender = defineModel<string>('gender', { default: 'F' })

const { uiText, localeCode } = useAppI18n()

const ageUnits = computed(() => {
  void localeCode.value
  return PATIENT_AGE_UNITS.map((unit) => ({
    ...unit,
    label: uiText(unit.label),
    placeholder: uiText(unit.placeholder),
  }))
})

const activeAgeConfig = computed(() => {
  void localeCode.value
  return ageUnits.value.find((row) => row.value === ageUnit.value) ?? ageUnits.value[0]
})

const labels = computed(() => {
  void localeCode.value
  return {
    fullName: uiText('Nom et prénom'),
    phone: uiText('Téléphone (optionnel)'),
    age: uiText('Âge'),
    ageUnit: uiText("Unité d'âge"),
    gender: uiText('Genre'),
    female: uiText('Féminin'),
    male: uiText('Masculin'),
  }
})

const phoneHint = computed(() => {
  void localeCode.value
  const digits = phone.value.replace(/\D/g, '')
  if (!phone.value.trim()) return ''
  if (digits.length < 6) {
    return uiText('Si renseigné : au moins 6 chiffres (optionnel).')
  }
  return ''
})
</script>

<template>
  <div class="patient-identity">
    <div class="patient-identity__row patient-identity__row--name-phone">
      <UiInput
        v-model="fullName"
        :label="labels.fullName"
        :placeholder="uiText('Ex. Fatimé Abakar')"
        required
      />
      <div class="phone-field">
        <UiInput
          v-model="phone"
          :label="labels.phone"
          :placeholder="uiText('06 XX XX XX XX')"
          :icon="Phone"
        />
        <p v-if="phoneHint" class="phone-field__hint">{{ phoneHint }}</p>
      </div>
    </div>

    <div class="patient-identity__row patient-identity__row--age-gender">
      <span class="field-label field-label--inline">
        {{ labels.age }} <span class="field-label__req">*</span>
      </span>
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
      <div class="age-radios" role="radiogroup" :aria-label="labels.ageUnit">
        <label v-for="unit in ageUnits" :key="unit.value" class="age-radio">
          <input v-model="ageUnit" type="radio" name="patient-age-unit" :value="unit.value" />
          <span>{{ unit.label }}</span>
        </label>
      </div>
      <span class="field-label field-label--inline field-label--gender">{{ labels.gender }}</span>
      <div class="gender-options" role="group" :aria-label="labels.gender">
        <button
          type="button"
          class="gender-option"
          :class="{ 'gender-option--active': gender === 'F' }"
          @click="gender = 'F'"
        >
          {{ labels.female }}
        </button>
        <button
          type="button"
          class="gender-option"
          :class="{ 'gender-option--active': gender === 'M' }"
          @click="gender = 'M'"
        >
          {{ labels.male }}
        </button>
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

.phone-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.phone-field__hint {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--danger-600, #dc2626);
}

.patient-identity__row--age-gender {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.55rem 0.75rem;
}

.field-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 0.35rem;
}

.field-label--inline {
  margin-bottom: 0;
  white-space: nowrap;
}

.field-label--gender {
  margin-left: 0.35rem;
}

.field-label__req {
  color: var(--danger-500, #dc2626);
}

.age-field__input {
  width: 5.5rem;
  flex: 0 0 5.5rem;
}

.age-field__input :deep(.ui-field) {
  margin-bottom: 0;
}

.age-field__input :deep(.ui-field__label) {
  display: none;
}

.age-field__input :deep(.ui-field__input) {
  padding-top: 0.45rem;
  padding-bottom: 0.45rem;
  font-size: 0.9375rem;
  font-weight: 600;
}

.age-radios {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
}

.age-radio {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0;
  color: var(--text);
  font-size: 0.8125rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.age-radio input {
  margin: 0;
  accent-color: var(--primary-600, #2563eb);
  width: 1rem;
  height: 1rem;
  cursor: pointer;
}

.gender-options {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: auto;
}

.gender-option {
  padding: 0.45rem 0.7rem;
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

@media (max-width: 640px) {
  .patient-identity__row--name-phone {
    grid-template-columns: 1fr;
  }

  .patient-identity__row--age-gender {
    flex-wrap: wrap;
  }

  .gender-options {
    margin-left: 0;
  }
}
</style>
