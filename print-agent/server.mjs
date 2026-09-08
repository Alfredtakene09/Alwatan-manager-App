import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { buildReceiptBytes } from './lib/escpos.mjs'
import { initLogger, log } from './lib/logger.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = __dirname
const CONFIG_PATH = path.join(ROOT, 'config.json')
const EXAMPLE_PATH = path.join(ROOT, 'config.example.json')
const RAW_PS1 = path.join(ROOT, 'lib', 'raw-print.ps1')
const VERSION = '1.4.2'

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH)
  }
  let text = fs.readFileSync(CONFIG_PATH, 'utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const raw = JSON.parse(text)
  return {
    port: Number(raw.port) || 19100,
    host: String(raw.host || '127.0.0.1'),
    interface: String(raw.interface || 'usb'),
    /** Auto | Spooler | Direct — Auto essaie TOUS les ports USB reels. */
    printMode: String(raw.printMode || 'Auto'),
    directPort: String(raw.directPort || '').trim(),
    printerName: String(raw.printerName || '').trim(),
    paperWidthChars: Number(raw.paperWidthChars) || 48,
    cut: raw.cut !== false,
    openCashDrawer: Boolean(raw.openCashDrawer),
    codePage: String(raw.codePage || 'cp850'),
    printToken: String(raw.printToken || '').trim(),
    allowRemotePrint: Boolean(raw.allowRemotePrint),
    logDir: path.isAbsolute(raw.logDir)
      ? raw.logDir
      : path.join(ROOT, raw.logDir || 'logs'),
  }
}

function listPrinterNames() {
  try {
    const out = spawn(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name',
      ],
      { windowsHide: true },
    )
    return new Promise((resolve) => {
      let stdout = ''
      out.stdout.on('data', (d) => {
        stdout += d.toString('utf8')
      })
      out.on('close', () => {
        resolve(
          stdout
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean),
        )
      })
      out.on('error', () => resolve([]))
    })
  } catch {
    return Promise.resolve([])
  }
}

async function resolvePrinterName(config) {
  if (config.printerName) return config.printerName
  const names = await listPrinterNames()
  const prefer =
    names.find((n) => /alwatan-ticket-raw/i.test(n)) ||
    names.find((n) => /eco250|e-?pos|syntalsol|thermal|ticket|receipt|pos/i.test(n))
  if (prefer) return prefer
  if (names.length === 1) return names[0]
  return ''
}

function sendRawToPrinter(printerName, bytes, docName, config) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `alwatan-ticket-${Date.now()}-${process.pid}.bin`)
    fs.writeFileSync(tmp, bytes)
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      RAW_PS1,
      '-FilePath',
      tmp,
      '-DocName',
      docName || 'Alwatan Ticket',
      '-Mode',
      config.printMode || 'Auto',
    ]
    if (printerName) {
      args.push('-PrinterName', printerName)
    }
    if (config.directPort) {
      args.push('-DirectPort', config.directPort)
    }
    const child = spawn('powershell', args, { windowsHide: true })
    let stderr = ''
    let stdout = ''
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8')
    })
    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8')
    })
    child.on('error', (err) => {
      try {
        fs.unlinkSync(tmp)
      } catch {
        /* ignore */
      }
      reject(err)
    })
    child.on('close', (code) => {
      try {
        fs.unlinkSync(tmp)
      } catch {
        /* ignore */
      }
      if (code === 0) resolve({ method: stdout.trim() || 'OK' })
      else reject(new Error(stderr.trim() || stdout.trim() || `raw-print exit ${code}`))
    })
  })
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1_000_000) {
        reject(new Error('Payload trop volumineux'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        let buf = Buffer.concat(chunks)
        // PowerShell Invoke-RestMethod envoie parfois UTF-16 LE
        if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
          buf = Buffer.from(buf.toString('utf16le'))
        } else if (buf.length >= 4 && buf[1] === 0x00 && buf[3] === 0x00) {
          buf = Buffer.from(buf.toString('utf16le'))
        }
        let text = buf.toString('utf8')
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
        resolve(text ? JSON.parse(text) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

const PRIVATE_LAN_ORIGIN =
  /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.\d{1,3}\.\d{1,3}\.\d{1,3}|[\w.-]+\.ts\.net)(?::\d+)?$/i

function requestOrigin(req) {
  const origin = String(req.headers.origin || '').trim()
  if (origin) return origin
  const referer = String(req.headers.referer || '').trim()
  if (!referer) return ''
  try {
    return new URL(referer).origin
  } catch {
    return ''
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return true
  return PRIVATE_LAN_ORIGIN.test(origin)
}

function isLoopbackAddress(addr) {
  if (!addr) return false
  const ip = String(addr).replace(/^::ffff:/, '')
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost'
}

function requestPrintToken(req) {
  const header = String(req.headers['x-print-token'] || '').trim()
  if (header) return header
  const auth = String(req.headers.authorization || '')
  const match = /^Bearer\s+(.+)$/i.exec(auth)
  return match ? match[1].trim() : ''
}

function corsHeaders(req, extra = {}) {
  const origin = requestOrigin(req)
  const allowOrigin = origin && isAllowedOrigin(origin) ? origin : 'http://127.0.0.1'
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Print-Token, Access-Control-Request-Private-Network',
    'Access-Control-Allow-Private-Network': 'true',
    'Private-Network-Access-Name': 'Alwatan Print Agent',
    'Private-Network-Access-ID': '01:Alwatan:Print:Agent00',
    ...extra,
  }
}

function authorizePrintRequest(req, config) {
  const origin = requestOrigin(req)
  if (origin && !isAllowedOrigin(origin)) {
    return { ok: false, status: 403, error: 'Origine non autorisée' }
  }
  const remote = req.socket?.remoteAddress
  if (!isLoopbackAddress(remote) && !config.allowRemotePrint) {
    return { ok: false, status: 403, error: 'Impression réservée à ce poste (127.0.0.1)' }
  }
  if (config.printToken && requestPrintToken(req) !== config.printToken) {
    return { ok: false, status: 401, error: 'Jeton d’impression manquant ou invalide' }
  }
  return { ok: true }
}

function sendJson(res, req, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    ...corsHeaders(req, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
    }),
  })
  res.end(payload)
}

async function handlePrint(config, body) {
  let printerName =
    (body.printerName && String(body.printerName).trim()) || (await resolvePrinterName(config))

  // Si la file configuree n'existe plus, basculer sur une file presente
  const names = await listPrinterNames()
  if (printerName && names.length && !names.includes(printerName)) {
    const fallback =
      names.find((n) => /alwatan-ticket-raw/i.test(n)) ||
      names.find((n) => /^POS-80$/i.test(n)) ||
      names.find((n) => /pos|eco|ticket|receipt/i.test(n) && !/pdf/i.test(n))
    if (fallback) {
      log.warn('Imprimante absente, fallback', { from: printerName, to: fallback })
      printerName = fallback
    }
  }

  const bytes = buildReceiptBytes(body, {
    paperWidthChars: config.paperWidthChars,
    cut: config.cut,
    openCashDrawer: config.openCashDrawer,
  })

  const docName =
    body.type === 'pharmacy'
      ? `Alwatan Pharmacie ${body.invoiceNumber || ''}`.trim()
      : `Alwatan Reception ${body.invoiceNumber || body.patientCode || ''}`.trim()

  log.info('Impression démarrée', {
    type: body.type || 'consultation',
    printerName: printerName || '(direct-usb)',
    printMode: config.printMode,
    bytes: bytes.length,
    invoiceNumber: body.invoiceNumber || null,
  })

  try {
    const result = await sendRawToPrinter(printerName || 'Alwatan-Ticket-RAW', bytes, docName, config)
    log.info('Impression OK', {
      printerName: printerName || null,
      method: result.method,
      type: body.type || 'consultation',
    })
    return {
      ok: true,
      printerName: printerName || null,
      bytes: bytes.length,
      method: result.method,
      version: VERSION,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const enriched = new Error(
      message.includes('fantome') || message.includes('aucun port')
        ? `${message} | Lancez FIXER-IMPRESSION.bat (restaure POS-80).`
        : message,
    )
    enriched.code = err?.code || 'PRINT_FAILED'
    throw enriched
  }
}

async function main() {
  const bootConfig = loadConfig()
  initLogger(bootConfig.logDir)

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(req))
      res.end()
      return
    }

    // Recharge config a chaque requete (AppData peut changer sans redemarrage)
    const config = loadConfig()
    const url = new URL(req.url || '/', `http://${config.host}:${config.port}`)

    try {
      if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
        const printerName = await resolvePrinterName(config)
        sendJson(res, req, 200, {
          ok: true,
          service: 'alwatan-print-agent',
          version: VERSION,
          interface: config.interface,
          printMode: config.printMode,
          directPort: config.directPort || null,
          printerName: printerName || null,
          configured:
            Boolean(printerName) ||
            config.printMode === 'Direct' ||
            config.printMode === 'Auto',
          configPath: CONFIG_PATH,
        })
        return
      }

      if (req.method === 'GET' && url.pathname === '/printers') {
        const printers = await listPrinterNames()
        sendJson(res, req, 200, { ok: true, printers })
        return
      }

      if (req.method === 'POST' && url.pathname === '/print') {
        const authz = authorizePrintRequest(req, config)
        if (!authz.ok) {
          sendJson(res, req, authz.status, { ok: false, error: authz.error })
          return
        }
        const body = await readJson(req)
        const result = await handlePrint(config, body)
        sendJson(res, req, 200, result)
        return
      }

      if (req.method === 'POST' && url.pathname === '/test') {
        const authz = authorizePrintRequest(req, config)
        if (!authz.ok) {
          sendJson(res, req, authz.status, { ok: false, error: authz.error })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const printerName =
          (body.printerName && String(body.printerName).trim()) ||
          (await resolvePrinterName(config))
        const result = await handlePrint(config, {
          type: 'pharmacy',
          invoiceNumber: 'TEST',
          date: new Date().toLocaleString('fr-FR'),
          paymentMode: 'Test',
          items: [{ name: 'Ticket test Alwatan', quantity: 1, unitPrice: 0, lineTotal: 0 }],
          total: 0,
          clinic: { shortName: 'Alwatan Pharmacie', city: 'Test impression' },
          printerName,
        })
        sendJson(res, req, 200, result)
        return
      }

      sendJson(res, req, 404, { ok: false, error: 'Not found' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('Requête échouée', { path: url.pathname, message })
      sendJson(res, req, 500, { ok: false, error: message, code: err?.code || 'PRINT_FAILED' })
    }
  })

  server.listen(bootConfig.port, bootConfig.host, () => {
    log.info(`Agent d'impression Alwatan écoute sur http://${bootConfig.host}:${bootConfig.port}`)
    log.info(`Version ${VERSION} Config: ${CONFIG_PATH}`)
  })

  server.on('error', (err) => {
    log.error('Impossible de démarrer le serveur', err.message)
    process.exit(1)
  })
}

main()
