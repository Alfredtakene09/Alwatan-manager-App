import { translateUi } from '@/i18n/translate'

export const DATATABLE_FR = {
  emptyTable: '',
  info: '',
  infoEmpty: '',
  infoFiltered: '',
  loadingRecords: 'Chargement…',
  processing: 'Traitement en cours…',
  search: 'Rechercher :',
  zeroRecords: '',
  paginate: {
    first: '',
    last: '',
    next: '',
    previous: '',
  },
}

/** Libellés DataTables selon la langue active (pas les données des lignes). */
export function getDatatableLanguage() {
  return {
    ...DATATABLE_FR,
    loadingRecords: translateUi('Chargement…'),
    processing: translateUi('Traitement en cours…'),
    search: translateUi('Rechercher :'),
  }
}
