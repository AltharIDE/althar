import { resolve } from 'node:path'

import { Cause, Effect, Exit, Logger } from 'effect'

import { clearServiceEnvironment, failureMessage, runCommand } from './commands'
import { parseOptions } from './options'
import { workerMain } from './workerSetup'

let exitCode = 0
// A worker's own setup, as the window runs it on a worker: apart from the home's commands.
if (process.argv[2] === 'worker') {
  exitCode = await workerMain(process.argv.slice(3), (text) => {
    process.stdout.write(text)
  })
} else
  try {
    const options = parseOptions(process.argv.slice(2))
    const updateLocked = process.env.ALTHAR_HOST_UPDATE_LOCKED
    const releaseSigningKey = options.command === 'package-release' ? process.env.ALTHAR_HOST_RELEASE_SIGNING_KEY : undefined
    const workerBinary = options.command === 'package-release' ? process.env.ALTHAR_WORKER_BINARY : undefined
    const workerTools = options.command === 'package-release' ? process.env.ALTHAR_WORKER_TOOLS : undefined
    const controls = clearServiceEnvironment(process.env)
    const stop = new AbortController()
    const interrupted = () => stop.abort()
    process.on('SIGINT', interrupted)
    process.on('SIGTERM', interrupted)
    try {
      const exit = await Effect.runPromiseExit(
        runCommand(options, {
          out: (text) => {
            process.stdout.write(text)
          },
          node: process.execPath,
          entry: resolve(process.argv[1] ?? 'dist/althar-host.js'),
          path: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
          ...controls,
          updateLocked,
          releaseSigningKey,
          workerBinary,
          workerTools,
        }).pipe(Effect.provide(Logger.layer([Logger.withConsoleError(Logger.formatJson)]))),
        { signal: stop.signal },
      )
      if (Exit.isFailure(exit)) {
        if (Cause.hasInterruptsOnly(exit.cause)) exitCode = options.command === 'serve' ? 0 : 130
        else {
          const failure = failureMessage(exit.cause)
          process.stderr.write(`${failure.message}\n`)
          exitCode = failure.exitCode
        }
      }
    } finally {
      process.off('SIGINT', interrupted)
      process.off('SIGTERM', interrupted)
    }
  } catch (error) {
    const failure = failureMessage(Cause.fail(error))
    process.stderr.write(`${failure.message}\n`)
    exitCode = failure.exitCode
  }
// A finite command can emit more than a pipe's buffer (for example many provisioned projects).
// Flush both streams before the explicit process exit, which also ends any third-party handles.
await Promise.all([
  new Promise<void>((resolve) => {
    process.stdout.write('', () => resolve())
  }),
  new Promise<void>((resolve) => {
    process.stderr.write('', () => resolve())
  }),
])
process.exit(exitCode)
