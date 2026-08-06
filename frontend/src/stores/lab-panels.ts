import { defineStore } from 'pinia'
import api from '@/api/client'
import {
  getAllLabFormPanels,
  getEntryPanelSlugs,
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
  hasComment: boolean
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
  examCatalogItems?: Array<{
    id: string
    code: string
    label: string
    priceFcfa: number
    active: boolean
  }>
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
      hasComment: field.hasComment === true,
      type: 'text',
    })
  }

  return { slug: dto.slug, label: dto.label, sections }
}

export const useLabPanelsStore = defineStore('lab-panels', {
  state: () => ({
    panels: getAllLabFormPanels() as LabFormPanel[],
    /** Formulaires actifs proposés à la saisie labo (tous les actifs, pas seulement isEntry). */
    entrySlugs: getEntryPanelSlugs() as LabPanelSlug[],
    /** Libellés d’examens liés (pour filtrer selon la prescription). */
    panelMatchLabels: {} as Record<string, string[]>,
    loaded: false,
    loading: false,
  }),
  getters: {
    getPanel: (state) => (slug: LabPanelSlug) =>
      state.panels.find((panel) => panel.slug === slug),
    entryPanels: (state) =>
      state.panels
        .filter((panel) => state.entrySlugs.includes(panel.slug))
        .slice()
        .sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' })),
    matchLabelsFor:
      (state) =>
      (slug: string): string[] =>
        state.panelMatchLabels[slug] ?? [],
  },
  actions: {
    async fetchPanels(force = false) {
      if (this.loaded && !force) return
      this.loading = true
      try {
        const { data } = await api.get<LabPanelDto[]>('/lab-panels')
        const ordered = [...data].sort((a, b) =>
          a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }),
        )
        this.panels = ordered.map(panelDtoToFormPanel)
        this.entrySlugs = ordered.filter((panel) => panel.active).map((panel) => panel.slug)
        this.panelMatchLabels = Object.fromEntries(
          ordered.map((panel) => {
            const examLabels = (panel.examCatalogItems ?? []).map((item) => item.label)
            return [panel.slug, [...new Set([panel.label, ...examLabels].filter(Boolean))]]
          }),
        )
        setRuntimeLabPanels(this.panels, this.entrySlugs)
        this.loaded = true
      } catch {
        this.panels = getAllLabFormPanels()
        this.entrySlugs = getEntryPanelSlugs()
        this.panelMatchLabels = Object.fromEntries(
          this.panels.map((panel) => [panel.slug, [panel.label]]),
        )
        this.loaded = true
      } finally {
        this.loading = false
      }
    },
  },
})
