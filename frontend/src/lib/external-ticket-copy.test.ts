import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import ar from '../i18n/locales/ar.ts'
import en from '../i18n/locales/en.ts'
import fr from '../i18n/locales/fr.ts'
import {
  EXTERNAL_TICKET_I18N_KEYS,
  EXTERNAL_TICKET_THANKS_KEY,
  PENDING_PAYMENT_STATUS_FR,
  resolveExternalTicketPaidLabel,
  shouldPrintPendingPaymentThanks,
} from './external-ticket-copy.ts'

function lookup(
  bundle: { ui?: Record<string, string>; nav?: Record<string, string> },
  key: string,
): string | undefined {
  return bundle.ui?.[key] ?? bundle.nav?.[key]
}

describe('external ticket copy — message selon le type de ticket', () => {
  it('ne montre jamais « en attente de paiement » comme clôture d’un ticket externe', () => {
    assert.equal(shouldPrintPendingPaymentThanks('external'), false)
    assert.equal(EXTERNAL_TICKET_THANKS_KEY, 'Merci de votre confiance')
    assert.notEqual(EXTERNAL_TICKET_THANKS_KEY, PENDING_PAYMENT_STATUS_FR)
  })

  it('conserve le message d’attente sur les tickets labo (paiement gestionnaire)', () => {
    assert.equal(shouldPrintPendingPaymentThanks('lab'), true)
  })

  it('n’affiche « Payé » que si le statut est réellement Payé', () => {
    assert.equal(resolveExternalTicketPaidLabel('Payé'), 'Payé')
    assert.equal(resolveExternalTicketPaidLabel('En attente de paiement'), null)
    assert.equal(resolveExternalTicketPaidLabel(undefined), null)
    assert.equal(resolveExternalTicketPaidLabel(''), null)
    assert.equal(resolveExternalTicketPaidLabel('  Payé  '), 'Payé')
  })
})

describe('external ticket copy — traductions FR / EN / AR', () => {
  it('couvre toutes les clés du ticket dans les trois langues, avec une vraie traduction arabe', () => {
    for (const key of EXTERNAL_TICKET_I18N_KEYS) {
      const frVal = lookup(fr, key)
      const enVal = lookup(en, key)
      const arVal = lookup(ar, key)
      assert.ok(frVal, `clé FR manquante : ${key}`)
      assert.ok(enVal, `clé EN manquante : ${key}`)
      assert.ok(arVal, `clé AR manquante : ${key}`)
      assert.notEqual(arVal, key, `AR non traduit (identique à la clé FR) : ${key}`)
      assert.notEqual(arVal, frVal, `AR identique au FR : ${key}`)
    }
  })

  it('traduit le remerciement en arabe', () => {
    assert.equal(lookup(ar, EXTERNAL_TICKET_THANKS_KEY), 'شكراً لثقتكم')
    assert.equal(lookup(fr, EXTERNAL_TICKET_THANKS_KEY), 'Merci de votre confiance')
    assert.equal(lookup(en, EXTERNAL_TICKET_THANKS_KEY), 'Thank you for your trust')
  })
})
