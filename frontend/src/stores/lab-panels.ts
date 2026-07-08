import { defineStore } from 'pinia'
import api from '@/api/client'
import {
  setRuntimeLabPanels,
  type LabFormPanel,
  type LabFormSection,
  type LabPanelSlug,
} from '@/lib/lab-form-panels'

export type LabPanelFieldDto = {
  id: string
  section: string | null
  key: string
  label: string
  unit: string | null
  reference: string | null
  defaultValue: string | null
  type: string
  sortOrder: number
}

export type LabPanelDto = {
  id: string
  slug: string
  label: string
  isEntry: boolean
  active: boolean
  sortOrder: number
  fields: LabPanelFieldDto[]
}

/** Regroupe les champs aplatis (avec titre de section) en sections ordonnées. */
export function panelDtoToFormPanel(dto: LabPanelDto): LabFormPanel {
  const sections: LabFormSection[] = []
  const byTitle = new Map<string, LabFormSection>()

  for (const field of [...dto.fields].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const key = field.section ?? ''
    let section = byTitle.get(key)
    if (!section) {
      section = { title: field.section || undefined, fields: [] }
      byTitle.set(key, section)
      sections.push(section)
    }
    section.fields.push({
      key: field.key,
      label: field.label,
      unit: field.unit ?? undefined,
      reference: field.reference ?? undefined,
      defaultValue: field.defaultValue ?? undefined,
      type: field.type === 'textarea' ? 'textarea' : 'text',
    })
  }

  return { slug: dto.slug, label: dto.label, sections }
}

export const useLabPanelsStore = defineStore('lab-panels', {
  state: () => ({
    panels: [] as LabFormPanel[],
    entrySlugs: [] as LabPanelSlug[],
    loaded: false,
    loading: false,
  }),
  getters: {
    getPanel: (state) => (slug: LabPanelSlug) =>
      state.panels.find((panel) => panel.slug === slug),
    entryPanels: (state) =>
      state.panels.filter((panel) => state.entrySlugs.includes(panel.slug)),
  },
  actions: {
    async fetchPanels(force = false) {
      if (this.loaded && !force) return
      this.loading = true
      try {
        const { data } = await api.get<LabPanelDto[]>('/lab-panels')
        const ordered = [...data].sort((a, b) => a.sortOrder - b.sortOrder)
        this.panels = ordered.map(panelDtoToFormPanel)
        this.entrySlugs = ordered
          .filter((panel) => panel.active && panel.isEntry)
          .map((panel) => panel.slug)
        setRuntimeLabPanels(this.panels, this.entrySlugs)
        this.loaded = true
      } finally {
        this.loading = false
      }
    },
  },
})
