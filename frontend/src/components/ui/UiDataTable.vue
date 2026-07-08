<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import '@/assets/datatable-theme.css'
import type { Config, ConfigColumns } from 'datatables.net'
import { withRowNumberColumn } from '@/lib/datatable-defaults'
import { useAppI18n } from '@/i18n/useAppI18n'

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

const { uiText, localeCode } = useAppI18n()
const loadingText = computed(() => {
  void localeCode.value
  return uiText(props.loadingLabel)
})

type AnyRow = Record<string, unknown>
type RenderMeta = { row: number; col: number; settings: { _iDisplayStart: number } }
type ColumnDef = {
  targets?: number | string | (number | string)[]
  target?: number | string
  className?: string
  width?: string
  visible?: boolean
}

const displayColumns = computed<ConfigColumns[]>(() => {
  void localeCode.value
  const translated = props.columns.map((col) => {
    const title = col.title
    if (title == null || title === '') return col
    return { ...col, title: uiText(String(title)) }
  })
  return withRowNumberColumn(translated)
})

/** Résout la valeur brute d'une cellule à partir de `column.data`. */
function resolveCellValue(col: ConfigColumns, row: AnyRow, rowIdx: number, colIdx: number): unknown {
  const data = (col as { data?: unknown }).data
  if (data == null) return null
  if (typeof data === 'function') {
    return (data as (r: AnyRow, t: string, s: unknown, m: RenderMeta) => unknown)(row, 'display', undefined, {
      row: rowIdx,
      col: colIdx,
      settings: { _iDisplayStart: 0 },
    })
  }
  return String(data)
    .split('.')
    .reduce<unknown>((acc, key) => (acc == null ? acc : (acc as AnyRow)[key]), row)
}

/** HTML final d'une cellule (rendu personnalisé ou valeur brute). */
function cellHtml(col: ConfigColumns, row: AnyRow, rowIdx: number, colIdx: number): string {
  const value = resolveCellValue(col, row, rowIdx, colIdx)
  const render = (col as { render?: unknown }).render
  if (typeof render === 'function') {
    const meta: RenderMeta = { row: rowIdx, col: colIdx, settings: { _iDisplayStart: 0 } }
    const out = (render as (v: unknown, t: string, r: AnyRow, m: RenderMeta) => unknown)(value, 'display', row, meta)
    return out == null ? '' : String(out)
  }
  return value == null ? '' : String(value)
}

/**
 * `targets` fait référence aux colonnes côté appelant (sans la colonne #).
 * Comme la colonne # est ajoutée en index 0, on décale les cibles positives de +1.
 * `-1` cible la dernière colonne.
 */
function targetMatches(
  target: ColumnDef['targets'] | ColumnDef['target'],
  idx: number,
  len: number,
): boolean {
  if (target == null) return false
  const list = Array.isArray(target) ? target : [target]
  return list.some((t) => {
    if (t === '_all') return true
    if (typeof t === 'number') return t < 0 ? idx === len + t : idx === t + 1
    return false
  })
}

type ResolvedColumn = {
  col: ConfigColumns
  className: string
  width?: string
  index: number
}

const resolvedColumns = computed<ResolvedColumn[]>(() => {
  const cols = displayColumns.value
  const defs = (props.options?.columnDefs ?? []) as ColumnDef[]
  const len = cols.length
  return cols
    .map((col, idx) => {
      let className = ((col as { className?: string }).className ?? '') as string
      let width = (col as { width?: string }).width
      let visible = (col as { visible?: boolean }).visible !== false
      for (const def of defs) {
        if (targetMatches(def.targets ?? def.target, idx, len)) {
          if (def.className != null) className = def.className
          if (def.width != null) width = def.width
          if (def.visible === false) visible = false
        }
      }
      return { col, className, width, visible, index: idx }
    })
    .filter((entry) => entry.visible)
    .map(({ col, className, width, index }) => ({ col, className, width, index }))
})

const sortedData = computed<AnyRow[]>(() => {
  const data = (props.data ?? []) as AnyRow[]
  if (!props.options?.ordering) return data

  const order = props.options.order
  let orderIdx: number | undefined
  let dir: 'asc' | 'desc' = 'asc'
  if (Array.isArray(order) && Array.isArray(order[0])) {
    const first = order[0] as [number, 'asc' | 'desc']
    orderIdx = first[0]
    dir = first[1]
  } else if (Array.isArray(order) && typeof order[0] === 'number') {
    orderIdx = order[0] as number
    dir = (order[1] as 'asc' | 'desc') ?? 'asc'
  }
  if (orderIdx == null) return data

  // +1 car la colonne # occupe l'index 0 côté affichage.
  const col = displayColumns.value[orderIdx + 1]
  const key = col ? (col as { data?: unknown }).data : undefined
  if (typeof key !== 'string') return data

  const pick = (row: AnyRow) =>
    key.split('.').reduce<unknown>((acc, k) => (acc == null ? acc : (acc as AnyRow)[k]), row)

  const sorted = [...data].sort((a, b) => {
    const av = pick(a)
    const bv = pick(b)
    if (av == null && bv == null) return 0
    if (av == null) return -1
    if (bv == null) return 1
    if (typeof av === 'number' && typeof bv === 'number') return av - bv
    return String(av).localeCompare(String(bv))
  })
  if (dir === 'desc') sorted.reverse()
  return sorted
})

function rowKey(row: AnyRow, idx: number): string {
  const id = row?.id
  return id == null ? `row-${idx}` : String(id)
}

const tbodyRef = ref<HTMLElement | null>(null)

function applyRowCallbacks() {
  const cb = props.options?.rowCallback as
    | ((el: HTMLElement, data: unknown) => void)
    | undefined
  if (typeof cb !== 'function' || !tbodyRef.value) return
  const trs = tbodyRef.value.querySelectorAll<HTMLElement>(':scope > tr')
  sortedData.value.forEach((rowData, i) => {
    const tr = trs[i]
    if (tr) cb(tr, rowData)
  })
}

watch(
  [sortedData, () => props.options, () => props.loading, resolvedColumns],
  () => nextTick(applyRowCallbacks),
  { immediate: true },
)
onMounted(() => nextTick(applyRowCallbacks))

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
          {{ loadingText }}
        </div>

        <table class="dataTable stripe hover row-border ui-dt__table">
          <thead>
            <tr>
              <th
                v-for="c in resolvedColumns"
                :key="`h-${c.index}`"
                :class="c.className || undefined"
                :style="c.width ? { width: c.width } : undefined"
              >
                {{ c.col.title }}
              </th>
            </tr>
          </thead>
          <tbody ref="tbodyRef">
            <tr
              v-for="(row, rowIdx) in sortedData"
              :key="rowKey(row, rowIdx)"
              :class="rowIdx % 2 === 0 ? 'odd' : 'even'"
            >
              <td
                v-for="c in resolvedColumns"
                :key="`c-${c.index}`"
                :class="c.className || undefined"
                v-html="cellHtml(c.col, row, rowIdx, c.index)"
              />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
