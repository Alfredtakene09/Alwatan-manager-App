import type { Component } from 'vue'

export type SummaryStat = {
  id: string
  label: string
  value: number | string
  icon: Component
  variant: 'green' | 'teal' | 'blue' | 'amber' | 'rose' | 'violet' | 'cyan'
  trend?: string
}
