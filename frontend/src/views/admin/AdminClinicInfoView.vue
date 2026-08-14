<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { Building2, ImagePlus, RefreshCw, Save, Upload } from '@lucide/vue'
import {
  CLINIC,
  DEFAULT_CLINIC,
  applyClinicInfo,
  loadClinicInfo,
  saveClinicInfo,
  uploadClinicLogo,
  type ClinicInfo,
} from '@/lib/clinic'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import { useAppI18n } from '@/i18n/useAppI18n'

const { uiText, isArabic } = useAppI18n()

const loading = ref(false)
const saving = ref(false)
const uploadingLogo = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const logoInputRef = ref<HTMLInputElement | null>(null)

const form = ref<ClinicInfo>({ ...CLINIC })

const previewFullAddress = computed(() => {
  const explicit = form.value.fullAddress.trim()
  if (explicit) return explicit
  return [form.value.city.trim(), form.value.address.trim()].filter(Boolean).join(', ')
})

const previewPhoneLabel = computed(() => {
  const explicit = form.value.phoneLabel.trim()
  if (explicit) return explicit
  return form.value.phones.trim() ? `Tel : ${form.value.phones.trim()}` : ''
})

const previewTaxLine = computed(() => {
  const parts: string[] = []
  if (form.value.nif.trim()) parts.push(`${uiText('NIF')} : ${form.value.nif.trim()}`)
  if (form.value.rc.trim()) parts.push(`${uiText('RC')} : ${form.value.rc.trim()}`)
  return parts.join(' · ')
})

const previewLogoSrc = computed(() => form.value.logo || DEFAULT_CLINIC.logo)

function syncFormFromClinic() {
  form.value = { ...CLINIC }
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === 'string') {
    return error.response.data.error
  }
  return fallback
}

async function reload() {
  loading.value = true
  message.value = ''
  try {
    await loadClinicInfo({ force: true })
    syncFormFromClinic()
  } catch (error) {
    message.value = apiErrorMessage(error, 'Impossible de charger les infos clinique.')
    messageType.value = 'error'
  } finally {
    loading.value = false
  }
}

function openLogoPicker() {
  logoInputRef.value?.click()
}

async function onLogoSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  if (!file.type.startsWith('image/')) {
    message.value = 'Sélectionnez une image (JPEG, PNG, WebP ou GIF).'
    messageType.value = 'error'
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    message.value = 'Le logo ne doit pas dépasser 5 Mo.'
    messageType.value = 'error'
    return
  }

  uploadingLogo.value = true
  message.value = ''
  try {
    await uploadClinicLogo(file)
    syncFormFromClinic()
    message.value = 'Logo téléversé et enregistré sur le disque.'
    messageType.value = 'success'
  } catch (error) {
    message.value = apiErrorMessage(error, 'Upload du logo impossible.')
    messageType.value = 'error'
  } finally {
    uploadingLogo.value = false
  }
}

async function save() {
  const nameFr = form.value.nameFr.trim()
  const nameAr = form.value.nameAr.trim()
  const phones = form.value.phones.trim()
  const email = form.value.email.trim()
  if (nameFr.length < 2) {
    message.value = 'Le nom français doit contenir au moins 2 caractères.'
    messageType.value = 'error'
    return
  }
  if (!nameAr) {
    message.value = 'Le nom arabe est obligatoire.'
    messageType.value = 'error'
    return
  }
  if (!phones) {
    message.value = 'Le téléphone est obligatoire.'
    messageType.value = 'error'
    return
  }
  if (!email || !email.includes('@')) {
    message.value = 'Adresse e-mail invalide.'
    messageType.value = 'error'
    return
  }

  saving.value = true
  message.value = ''
  try {
    const city = form.value.city.trim() || DEFAULT_CLINIC.city
    const address = form.value.address.trim() || DEFAULT_CLINIC.address
    const payload: ClinicInfo = {
      nameFr,
      nameAr,
      shortName: form.value.shortName.trim() || nameFr,
      logo: form.value.logo.trim() || DEFAULT_CLINIC.logo,
      city,
      address,
      fullAddress: [city, address].filter(Boolean).join(', '),
      phones,
      phoneLabel: `Tel : ${phones}`,
      email,
      nif: form.value.nif.trim(),
      rc: form.value.rc.trim(),
      printFooter: form.value.printFooter.trim(),
    }
    await saveClinicInfo(payload)
    applyClinicInfo(payload)
    syncFormFromClinic()
    message.value = 'Informations clinique enregistrées. Elles s’appliquent aux tickets et PDF.'
    messageType.value = 'success'
  } catch (error) {
    message.value = apiErrorMessage(error, 'Enregistrement impossible.')
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  syncFormFromClinic()
  void reload()
})
</script>

<template>
  <div class="clinic-info-page" :class="{ 'lang-ar': isArabic }" :lang="isArabic ? 'ar' : undefined">
    <UiPageHeader
      title="Infos clinique"
      subtitle="Coordonnées affichées sur les tickets, PDF et exports de tous les modules."
      :icon="Building2"
    >
      <template #actions>
        <UiButton variant="ghost" :disabled="loading || saving || uploadingLogo" @click="reload">
          <RefreshCw :size="16" />
          {{ uiText('Actualiser') }}
        </UiButton>
        <UiButton :disabled="loading || saving || uploadingLogo" @click="save">
          <Save :size="16" />
          {{ saving ? uiText('Enregistrement…') : uiText('Enregistrer') }}
        </UiButton>
      </template>
    </UiPageHeader>

    <UiAlert v-if="message" :type="messageType" :message="message" class="clinic-info-page__alert" />

    <UiCard class="clinic-info-page__card">
      <div class="clinic-info-page__fields">
        <UiInput v-model="form.nameFr" label="Nom (français)" :disabled="loading || saving" />
        <UiInput
          v-model="form.nameAr"
          label="Nom (arabe)"
          dir="rtl"
          lang="ar"
          :disabled="loading || saving"
        />

        <UiInput
          v-model="form.shortName"
          label="Nom court (tickets)"
          :disabled="loading || saving"
        />
        <UiInput v-model="form.email" type="email" label="E-mail" :disabled="loading || saving" />

        <UiInput v-model="form.city" label="Ville / pays" :disabled="loading || saving" />
        <UiInput v-model="form.address" label="Adresse" :disabled="loading || saving" />

        <UiInput v-model="form.phones" label="Téléphone(s)" :disabled="loading || saving" />
        <UiInput
          v-model="form.printFooter"
          label="Mention / pied de page"
          :disabled="loading || saving"
        />

        <UiInput v-model="form.nif" label="NIF" :disabled="loading || saving" />
        <UiInput v-model="form.rc" label="RC" :disabled="loading || saving" />

        <div class="clinic-logo-field">
          <div class="clinic-logo-field__thumb">
            <img v-if="previewLogoSrc" :src="previewLogoSrc" :alt="form.nameFr" />
            <ImagePlus v-else :size="24" />
          </div>
          <div class="clinic-logo-field__actions">
            <span class="clinic-logo-field__label">{{ uiText('Logo') }}</span>
            <UiButton
              variant="ghost"
              :disabled="loading || saving || uploadingLogo"
              @click="openLogoPicker"
            >
              <Upload :size="16" />
              {{ uploadingLogo ? uiText('Téléversement…') : uiText('Téléverser un logo') }}
            </UiButton>
          </div>
          <input
            ref="logoInputRef"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
            class="clinic-logo-field__input"
            @change="onLogoSelected"
          />
        </div>

        <div class="clinic-preview">
          <img :src="previewLogoSrc" :alt="form.nameFr" class="clinic-preview__logo" />
          <div class="clinic-preview__info">
            <strong>{{ form.nameFr || '—' }}</strong>
            <p class="clinic-preview__ar" dir="rtl" lang="ar">{{ form.nameAr || '—' }}</p>
            <p>{{ previewFullAddress || '—' }}</p>
            <p>{{ previewPhoneLabel || '—' }}</p>
            <p v-if="form.email">{{ uiText('Email :') }} {{ form.email }}</p>
            <p v-if="previewTaxLine">{{ previewTaxLine }}</p>
            <p v-if="form.printFooter">{{ form.printFooter }}</p>
          </div>
        </div>
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.clinic-info-page {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  max-width: 52rem;
}

.clinic-info-page__alert {
  margin: 0;
}

.clinic-info-page__card {
  padding: 1rem;
}

.clinic-info-page__fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem 1rem;
  align-items: start;
}

.clinic-logo-field,
.clinic-preview {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 5.25rem;
  padding: 0.65rem 0.75rem;
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: #fff;
}

.clinic-logo-field__label {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
}

.clinic-logo-field__thumb,
.clinic-preview__logo {
  flex: 0 0 3.75rem;
  width: 3.75rem;
  height: 3.75rem;
  object-fit: contain;
  border-radius: 8px;
  background: #fff;
  border: 1px solid var(--border);
}

.clinic-logo-field__thumb {
  display: grid;
  place-items: center;
  overflow: hidden;
  color: var(--text-muted);
}

.clinic-logo-field__thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.clinic-logo-field__actions {
  min-width: 0;
}

.clinic-logo-field__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.clinic-preview__info {
  min-width: 0;
  text-align: start;
}

.clinic-preview__info strong {
  display: block;
  font-size: 0.875rem;
  margin-bottom: 0.15rem;
  line-height: 1.3;
}

.clinic-preview__ar {
  margin: 0 0 0.25rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
  font-family: 'Noto Naskh Arabic', 'Amiri', 'Tahoma', 'Arial', sans-serif;
}

.clinic-preview__info p {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
  line-height: 1.35;
}

@media (max-width: 720px) {
  .clinic-info-page__fields {
    grid-template-columns: 1fr;
  }
}
</style>
