export type DateFilterMode = 'day' | 'month' | 'custom'

export function toLocalDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayDateKey(): string {
  return toLocalDateKey(new Date())
}

export function currentMonthKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function yesterdayDateKey(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return toLocalDateKey(d)
}

export function matchesDateFilter(
  isoDate: string,
  mode: DateFilterMode,
  day: string,
  month: string,
  from: string,
  to: string,
): boolean {
  const date = new Date(isoDate)

  if (mode === 'day') {
    if (!day) return true
    return toLocalDateKey(date) === day
  }

  if (mode === 'month') {
    if (!month) return true
    const [y, m] = month.split('-').map(Number)
    return date.getFullYear() === y && date.getMonth() + 1 === m
  }

  if (from) {
    const start = new Date(`${from}T00:00:00`)
    if (date < start) return false
  }
  if (to) {
    const end = new Date(`${to}T23:59:59.999`)
    if (date > end) return false
  }

  return true
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function startOfMonthDateKey(ref = new Date()): string {
  return toLocalDateKey(new Date(ref.getFullYear(), ref.getMonth(), 1))
}

export function currentMonthRangeToToday(): { from: string; to: string } {
  const now = new Date()
  return { from: startOfMonthDateKey(now), to: toLocalDateKey(now) }
}

export function lastMonthRange(): { from: string; to: string } {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const to = new Date(now.getFullYear(), now.getMonth(), 0)
  return { from: toLocalDateKey(from), to: toLocalDateKey(to) }
}

export function lastDaysRange(days: number): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - (days - 1))
  return { from: toLocalDateKey(from), to: toLocalDateKey(to) }
}

export function formatDateRangeLabel(from: string, to: string): string {
  const fmt = (value: string) =>
    parseDateKey(value).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  if (from && to) return `Du ${fmt(from)} au ${fmt(to)}`
  if (from) return `À partir du ${fmt(from)}`
  if (to) return `Jusqu'au ${fmt(to)}`
  return 'Période personnalisée'
}

export function formatPeriodLabel(
  mode: DateFilterMode,
  day: string,
  month: string,
  from: string,
  to: string,
): string {
  if (mode === 'day' && day) {
    return new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  if (mode === 'month' && month) {
    const [y, m] = month.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    })
  }

  if (mode === 'custom') {
    return formatDateRangeLabel(from, to)
  }

  return 'Toutes les dates'
}
