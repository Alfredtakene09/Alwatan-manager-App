import { translateUi } from '@/i18n/translate'
import { formatDateTimeFr } from '@/lib/gestionnaire-dashboard'

export function translateTemplate(
  templateFr: string,
  params: Record<string, string | number>,
): string {
  let result = translateUi(templateFr)
  for (const [key, value] of Object.entries(params)) {
    result = result.replaceAll(`{${key}}`, String(value))
  }
  return result
}

export function translateDashboardLabel(label: string): string {
  return translateUi(label)
}

export function formatTrendPercentLocalized(value: number): string {
  const sign = value > 0 ? '↑' : value < 0 ? '↓' : '→'
  const suffix = translateUi('% vs mois précédent')
  return `${sign} ${Math.abs(value)} ${suffix}`
}

export function translateCashDelayLabel(hours: number | null, lastAt: string | null): string {
  if (lastAt) {
    return translateTemplate('Dernier passage le {date}', { date: formatDateTimeFr(lastAt) })
  }
  if (hours == null) return translateUi('Aucun décaissement enregistré')
  if (hours < 1) return translateUi("Depuis moins d'une heure")
  if (hours < 24) return translateTemplate('Depuis {hours} h', { hours })
  const days = Math.floor(hours / 24)
  const rem = hours % 24
  if (rem === 0) {
    return days > 1
      ? translateTemplate('Depuis {days} jours', { days })
      : translateTemplate('Depuis {days} jour', { days })
  }
  return translateTemplate('Depuis {days} j {hours} h', { days, hours: rem })
}

const WORKFLOW_HINT_FR =
  'Décaissement journalier : vous récupérez la tirelire comptable (créneaux matin 7h–14h, soir 16h–21h, nuit 21h–6h), en général après la nuit ou le lendemain matin.'

export function translateCashScheduleHint(hint: string): string {
  if (!hint) return ''
  if (hint === WORKFLOW_HINT_FR) return translateUi(WORKFLOW_HINT_FR)

  const reportMatch = hint.match(
    /^Report du (.+) non récupéré — passage possible le matin \(avant (\d+)h\)\.$/,
  )
  if (reportMatch) {
    return translateTemplate('Report du {date} non récupéré — passage possible le matin (avant {hour}h).', {
      date: reportMatch[1],
      hour: reportMatch[2],
    })
  }

  const balanceSinceMatch = hint.match(
    /^Solde comptable depuis le (.+) — récupération attendue après (\d+)h\.$/,
  )
  if (balanceSinceMatch) {
    return translateTemplate('Solde comptable depuis le {date} — récupération attendue après {hour}h.', {
      date: balanceSinceMatch[1],
      hour: balanceSinceMatch[2],
    })
  }

  const fundsPendingMatch = hint.match(
    /^Fonds depuis le (.+) en attente — à récupérer ce soir \(après (\d+)h\) ou demain matin\.$/,
  )
  if (fundsPendingMatch) {
    return translateTemplate(
      'Fonds depuis le {date} en attente — à récupérer ce soir (après {hour}h) ou demain matin.',
      { date: fundsPendingMatch[1], hour: fundsPendingMatch[2] },
    )
  }

  const dayClosedMatch = hint.match(
    /^Compte rendu du jour \((\d+)h–(\d+)h\) clôturé — récupérez la tirelire comptable\.$/,
  )
  if (dayClosedMatch) {
    return translateTemplate(
      'Compte rendu du jour ({start}h–{end}h) clôturé — récupérez la tirelire comptable.',
      { start: dayClosedMatch[1], end: dayClosedMatch[2] },
    )
  }

  const balanceOngoingMatch = hint.match(
    /^Solde en cours \((\d+)h–(\d+)h\) — collecte prévue ce soir après (\d+)h ou demain matin\.$/,
  )
  if (balanceOngoingMatch) {
    return translateTemplate(
      'Solde en cours ({start}h–{end}h) — collecte prévue ce soir après {hour}h ou demain matin.',
      { start: balanceOngoingMatch[1], end: balanceOngoingMatch[2], hour: balanceOngoingMatch[3] },
    )
  }

  return translateUi(hint)
}

export function formatMonthLabel(year: number, month: number, locale: string): string {
  return new Date(year, month - 1, 1).toLocaleDateString(locale, {
    month: 'short',
    year: 'numeric',
  })
}
