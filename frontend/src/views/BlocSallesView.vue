<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { BedDouble, Scissors, Eye, ShieldCheck } from '@lucide/vue'
import api from '@/api/client'
import { fullName } from '@/lib/roles'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiBadge from '@/components/ui/UiBadge.vue'

const data = ref<any>(null)

onMounted(async () => {
  const { data: res } = await api.get('/bloc-salles')
  data.value = res
})
</script>

<template>
  <div v-if="data">
    <UiPageHeader
      title="Bloc opératoire & Salles"
      subtitle="Étape 5 — Lecture seule, vérification des autorisations comptables"
      :icon="BedDouble"
    />

    <div class="readonly-banner">
      <Eye :size="18" />
      <span>Mode consultation — aucune modification autorisée sur ce module</span>
    </div>

    <UiCard title="Plan des salles" description="Suivi temps réel des salles" :icon="BedDouble" icon-variant="blue" class="section">
      <div class="rooms-grid">
        <div
          v-for="room in data.rooms"
          :key="room.id"
          class="room-card"
          :class="`room-card--${room.status.toLowerCase()}`"
        >
          <div class="room-card__head">
            <strong>{{ room.name }}</strong>
            <UiBadge :variant="room.status === 'LIBRE' ? 'success' : 'danger'">[{{ room.status }}]</UiBadge>
          </div>
          <UiBadge variant="info">{{ room.type }}</UiBadge>
          <p v-if="room.currentPatient" class="room-patient">
            <ShieldCheck :size="14" />
            {{ fullName(room.currentPatient.firstName, room.currentPatient.lastName) }}
          </p>
          <p v-else class="room-empty">Disponible</p>
        </div>
      </div>
    </UiCard>

    <UiCard title="Autorisations chirurgicales" description="Interventions payées par la comptabilité" :icon="Scissors" icon-variant="rose" class="section">
      <div v-for="(surgery, i) in data.surgeries" :key="i" class="auth-card">
        <div class="auth-card__icon"><Scissors :size="18" /></div>
        <div>
          <strong>{{ fullName(surgery.visit.patient.firstName, surgery.visit.patient.lastName) }}</strong>
          <span>{{ surgery.interventionType.label }}</span>
          <small>Opérateur : Dr {{ fullName(surgery.surgeon.firstName, surgery.surgeon.lastName) }}</small>
        </div>
        <UiBadge variant="success">Autorisé</UiBadge>
      </div>
      <p v-if="!data.surgeries.length" class="empty">Aucune autorisation active</p>
    </UiCard>
  </div>
</template>

<style scoped>
.readonly-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--info-bg);
  color: var(--info);
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 1.25rem;
}

.section {
  margin-bottom: 1.25rem;
}

.rooms-grid {
  display: grid;
  gap: 0.875rem;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}

.room-card {
  padding: 1rem;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--border);
  background: #fafcfd;
}

.room-card--libre {
  border-color: #a7f3d0;
  background: linear-gradient(135deg, #f0fdf4, #ecfdf5);
}

.room-card--occupe {
  border-color: #fecaca;
  background: linear-gradient(135deg, #fef2f2, #fff1f2);
}

.room-card__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.room-patient {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.75rem 0 0;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text);
}

.room-empty {
  margin: 0.75rem 0 0;
  font-size: 0.8rem;
  color: var(--text-light);
}

.auth-card {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  margin-bottom: 0.5rem;
}

.auth-card__icon {
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffe4e6;
  color: #e11d48;
  border-radius: 10px;
}

.auth-card strong {
  display: block;
}

.auth-card span {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.auth-card small {
  display: block;
  font-size: 0.75rem;
  color: var(--text-light);
  margin-top: 0.15rem;
}

.auth-card > :last-child {
  margin-left: auto;
}

.empty {
  text-align: center;
  color: var(--text-light);
  padding: 1.5rem;
  font-size: 0.875rem;
}
</style>
