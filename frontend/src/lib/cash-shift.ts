/** Aligné sur backend/src/lib/cash-shift.ts — créneaux compte rendu caisse. */
export type ShiftSlot = 'MORNING' | 'EVENING' | 'NIGHT'

export const ALL_SHIFT_SLOTS: ShiftSlot[] = ['MORNING', 'EVENING', 'NIGHT']

export const SHIFT_WINDOWS: Record<ShiftSlot, { startHour: number; endHour: number }> = {
  MORNING: { startHour: 7, endHour: 14 },
  EVENING: { startHour: 16, endHour: 21 },
  NIGHT: { startHour: 21, endHour: 6 },
}

export const SHIFT_SLOT_LABELS: Record<ShiftSlot, string> = {
  MORNING: 'Matin',
  EVENING: 'Soir',
  NIGHT: 'Nuit',
}

/** Trous non couverts par un décaissement. */
export const SHIFT_GAP_HOURS_LABEL = '6h–7h et 14h–16h'

export function shiftHoursLabel(slot: ShiftSlot): string {
  const w = SHIFT_WINDOWS[slot]
  return `${w.startHour}h–${w.endHour}h`
}

export function shiftButtonLabel(slot: ShiftSlot): string {
  return `${SHIFT_SLOT_LABELS[slot]} · ${shiftHoursLabel(slot)}`
}

/** Libellé carte créneau — ex. « Soir (16h – 21h) ». */
export function shiftCardLabel(slot: ShiftSlot): string {
  const w = SHIFT_WINDOWS[slot]
  return `${SHIFT_SLOT_LABELS[slot]} (${w.startHour}h – ${w.endHour}h)`
}

export function formatShiftHours(slot: ShiftSlot): string {
  return shiftHoursLabel(slot)
}
