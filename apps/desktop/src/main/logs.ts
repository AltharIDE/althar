import { arch, release } from 'node:os'

import { app, ipcMain, type UtilityProcess } from 'electron'

import { type Fields, type LogFile, openLogFile } from '../logs/logFile'

/*
 * The app's logs, as the main process keeps them (DEV-61), in the folder the
 * system keeps logs in (~/Library/Logs/Althar on a Mac), or in the profile's
 * own logs folder where a profile of its own was given, as the end-to-end
 * tests and a throwaway profile do. main.log has the app's lifecycle and its
 * errors, the window's uncaught errors and rejections among them;
 * runtime.log has what the runtime's process writes, stamped as it arrives,
 * its crash included. agents.log is the runtime's to write. In development
 * what the runtime writes is passed on to the terminal too, as before.
 * Quiet: lifecycle and errors, never what anyone wrote.
 */

/** The longest error the window may send, in characters: a message and its stack, no more. */
const LONGEST_ERROR = 8_000

export interface Logs {
  /** The folder the logs are in. */
  readonly dir: string
  readonly main: LogFile
  readonly runtime: LogFile
  readonly info: (message: string, fields?: Fields) => void
  readonly warn: (message: string, fields?: Fields) => void
  readonly error: (message: string, fields?: Fields) => void
  /** Keeps what a runtime process writes, from its start until it exits. */
  readonly keepOutput: (child: UtilityProcess) => void
}

const describe = (error: unknown) =>
  error instanceof Error ? { error: error.message, stack: error.stack ?? '' } : { error: String(error).slice(0, LONGEST_ERROR) }

/** A string the window sent, cut to a sane length; empty for anything else. */
const said = (value: unknown, max = LONGEST_ERROR) => (typeof value === 'string' ? value.slice(0, max) : '')

export const startLogs = ({ dir, passOn }: { readonly dir: string; readonly passOn: boolean }): Logs => {
  const main = openLogFile({ dir, name: 'main', maxBytes: 1_000_000 })
  const runtime = openLogFile({ dir, name: 'runtime' })
  const info = (message: string, fields?: Fields) => main.line('INFO', message, fields)
  const warn = (message: string, fields?: Fields) => main.line('WARN', message, fields)
  const error = (message: string, fields?: Fields) => main.line('ERROR', message, fields)

  info('Althar started', {
    version: app.getVersion(),
    electron: process.versions.electron,
    os: process.platform,
    release: release(),
    arch: arch(),
    packaged: app.isPackaged,
    pid: process.pid,
  })

  // Watched, not handled, so what Electron does with them stays as it was.
  process.on('uncaughtExceptionMonitor', (thrown, origin) => error('Uncaught in the main process', { origin, ...describe(thrown) }))
  // Electron only warns of a rejection nothing handled, on stderr, and listening stops the warning: it is kept here instead.
  process.on('unhandledRejection', (reason) => error('Unhandled rejection in the main process', describe(reason)))
  app.on('render-process-gone', (_event, _contents, details) =>
    error('A window’s page stopped', { reason: details.reason, exitCode: details.exitCode }),
  )
  app.on('child-process-gone', (_event, details) =>
    (details.reason === 'clean-exit' ? info : error)('A process of Althar’s stopped', {
      type: details.type,
      name: details.name ?? details.serviceName,
      reason: details.reason,
      exitCode: details.exitCode,
    }),
  )
  app.on('before-quit', () => info('Althar quitting'))

  // What the window couldn't handle: its uncaught errors and rejections, as it sends them.
  ipcMain.on('althar:window-error', (_event, report: unknown) => {
    const { kind, message, stack, source } = (typeof report === 'object' && report !== null ? report : {}) as Record<string, unknown>
    error(kind === 'rejection' ? 'Unhandled rejection in the window' : 'Uncaught in the window', {
      error: said(message, 2_000),
      stack: said(stack),
      ...(said(source, 500) === '' ? {} : { source: said(source, 500) }),
    })
  })

  return {
    dir,
    main,
    runtime,
    info,
    warn,
    error,
    keepOutput: (child) => {
      const out = runtime.stream()
      const err = runtime.stream('stderr')
      child.stdout?.on('data', (chunk: Buffer) => {
        out.write(chunk.toString())
        if (passOn) process.stdout.write(chunk)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        err.write(chunk.toString())
        if (passOn) process.stderr.write(chunk)
      })
      child.once('exit', () => {
        out.end()
        err.end()
      })
    },
  }
}
