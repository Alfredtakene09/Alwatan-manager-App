/**
 * Constructeur ESC/POS minimal pour tickets 80 mm (Syntalsol ECO250 et compatibles).
 * Largeur typique Font A : 48 colonnes.
 */

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

/** Table approximative CP850 pour accents français courants. */
const CP850 = {
  À: 0xb7,
  Á: 0xb5,
  Â: 0xb6,
  Ä: 0x8e,
  Ç: 0x80,
  È: 0xd4,
  É: 0x90,
  Ê: 0xd2,
  Ë: 0xd3,
  Î: 0xd7,
  Ï: 0xd8,
  Ô: 0xe2,
  Ö: 0x99,
  Ù: 0xeb,
  Ú: 0xe9,
  Û: 0xea,
  Ü: 0x9a,
  à: 0x85,
  á: 0xa0,
  â: 0x83,
  ä: 0x84,
  ç: 0x87,
  è: 0x8a,
  é: 0x82,
  ê: 0x88,
  ë: 0x89,
  î: 0x8c,
  ï: 0x8b,
  ô: 0x93,
  ö: 0x94,
  ù: 0x97,
  ú: 0xa3,
  û: 0x96,
  ü: 0x81,
  ñ: 0xa4,
  Ñ: 0xa5,
  '°': 0xf8,
  '€': 0xd5,
  '’': 0x27,
  '‘': 0x27,
  '“': 0x22,
  '”': 0x22,
  '–': 0x2d,
  '—': 0x2d,
  '…': 0x2e,
  '·': 0xfa,
}

function encodeCp850(text) {
  const out = []
  for (const ch of String(text ?? '')) {
    const code = ch.codePointAt(0) ?? 63
    if (code >= 0x20 && code <= 0x7e) {
      out.push(code)
      continue
    }
    if (ch in CP850) {
      out.push(CP850[ch])
      continue
    }
    // Fallback ASCII sans accent
    const plain = ch.normalize('NFD').replace(/\p{M}/gu, '')
    const p = plain.codePointAt(0)
    out.push(p && p >= 0x20 && p <= 0x7e ? p : 0x3f)
  }
  return Buffer.from(out)
}

function push(...chunks) {
  return Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c))))
}

export function createEscPosBuilder(options = {}) {
  const width = Math.max(24, Number(options.paperWidthChars) || 48)
  const parts = []

  const add = (...bufs) => {
    parts.push(push(...bufs))
  }

  return {
    width,

    init() {
      add(Buffer.from([ESC, 0x40])) // ESC @
      // Code page PC850 (ESC t 2) — accents FR
      add(Buffer.from([ESC, 0x74, 0x02]))
      return this
    },

    align(mode) {
      const n = mode === 'center' ? 1 : mode === 'right' ? 2 : 0
      add(Buffer.from([ESC, 0x61, n]))
      return this
    },

    bold(on) {
      add(Buffer.from([ESC, 0x45, on ? 1 : 0]))
      return this
    },

    doubleHeight(on) {
      add(Buffer.from([GS, 0x21, on ? 0x10 : 0x00]))
      return this
    },

    text(line = '') {
      add(encodeCp850(line), Buffer.from([LF]))
      return this
    },

    textRaw(line = '') {
      add(encodeCp850(line))
      return this
    },

    feed(n = 1) {
      const count = Math.max(0, Math.min(10, Number(n) || 0))
      for (let i = 0; i < count; i += 1) add(Buffer.from([LF]))
      return this
    },

    separator(char = '-') {
      const c = String(char || '-').slice(0, 1)
      add(encodeCp850(c.repeat(width)), Buffer.from([LF]))
      return this
    },

    /** Ligne « libellé …… valeur » (valeur à droite). */
    columns(left, right) {
      const l = String(left ?? '')
      const r = String(right ?? '')
      const gap = width - l.length - r.length
      const line = gap >= 1 ? `${l}${' '.repeat(gap)}${r}` : `${l} ${r}`.slice(0, width)
      return this.text(line)
    },

    cut(partial = false) {
      // GS V — partial/full cut + feed
      add(Buffer.from([GS, 0x56, partial ? 0x01 : 0x00]))
      return this
    },

    openDrawer() {
      // ESC p m t1 t2 — tiroir caisse pin 2
      add(Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]))
      return this
    },

    build() {
      return Buffer.concat(parts)
    },
  }
}

function money(n) {
  const v = Math.round(Number(n) || 0)
  return `${v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} F`
}

function clinicHeader(b, clinic = {}) {
  const name = clinic.shortName || clinic.nameFr || 'Clinique Alwatan'
  b.align('center').bold(true).doubleHeight(true).text(name).doubleHeight(false).bold(false)
  if (clinic.nameAr) b.text(clinic.nameAr)
  if (clinic.city) b.text(clinic.city)
  if (clinic.phones) b.text(clinic.phones)
  b.separator('=')
  return b
}

/** Payload type=consultation | pharmacy */
export function buildReceiptBytes(job, options = {}) {
  const b = createEscPosBuilder(options).init()
  const clinic = job.clinic || {}
  const cut = options.cut !== false

  if (job.type === 'pharmacy') {
    clinicHeader(b, { ...clinic, shortName: clinic.shortName || 'Alwatan Pharmacie' })
    b.align('center').bold(true).text('TICKET DE VENTE').bold(false)
    if (job.invoiceNumber) b.text(`N° ${job.invoiceNumber}`)
    b.align('left').separator('-')
    if (job.date) b.columns('Date', job.date)
    if (job.isExternal === false) b.columns('Type', 'Interne')
    if (job.paymentMode) b.columns('Paiement', job.paymentMode)
    if (job.coveredByName) b.columns('Par', job.coveredByName)
    b.separator('-')
    for (const line of job.items || []) {
      const name = String(line.name || 'Article').slice(0, b.width)
      b.text(name)
      const qty = Number(line.quantity) || 0
      const unit = money(line.unitPrice)
      const total = money(line.lineTotal)
      b.columns(`  ${qty} x ${unit}`, total)
    }
    b.separator('-')
    if (job.grossTotal != null && job.reductionFcfa > 0) {
      b.columns('Sous-total', money(job.grossTotal))
      b.columns(job.reductionLabel || 'Réduction', `- ${money(job.reductionFcfa)}`)
    }
    b.bold(true).columns('TOTAL', money(job.total)).bold(false)
    if (job.notes) {
      b.separator('-')
      b.text(String(job.notes).slice(0, 200))
    }
    b.feed(1).align('center').text('Merci').align('left')
  } else {
    // consultation / réception (défaut)
    clinicHeader(b, clinic)
    b.align('center').bold(true).text('RECU DE CONSULTATION').bold(false)
    if (job.invoiceNumber) b.text(`N° ${job.invoiceNumber}`)
    b.align('left').separator('-')
    if (job.date) b.columns('Date', job.date)
    if (job.patientName) b.columns('Patient', String(job.patientName).slice(0, 28))
    if (job.patientCode) b.columns('Code', job.patientCode)
    if (job.doctorName) b.columns('Medecin', String(job.doctorName).slice(0, 28))
    if (job.processedBy) b.columns('Par', String(job.processedBy).slice(0, 28))
    b.separator('-')
    const gross = job.amount > 0 ? job.amount : (job.total || 0) + Math.max(0, job.reduction || 0)
    const reduction = Math.max(0, job.reduction || 0)
    const net = job.total > 0 ? job.total : Math.max(0, gross - reduction)
    b.columns('Prix consultation', money(gross))
    if (reduction > 0) b.columns('Reduction', `- ${money(reduction)}`)
    b.bold(true).columns('Net paye', money(net)).bold(false)
    b.feed(1).align('center').bold(true).text('Paye').bold(false).text('Merci').align('left')
  }

  b.feed(3)
  if (options.openCashDrawer) b.openDrawer()
  if (cut) b.cut(false)
  return b.build()
}
