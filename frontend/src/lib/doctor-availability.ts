/** Créneaux hebdomadaires médecin — dayOfWeek 1 (lundi) → 7 (dimanche). */

export type DoctorAvailabilitySlot = {
  dayOfWeek: number
  startTime: string
  endTime: string
}

export const DOCTOR_WEEKDAY_OPTIONS = [
  { value: 1, label: 'Lundi', short: 'Lun' },
  { value: 2, label: 'Mardi', short: 'Mar' },
  { value: 3, label: 'Mercredi', short: 'Mer' },
  { value: 4, label: 'Jeudi', short: 'Jeu' },
  { value: 5, label: 'Vendredi', short: 'Ven' },
  { value: 6, label: 'Samedi', short: 'Sam' },
  { value: 7, label: 'Dimanche', short: 'Dim' },
] as const

export const DOCTOR_SPECIALTY_SUGGESTIONS = [
  'Médecine générale',
  'Pédiatrie',
  'Gynécologie-obstétrique',
  'Chirurgie',
  'Cardiologie',
  'Dermatologie',
  'ORL',
  'Ophtalmologie',
  'Dentisterie',
  'Radiologie',
  'Anesthésie',
  'Urgences',
]

export function emptyWeekAvailability(): DoctorAvailabilitySlot[] {
  return []
}

export function parseDoctorAvailabilitySlots(value: unknown): DoctorAvailabilitySlot[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const dayOfWeek = Number((row as { dayOfWeek?: unknown }).dayOfWeek)
      const startTime = String((row as { startTime?: unknown }).startTime ?? '')
      const endTime = String((row as { endTime?: unknown }).endTime ?? '')
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) return null
      if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) return null
      if (startTime >= endTime) return null
      return { dayOfWeek, startTime, endTime }
    })
    .filter((row): row is DoctorAvailabilitySlot => Boolean(row))
}

export function formatAvailabilitySummary(slots: DoctorAvailabilitySlot[]): string {
  if (!slots.length) return '—'
  const byDay = new Map<number, string>(DOCTOR_WEEKDAY_OPTIONS.map((d) => [d.value, d.short]))
  return slots
    .slice()
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
    .map((slot) => `${byDay.get(slot.dayOfWeek) ?? slot.dayOfWeek} ${slot.startTime}–${slot.endTime}`)
    .join(' · ')
}

export function toggleDayAvailability(
  slots: DoctorAvailabilitySlot[],
  dayOfWeek: number,
  enabled: boolean,
): DoctorAvailabilitySlot[] {
  const without = slots.filter((slot) => slot.dayOfWeek !== dayOfWeek)
  if (!enabled) return without
  return [...without, { dayOfWeek, startTime: '', endTime: '' }].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek,
  )
}

export function updateDayTimes(
  slots: DoctorAvailabilitySlot[],
  dayOfWeek: number,
  patch: Partial<Pick<DoctorAvailabilitySlot, 'startTime' | 'endTime'>>,
): DoctorAvailabilitySlot[] {
  return slots.map((slot) => (slot.dayOfWeek === dayOfWeek ? { ...slot, ...patch } : slot))
}
