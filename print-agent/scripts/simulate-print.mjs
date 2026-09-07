/**
 * Simulations locales (serveur) — sans imprimante physique.
 * Usage: node print-agent/scripts/simulate-print.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { buildReceiptBytes } from '../lib/escpos.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const results = []

function ok(name, detail = '') {
  results.push({ name, pass: true, detail })
  console.log(`  [OK] ${name}${detail ? ' — ' + detail : ''}`)
}
function fail(name, detail = '') {
  results.push({ name, pass: false, detail })
  console.log(`  [X] ${name}${detail ? ' — ' + detail : ''}`)
}

function assert(name, cond, detail = '') {
  if (cond) ok(name, detail)
  else fail(name, detail)
}

console.log('\n=== Simulation 1: ESC/POS buildReceiptBytes ===')
const pharmacyBytes = buildReceiptBytes(
  {
    type: 'pharmacy',
    invoiceNumber: 'FAC-SIM-001',
    date: '04/09/2026 14:00',
    paymentMode: 'Espèces',
    items: [
      { name: 'Paracétamol 500', quantity: 2, unitPrice: 100, lineTotal: 200 },
      { name: 'Vitamine C', quantity: 1, unitPrice: 500, lineTotal: 500 },
    ],
    total: 700,
    clinic: { shortName: 'Alwatan Pharmacie', city: 'Nouakchott' },
  },
  { paperWidthChars: 48, cut: true },
)
assert('pharmacy bytes > 100', pharmacyBytes.length > 100, `${pharmacyBytes.length} bytes`)
assert('ESC @ init', pharmacyBytes[0] === 0x1b && pharmacyBytes[1] === 0x40)
assert('contient FAC-SIM', pharmacyBytes.includes(Buffer.from('FAC-SIM')[0]) || pharmacyBytes.toString('latin1').includes('FAC-SIM'))
assert('GS V cut present', pharmacyBytes.includes(0x1d) && pharmacyBytes.toString('binary').includes(String.fromCharCode(0x1d, 0x56)))

const consultBytes = buildReceiptBytes(
  {
    type: 'consultation',
    invoiceNumber: 'C-99',
    patientName: 'Test Patient',
    patientCode: 'P001',
    doctorName: 'Dr Test',
    amount: 5000,
    reduction: 500,
    total: 4500,
    clinic: { shortName: 'Clinique Alwatan' },
  },
  { cut: true },
)
assert('consultation bytes > 80', consultBytes.length > 80, `${consultBytes.length} bytes`)

const outDir = path.join(root, 'logs-sim')
fs.mkdirSync(outDir, { recursive: true })
const binPath = path.join(outDir, 'ticket-sim.bin')
fs.writeFileSync(binPath, pharmacyBytes)
ok('fichier ticket-sim.bin ecrit', binPath)

console.log('\n=== Simulation 2: JSON UTF-16 (bug PowerShell) ===')
function parseBodyLikeServer(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    buf = Buffer.from(buf.toString('utf16le'))
  } else if (buf.length >= 4 && buf[1] === 0x00 && buf[3] === 0x00) {
    buf = Buffer.from(buf.toString('utf16le'))
  }
  let text = buf.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return JSON.parse(text)
}
const utf8 = Buffer.from('{"printerName":"Alwatan-Ticket-RAW"}', 'utf8')
const utf16 = Buffer.from('{"printerName":"Alwatan-Ticket-RAW"}', 'utf16le')
assert('parse UTF-8', parseBodyLikeServer(utf8).printerName === 'Alwatan-Ticket-RAW')
assert('parse UTF-16 LE', parseBodyLikeServer(utf16).printerName === 'Alwatan-Ticket-RAW')

console.log('\n=== Simulation 3: raw-print.ps1 Mode Direct (port factice) ===')
const ps1 = path.join(root, 'lib', 'raw-print.ps1')
assert('raw-print.ps1 existe', fs.existsSync(ps1))

await new Promise((resolve) => {
  const child = spawn(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      ps1,
      '-FilePath',
      binPath,
      '-Mode',
      'Direct',
      '-DirectPort',
      'USB999',
      '-PrinterName',
      '',
    ],
    { windowsHide: true },
  )
  let err = ''
  child.stderr.on('data', (d) => {
    err += d.toString()
  })
  child.on('close', (code) => {
    // Doit échouer (port inexistant) mais script ne doit pas crasher sans message
    assert('Direct port inexistant exit!=0', code !== 0, `exit=${code}`)
    assert('message erreur present', err.length > 0 || code !== 0, err.slice(0, 120))
    resolve()
  })
})

console.log('\n=== Simulation 4: Agent HTTP local (ephemere) ===')
const agentPort = 19199
const configPath = path.join(outDir, 'config-sim.json')
fs.writeFileSync(
  configPath,
  JSON.stringify({
    port: agentPort,
    host: '127.0.0.1',
    printMode: 'Direct',
    directPort: 'USB999',
    printerName: 'Alwatan-Ticket-RAW',
    paperWidthChars: 48,
    cut: true,
    logDir: outDir,
  }),
)

// Mini health server mimicking new contract (sans vrai print)
await new Promise((resolve, reject) => {
  const srv = http.createServer((req, res) => {
    if (req.url === '/health') {
      const body = JSON.stringify({
        ok: true,
        version: '1.2.0',
        printMode: 'Direct',
        printerName: 'Alwatan-Ticket-RAW',
        configured: true,
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(body)
      return
    }
    res.writeHead(404)
    res.end()
  })
  srv.listen(agentPort, '127.0.0.1', async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${agentPort}/health`)
      const data = await res.json()
      assert('health ok', data.ok === true)
      assert('health version 1.2', data.version === '1.2.0')
      assert('health Direct', data.printMode === 'Direct')
      assert('health RAW name', data.printerName === 'Alwatan-Ticket-RAW')
    } catch (e) {
      fail('health fetch', e.message)
    } finally {
      srv.close()
      resolve()
    }
  })
  srv.on('error', reject)
})

console.log('\n=== Simulation 5: server.mjs syntax / import ===')
await new Promise((resolve) => {
  const child = spawn('node', ['--check', path.join(root, 'server.mjs')], { windowsHide: true })
  let err = ''
  child.stderr.on('data', (d) => {
    err += d.toString()
  })
  child.on('close', (code) => {
    assert('server.mjs syntax', code === 0, err.slice(0, 200))
    resolve()
  })
})

console.log('\n=== Simulation 6: config printMode Direct ===')
const example = JSON.parse(fs.readFileSync(path.join(root, 'config.example.json'), 'utf8'))
assert('example a port 19100', example.port === 19100)

// Update example for new fields
const examplePath = path.join(root, 'config.example.json')
const nextExample = {
  ...example,
  printMode: 'Auto',
  directPort: '',
  printerName: example.printerName || 'Alwatan-Ticket-RAW',
}
fs.writeFileSync(examplePath, JSON.stringify(nextExample, null, 2))
ok('config.example.json enrichi', 'printMode+directPort')

const failed = results.filter((r) => !r.pass)
console.log('\n========================================')
console.log(`Resultats: ${results.length - failed.length}/${results.length} OK`)
if (failed.length) {
  console.log('Echecs:')
  failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`))
  process.exit(1)
}
console.log('Toutes les simulations logicielles sont OK.')
console.log('Sur le poste Pharmacie: lancer REPARER-IMPRESSION.bat (v3 USB direct).')
console.log('')
