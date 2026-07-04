import type { Component } from 'vue'
import {
  Package,
  Monitor,
  Wrench,
  Fuel,
  Utensils,
  Receipt,
  CircleEllipsis,
} from '@lucide/vue'

export const EXPENSE_CATEGORY_ICON_OPTIONS = [
  { key: 'package', label: 'Fournitures', icon: Package },
  { key: 'monitor', label: 'Équipements', icon: Monitor },
  { key: 'wrench', label: 'Maintenance', icon: Wrench },
  { key: 'fuel', label: 'Carburant', icon: Fuel },
  { key: 'utensils', label: 'Alimentation', icon: Utensils },
  { key: 'receipt', label: 'Frais divers', icon: Receipt },
  { key: 'circle-ellipsis', label: 'Autre', icon: CircleEllipsis },
] as const

export const EXPENSE_CATEGORY_COLOR_PRESETS = [
  '#2563eb',
  '#d97706',
  '#0d9488',
  '#64748b',
  '#7c3aed',
  '#94a3b8',
  '#475569',
  '#dc2626',
  '#15803d',
  '#db2777',
] as const

const ICON_MAP: Record<string, Component> = Object.fromEntries(
  EXPENSE_CATEGORY_ICON_OPTIONS.map((o) => [o.key, o.icon]),
)

export function expenseCategoryIconComponent(icon?: string | null): Component {
  if (!icon) return Receipt
  return ICON_MAP[icon] ?? CircleEllipsis
}
