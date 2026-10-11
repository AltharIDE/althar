import type { Host } from '../data/services'

/*
 * What a page doesn't handle goes to main's log (DEV-61): an uncaught error,
 * with where it was thrown, and a rejection nobody caught. Only the message
 * and the stack; nothing the page shows.
 */

const LONGEST = 4_000

export const keepWindowErrors = (host: Pick<Host, 'logError'>, target: Window = window) => {
  const log = host.logError
  if (log === undefined) return
  target.addEventListener('error', (event) =>
    log({
      kind: 'error',
      message: String(event.message).slice(0, LONGEST),
      stack: event.error instanceof Error ? (event.error.stack ?? '').slice(0, LONGEST) : '',
      source: `${event.filename}:${event.lineno}:${event.colno}`,
    }),
  )
  target.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason
    log({
      kind: 'rejection',
      message: (reason instanceof Error ? reason.message : String(reason)).slice(0, LONGEST),
      stack: reason instanceof Error ? (reason.stack ?? '').slice(0, LONGEST) : '',
    })
  })
}
