import { fileURLToPath } from 'node:url'

export * from './FakeAgent'
export * from './recorded'
export * from './fileHolds'

/** The fake agent's process entry point, to run with Bun. */
export const fakeAgentMain = fileURLToPath(new URL('./fakeAgentMain.ts', import.meta.url))

/** A peer that exercises live compatibility checks, including HTTP MCP and cancellation. */
export const compatibilityAgentMain = fileURLToPath(new URL('./compatibilityAgentMain.ts', import.meta.url))
