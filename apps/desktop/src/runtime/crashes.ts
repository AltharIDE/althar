/*
 * What the runtime couldn't handle, for the main process (DEV-66): an
 * exception nobody caught, a rejection nobody handled, and the defect its
 * program stopped on. Each goes over the parent port as a `crash` message,
 * its name, message and stack and nothing else, and main sends it as a
 * crash report while the person allows it (main/crashReports.ts). They are
 * watched, not handled: an uncaught exception still ends the process, as
 * before. A rejection nobody handled never did, in Electron's utility
 * process; it is written to stderr, for runtime.log, as Node would have
 * warned of it, since listening for it stops Node's own warning.
 */

export type RuntimeCrashHow = 'uncaught' | 'rejection' | 'defect'

export interface RuntimeCrash {
  readonly how: RuntimeCrashHow
  readonly name: string
  readonly message: string
  readonly stack: string
}

/** What was thrown, as words that cross to the main process: an error's own, or what anything else says it is. */
export const crashOf = (how: RuntimeCrashHow, thrown: unknown): RuntimeCrash => {
  if (thrown instanceof Error)
    return { how, name: thrown.name || 'Error', message: thrown.message.slice(0, 4_000), stack: (thrown.stack ?? '').slice(0, 16_000) }
  let words: string
  try {
    words = String(thrown)
  } catch {
    words = typeof thrown
  }
  return { how, name: 'Error', message: words.slice(0, 4_000), stack: '' }
}

/** Tells the main process each crash as it comes, through `post`; telling never throws into what failed. */
export const watchCrashes = (
  post: (message: { readonly type: 'crash'; readonly crash: RuntimeCrash }) => void,
  on: Pick<NodeJS.Process, 'on'> = process,
  warn: (line: string) => void = (line) => void process.stderr.write(line),
) => {
  const tell = (how: RuntimeCrashHow, thrown: unknown) => {
    try {
      post({ type: 'crash', crash: crashOf(how, thrown) })
    } catch {
      // The port may be gone with the process.
    }
  }
  on.on('uncaughtExceptionMonitor', (thrown) => tell('uncaught', thrown))
  on.on('unhandledRejection', (reason) => {
    const { name, message, stack } = crashOf('rejection', reason)
    warn(`Unhandled rejection: ${stack === '' ? `${name}: ${message}` : stack}\n`)
    tell('rejection', reason)
  })
  return { defect: (thrown: unknown) => tell('defect', thrown) }
}
