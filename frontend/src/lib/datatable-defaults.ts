import type { Config, ConfigColumns } from 'datatables.net'
import { DATATABLE_FR } from './datatable-fr'

export const DEFAULT_DATATABLE_OPTIONS: Config = {
  paging: false,
  lengthChange: false,
  searching: false,
  ordering: false,
  order: [],
  responsive: true,
  autoWidth: false,
  scrollX: false,
  deferRender: false,
  stateSave: false,
  dom: 'rt',
  language: DATATABLE_FR,
}

export const DT_ICONS = {
  view: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
  reconsult:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
  download:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>',
  file:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>',
  print:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>',
  pay: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>',
  toggle:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M16 16h5v5"/><path d="M21 16v5h-5"/></svg>',
  transfer:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>',
  delete:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
  undo: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>',
  calendar:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  bed: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>',
  ban: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
  reclaim:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
}

export function genderBadge(gender?: string) {
  if (gender === 'F') return '<span class="dt-pill dt-pill--f">Féminin</span>'
  if (gender === 'M') return '<span class="dt-pill dt-pill--m">Masculin</span>'
  return '<span class="dt-pill dt-pill--na">—</span>'
}

export function catalogRowActionsHtml(row: {
  id: string
  toggleLabel?: string
  isActive?: boolean
  canDelete?: boolean
  showEdit?: boolean
  showView?: boolean
  showToggle?: boolean
}) {
  const showEdit = row.showEdit !== false
  const showView = row.showView === true
  const showToggle = row.showToggle !== false
  const canDelete = row.canDelete !== false
  const isActive = row.isActive !== false
  const toggleIcon = isActive ? DT_ICONS.ban : DT_ICONS.check
  const toggleClass = isActive ? 'dt-btn--catalog-off' : 'dt-btn--catalog-on'
  const toggleLabel = row.toggleLabel ?? (isActive ? 'Désactiver' : 'Activer')

  return `
    <div class="dt-row-actions dt-catalog-actions" data-id="${row.id}">
      ${
        showView
          ? `<button type="button" class="dt-btn dt-btn--icon dt-btn--icon-soft" data-action="view" title="Voir" aria-label="Voir">${DT_ICONS.view}</button>`
          : ''
      }
      ${
        showEdit
          ? `<button type="button" class="dt-btn dt-btn--icon dt-btn--catalog-edit" data-action="edit" title="Modifier" aria-label="Modifier">${DT_ICONS.edit}</button>`
          : ''
      }
      ${
        showToggle
          ? `<button type="button" class="dt-btn dt-btn--icon ${toggleClass}" data-action="toggle" title="${toggleLabel}" aria-label="${toggleLabel}">${toggleIcon}</button>`
          : ''
      }
      ${
        canDelete
          ? `<button type="button" class="dt-btn dt-btn--icon dt-btn--catalog-delete" data-action="delete" title="Supprimer" aria-label="Supprimer">${DT_ICONS.delete}</button>`
          : ''
      }
    </div>
  `
}

/** Actions ligne patient réception — ordre fixe, pas de retour à la ligne. */
export function patientRowActionsHtml(row: { id: string }, options?: { showDelete?: boolean }) {
  const showDelete = options?.showDelete !== false
  const deleteBtn = showDelete
    ? `<span class="dt-patient-actions__sep" aria-hidden="true"></span>
      <button type="button" class="dt-btn dt-btn--icon dt-btn--catalog-delete" data-action="delete" title="Supprimer le dossier" aria-label="Supprimer le dossier">${DT_ICONS.delete}</button>`
    : ''
  return `
    <div class="dt-row-actions dt-patient-actions" data-id="${row.id}">
      <button type="button" class="dt-btn dt-btn--icon dt-btn--catalog-edit" data-action="edit" title="Modifier le dossier" aria-label="Modifier le dossier">${DT_ICONS.edit}</button>
      <button type="button" class="dt-btn dt-btn--icon dt-btn--accent" data-action="reconsult" title="Reconsultation" aria-label="Reconsultation">${DT_ICONS.reconsult}</button>
      <button type="button" class="dt-btn dt-btn--icon dt-btn--icon-soft" data-action="print" title="Imprimer le reçu" aria-label="Imprimer le reçu">${DT_ICONS.print}</button>
      ${deleteBtn}
    </div>
  `
}

/** Actions dossier laboratoire terminé — 2 boutons en haut, 2 en bas. */
export function labCompletedRowActionsHtml(row: { id: string }) {
  return `
    <div class="dt-row-actions dt-lab-completed-actions" data-id="${row.id}">
      <div class="dt-lab-completed-actions__row">
        <button type="button" class="dt-btn dt-btn--icon dt-btn--accent" data-action="print" title="Imprimer" aria-label="Imprimer">${DT_ICONS.print}</button>
        <button type="button" class="dt-btn dt-btn--icon dt-btn--icon-soft" data-action="saisir" title="Consulter" aria-label="Consulter">${DT_ICONS.view}</button>
      </div>
      <div class="dt-lab-completed-actions__row">
        <button type="button" class="dt-btn dt-btn--icon dt-btn--catalog-edit" data-action="modify" title="Modifier" aria-label="Modifier">${DT_ICONS.edit}</button>
        <button type="button" class="dt-btn dt-btn--icon dt-btn--pay" data-action="add" title="Ajouter" aria-label="Ajouter un formulaire">${DT_ICONS.plus}</button>
      </div>
    </div>
  `
}

export function statusBadge(
  label: string,
  variant: 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'default',
) {
  return `<span class="dt-badge dt-badge--${variant}">${label}</span>`
}

/** Colonne # — numérotation 1, 2, 3… depuis le haut (pagination incluse). */
export const ROW_NUMBER_COLUMN: ConfigColumns = {
  data: null,
  title: '#',
  orderable: false,
  searchable: false,
  className: 'dt-num-col all',
  responsivePriority: 10000,
  render: (_data, type, _row, meta) => {
    const m = meta as { row: number; settings: { _iDisplayStart?: number } }
    const num = (m.settings?._iDisplayStart ?? 0) + m.row + 1
    if (type === 'display') return String(num)
    if (type === 'sort' || type === 'type') return num
    return ''
  },
}

/** columnDefs de base pour garder # toujours visible. */
export const ROW_NUMBER_COLUMN_DEF = {
  targets: 0,
  orderable: false,
  searchable: false,
  responsivePriority: 10000,
  className: 'dt-num-col all',
} as const

export function withRowNumberColumn(columns: ConfigColumns[]): ConfigColumns[] {
  if (columns.length > 0 && columns[0].title === '#') return columns
  return [ROW_NUMBER_COLUMN, ...columns]
}

/** Décale les index de tri / columnDefs après insertion de la colonne #. */
export function offsetColumnIndexes(options?: Config): Config | undefined {
  if (!options) return options

  const next: Config = { ...options }

  const order = next.order
  if (Array.isArray(order) && order.length > 0 && Array.isArray(order[0])) {
    next.order = (order as [number, 'asc' | 'desc'][]).map(([idx, dir]) => [idx + 1, dir]) as Config['order']
  } else if (Array.isArray(order) && order.length === 2 && typeof order[0] === 'number') {
    const [idx, dir] = order as [number, 'asc' | 'desc']
    next.order = [idx + 1, dir] as Config['order']
  }

  if (next.columnDefs?.length) {
    next.columnDefs = next.columnDefs.map((def) => {
      const d = { ...def } as {
        targets?: number | (number | string)[]
        target?: number | string
        [key: string]: unknown
      }
      if (typeof d.targets === 'number') {
        d.targets = d.targets + 1
      } else if (Array.isArray(d.targets)) {
        d.targets = d.targets.map((t) => (typeof t === 'number' ? t + 1 : t))
      } else if (typeof d.target === 'number') {
        d.target = d.target + 1
      }
      return d as (typeof next.columnDefs)[number]
    })
  }

  return next
}
