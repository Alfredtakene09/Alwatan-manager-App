import { genderBadge } from '@/lib/datatable-defaults'

export function formatPatientTableDate(iso?: string | Date | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatPatientTableDateShort(iso?: string | Date | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

/** Colonnes identité compactes — file gestionnaire (sans téléphone, date courte). */
export function gestionnairePatientColumnDefs() {
  return [
    {
      data: 'code',
      title: 'N°',
      responsivePriority: 1,
      className: 'dt-col-code',
      render: (code: string) => `<span class="dt-badge dt-badge--sm">${code}</span>`,
    },
    {
      data: 'fullName',
      title: 'Patient',
      responsivePriority: 2,
      className: 'dt-col-name',
      render: (name: string) => `<span class="dt-name dt-name--truncate" title="${name.replace(/"/g, '&quot;')}">${name}</span>`,
    },
    {
      data: 'genderRaw',
      title: 'Sexe',
      responsivePriority: 5,
      className: 'dt-col-sexe',
      render: (_d: unknown, _t: string, row: { genderRaw?: string }) => genderBadge(row.genderRaw),
    },
    {
      data: 'registeredAt',
      title: 'Date',
      responsivePriority: 4,
      className: 'dt-col-date',
      defaultContent: '—',
      render: (date: string) => `<span class="dt-date">${date}</span>`,
    },
  ]
}

export function patientIdentityColumnDefs() {
  return [
    {
      data: 'code',
      title: 'Matricule',
      responsivePriority: 1,
      render: (code: string) => `<span class="dt-badge">${code}</span>`,
    },
    {
      data: 'fullName',
      title: 'Nom complet',
      responsivePriority: 2,
      render: (name: string) => `<span class="dt-name">${name}</span>`,
    },
    {
      data: 'phone',
      title: 'Téléphone',
      responsivePriority: 4,
      render: (phone: string) =>
        phone === '—'
          ? '<span class="dt-muted">—</span>'
          : `<a class="dt-phone" href="tel:${phone}">${phone}</a>`,
    },
    {
      data: 'genderRaw',
      title: 'Genre',
      responsivePriority: 5,
      render: (_d: unknown, _t: string, row: { genderRaw?: string }) => genderBadge(row.genderRaw),
    },
    {
      data: 'registeredAtSort',
      title: "Date d'inscription",
      responsivePriority: 3,
      render: (_d: number, _t: string, row: { registeredAt: string }) =>
        `<span class="dt-date">${row.registeredAt}</span>`,
    },
  ]
}
