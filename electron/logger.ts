import path from 'path'
import { app } from 'electron'
import log from 'electron-log'

// Configure electron-log
try {
  const userData = app.getPath('userData')
  const logDir = path.join(userData, 'logs')
  // electron-log creates dirs automatically when writing
  // Set custom file
  // @ts-ignore - older electron-log types
  log.transports.file.resolvePath = () => path.join(logDir, 'app.log')
  log.transports.file.maxSize = 5 * 1024 * 1024 // 5MB
  log.transports.console.level = 'silly'
  log.transports.file.level = 'silly'
} catch (e) {
  /* ignore until app ready */
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

function base(level: LogLevel, category: string, message: string, data?: any) {
  const ts = new Date().toISOString()
  const payload = { ts, category, message, ...(data !== undefined ? { data } : {}) }
  switch (level) {
    case 'debug': log.debug(payload); break
    case 'info': log.info(payload); break
    case 'warn': log.warn(payload); break
    case 'error': log.error(payload); break
  }
  // Also echo to stdout/stderr for immediate visibility
  const line = `[${ts}] [${level.toUpperCase()}] [${category}] ${message}`
  if (level === 'error') console.error(line, data ?? '')
  else console.log(line, data ?? '')
}

export const logger = {
  debug: (category: string, message: string, data?: any) => base('debug', category, message, data),
  info: (category: string, message: string, data?: any) => base('info', category, message, data),
  warn: (category: string, message: string, data?: any) => base('warn', category, message, data),
  error: (category: string, message: string, data?: any) => base('error', category, message, data)
}

export function logPhase(category: string, phase: string, meta?: any) {
  logger.info(category, `PHASE: ${phase}`, meta)
}

export function logDuration(category: string, label: string, start: number) {
  const ms = Date.now() - start
  logger.info(category, `DURATION ${label}: ${ms}ms`)
  return ms
}
