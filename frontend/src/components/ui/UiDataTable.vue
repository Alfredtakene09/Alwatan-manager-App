<script setup lang="ts">
import { computed } from 'vue'
import DataTable from 'datatables.net-vue3'
import DataTablesCore from 'datatables.net-dt'
import 'datatables.net-dt/css/dataTables.dataTables.min.css'
import 'datatables.net-responsive-dt'
import 'datatables.net-responsive-dt/css/responsive.dataTables.min.css'
import '@/assets/datatable-theme.css'
import type { Config, ConfigColumns } from 'datatables.net'
import { DEFAULT_DATATABLE_OPTIONS, offsetColumnIndexes, ROW_NUMBER_COLUMN_DEF, withRowNumberColumn } from '@/lib/datatable-defaults'

DataTable.use(DataTablesCore)

const props = withDefaults(
  defineProps<{
    data: unknown[]
    columns: ConfigColumns[]
    loading?: boolean
    loadingLabel?: string
    options?: Config
    tableKey?: string
    compact?: boolean
    /** Remplit la hauteur disponible du parent (dashboard, etc.) */
    fill?: boolean
    /** Zone déroulante avec affichage depuis le haut */
    scrollable?: boolean
  }>(),
  {
    loadingLabel: 'Chargement…',
    tableKey: 'table',
    compact: false,
    fill: false,
    scrollable: true,
  },
)

const emit = defineEmits<{
  action: [payload: { action: string; id: string }]
}>()

type DtApi = {
  page: (action?: string) => { info: () => { start: number } }
  rows: (opts?: { page?: string }) => {
    every: (fn: (this: { index: () => number }, rowIdx: number, tableLoop: number, rowLoop: number) => boolean | void) => void
  }
  cell: (row: number, col: number) => { node: () => HTMLElement | null }
  column: (idx: number, opts?: { page?: string }) => {
    nodes: () => { each: (fn: (this: HTMLElement) => void) => void }
  }
  table: () => { container: () => HTMLElement }
}

function getDtApi(ctx: unknown): DtApi {
  const candidate = ctx as { api?: () => DtApi; _iDisplayStart?: number }
  if (typeof candidate?.api === 'function') return candidate.api()
  return new (DataTablesCore as unknown as { Api: new (s: unknown) => DtApi }).Api(ctx)
}

/** Numérotation 1, 2, 3… selon l'ordre d'affichage (page courante incluse). */
function applyRowNumbers(ctx: unknown) {
  try {
    const api = getDtApi(ctx)
    const start = api.page().info().start
    api.rows({ page: 'current' }).every(function (this: { index: () => number }, _rowIdx, _tableLoop, rowLoop) {
      const cell = api.cell(this.index(), 0).node() as HTMLElement | null
      if (cell) cell.textContent = String(start + rowLoop + 1)
      return true
    })
  } catch {
    // ignore
  }
}

/** Remet le scroll en haut pour afficher la ligne 1 en premier. */
function resetScrollTop(ctx: unknown) {
  try {
    const container = getDtApi(ctx).table().container()
    const scrollHost =
      container.closest<HTMLElement>('.ui-dt-scroll') ??
      container.closest<HTMLElement>('.table-wrap') ??
      container.querySelector<HTMLElement>('.dataTables_scrollBody')

    if (scrollHost) scrollHost.scrollTop = 0
  } catch {
    // ignore
  }
}

const displayColumns = computed(() => withRowNumberColumn(props.columns))

const mergedOptions = computed<Config>(() => {
  const userOptions = offsetColumnIndexes(props.options) ?? {}
  const userDrawCallback = userOptions.drawCallback

  return {
    ...DEFAULT_DATATABLE_OPTIONS,
    ...userOptions,
    columnDefs: [
      ROW_NUMBER_COLUMN_DEF,
      ...(userOptions.columnDefs ?? []),
    ],
    drawCallback(settings?: unknown) {
      const ctx = settings ?? this
      applyRowNumbers(ctx)
      resetScrollTop(ctx)
      if (typeof userDrawCallback === 'function') {
        // @ts-expect-error DataTables drawCallback context
        userDrawCallback.call(this, settings)
      }
    },
  }
})

function onTableClick(event: MouseEvent) {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]')
  if (!button?.dataset.action) return

  const row = button.closest<HTMLElement>('[data-id]')
  if (!row?.dataset.id) return

  emit('action', { action: button.dataset.action, id: row.dataset.id })
}
</script>

<template>
  <div
    class="ui-dt-shell"
    :class="{
      'ui-dt-shell--fill': fill,
      'ui-dt-shell--static': !scrollable,
    }"
  >
    <div class="ui-dt-scroll">
      <div class="ui-dt" :class="{ 'ui-dt--compact': compact }" @click="onTableClick">
        <div v-if="loading" class="ui-dt__overlay" role="status" aria-live="polite">
          <span class="ui-dt__spinner" />
          {{ loadingLabel }}
        </div>

        <DataTable
          :key="`${tableKey}-${data.length}-${loading ? 'loading' : 'ready'}`"
          :data="data"
          :columns="displayColumns"
          :options="mergedOptions"
          class="display stripe hover row-border ui-dt__table"
        />
      </div>
    </div>
  </div>
</template>
