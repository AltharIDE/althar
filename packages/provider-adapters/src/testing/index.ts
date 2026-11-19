import { fileURLToPath } from 'node:url'

import { Effect, Exit } from 'effect'

import { keeper } from '../keeper'

export * from './FakeAgent'
export * from './recorded'
export * from './fileHolds'

/** The fake agent's process entry point, to run with Bun. */
export const fakeAgentMain = fileURLToPath(new URL('./fakeAgentMain.ts', import.meta.url))

/** A peer that exercises live compatibility checks, including HTTP MCP and cancellation. */
export const compatibilityAgentMain = fileURLToPath(new URL('./compatibilityAgentMain.ts', import.meta.url))

/**
 * On Windows, builds the keeper agents' processes run under (keeper.ts) once for the machine, as a package's tests begin
 * (Vitest's `globalSetup`), before any test worker starts. Built on first use, the first process each worker spawns
 * would wait seconds on the .NET compiler, longer under a busy runner, with every worker compiling it at once: built
 * first, a test times only its own work. Where it can't be built, that is said, and the tests that need it say why.
 */
export const keeperFirst = async () => {
  if (process.platform !== 'win32') return
  const exit = await Effect.runPromiseExit(keeper())
  if (Exit.isFailure(exit)) console.warn('The keeper of agents’ processes could not be built ahead of the tests', exit.cause)
}
