import fs from 'node:fs'
import path from 'node:path'

let logFile = null

export function initLogger(logDir) {
  fs.mkdirSync(logDir, { recursive: true })
  logFile = path.join(logDir, 'print-agent.log')
}

function stamp() {
  return new Date().toISOString()
}

function write(level, message, extra) {
  const line =
    extra === undefined
      ? `[${stamp()}] ${level} ${message}`
      : `[${stamp()}] ${level} ${message} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`
  console.log(line)
  if (!logFile) return
  try {
    fs.appendFileSync(logFile, `${line}\n`, 'utf8')
  } catch {
    /* ignore */
  }
}

export const log = {
  info: (msg, extra) => write('INFO', msg, extra),
  warn: (msg, extra) => write('WARN', msg, extra),
  error: (msg, extra) => write('ERROR', msg, extra),
}
