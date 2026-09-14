import type { LoggerPort, LogLevel } from '../ports'

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export function createConsoleLogger(minLevel: LogLevel = 'info'): LoggerPort {
  return {
    log(level, message, meta) {
      if (ORDER[level] < ORDER[minLevel]) return
      const line = `[轻画] ${message}`
      if (meta) console[level === 'debug' ? 'debug' : level](line, meta)
      else console[level === 'debug' ? 'debug' : level](line)
    },
  }
}
