import { onMounted, ref } from 'vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { confirmAppModal, showApiErrorModal, showSuccessModal } from '@/lib/api-modal-helper'
import { translateTemplate } from '@/lib/dashboard-i18n'
import { useAppI18n } from '@/i18n/useAppI18n'
import {
  buildPharmacyDayClosureHtml,
  cancelPrintWindow,
  openPrintDocument,
  reservePrintWindow,
} from '@/lib/print-document'

export type PharmacyDayClosureSnapshot = {
  businessDate: string
  periodTo?: string | null
  pharmacistName: string
  pharmacistUsername?: string | null
  salesCount: number
  returnsCount: number
  grossSalesFcfa: number
  catalogueSalesFcfa?: number
  discountFcfa?: number
  returnsFcfa: number
  netFcfa: number
  productLines?: Array<{ label: string; qty: number; totalFcfa: number }>
  closed: boolean
  closedAt: string | null
}

export type PharmacyDayClosureQuery = {
  from?: string
  to?: string
  pharmacistId?: string
}

export function usePharmacyDayClosure() {
  const { uiText } = useAppI18n()
  const closingSales = ref(false)
  const salesClosed = ref(false)

  async function fetchDayClosureSnapshot(params?: PharmacyDayClosureQuery) {
    const { data } = await api.get<PharmacyDayClosureSnapshot>('/pharmacie/day-closure', {
      params: {
        ...(params?.from ? { from: params.from } : {}),
        ...(params?.to ? { to: params.to } : {}),
        ...(params?.pharmacistId ? { pharmacistId: params.pharmacistId } : {}),
      },
    })
    return data
  }

  async function loadDayClosureStatus() {
    try {
      const data = await fetchDayClosureSnapshot()
      salesClosed.value = Boolean(data.closed)
    } catch {
      /* ignore */
    }
  }

  function printPharmacyDayClosure(data: PharmacyDayClosureSnapshot) {
    openPrintDocument(
      uiText('Clôturer les ventes'),
      buildPharmacyDayClosureHtml({
        businessDate: data.businessDate,
        periodTo: data.periodTo || data.businessDate,
        closedAt: data.closedAt ?? new Date().toISOString(),
        pharmacistName: data.pharmacistName || '—',
        pharmacistUsername: data.pharmacistUsername,
        salesCount: data.salesCount,
        returnsCount: data.returnsCount,
        grossSalesFcfa: data.grossSalesFcfa,
        catalogueSalesFcfa: data.catalogueSalesFcfa,
        discountFcfa: data.discountFcfa,
        returnsFcfa: data.returnsFcfa,
        netFcfa: data.netFcfa,
        productLines: data.productLines,
      }),
      { pageSize: '80mm' },
    )
  }

  async function printPharmacyCumul(params: PharmacyDayClosureQuery) {
    if (closingSales.value) return
    closingSales.value = true
    reservePrintWindow('80mm')
    try {
      const data = await fetchDayClosureSnapshot(params)
      printPharmacyDayClosure(data)
    } catch (error) {
      cancelPrintWindow()
      await showApiErrorModal(error, uiText('Impossible d’imprimer le cumul des ventes.'))
    } finally {
      closingSales.value = false
    }
  }

  async function closePharmacySales() {
    if (closingSales.value) return
    let snapshot: PharmacyDayClosureSnapshot
    try {
      snapshot = await fetchDayClosureSnapshot()
    } catch (error) {
      await showApiErrorModal(error, uiText('Impossible de clôturer les ventes.'))
      return
    }
    if (snapshot.closed) {
      salesClosed.value = true
      reservePrintWindow('80mm')
      printPharmacyDayClosure(snapshot)
      return
    }
    const confirmed = await confirmAppModal({
      type: 'WARNING',
      title: uiText('Clôturer les ventes'),
      message: translateTemplate('Confirmer la clôture des ventes ? {count} vente(s) — Net : {net}', {
        count: snapshot.salesCount,
        net: formatFcfa(snapshot.netFcfa),
      }),
      confirmLabel: uiText('Clôturer'),
      cancelLabel: uiText('Annuler'),
    })
    if (!confirmed) return

    closingSales.value = true
    reservePrintWindow('80mm')
    try {
      const { data } = await api.post<PharmacyDayClosureSnapshot>('/pharmacie/day-closure')
      salesClosed.value = true
      printPharmacyDayClosure(data)
      await showSuccessModal(
        uiText('Ventes clôturées'),
        uiText('Ventes clôturées — ticket envoyé à l’impression.'),
      )
    } catch (error) {
      cancelPrintWindow()
      await showApiErrorModal(error, uiText('Impossible de clôturer les ventes.'))
      await loadDayClosureStatus()
    } finally {
      closingSales.value = false
    }
  }

  onMounted(() => {
    void loadDayClosureStatus()
  })

  return {
    closingSales,
    salesClosed,
    loadDayClosureStatus,
    closePharmacySales,
    printPharmacyCumul,
  }
}
