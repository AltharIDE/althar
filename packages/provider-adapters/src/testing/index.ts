import { fileURLToPath } from 'node:url'

export * from './FakeAgent'
export * from './recorded'

/** The fake agent's process entry point, to run with Bun. */
export const fakeAgentMain = fileURLToPath(new URL('./fakeAgentMain.ts', import.meta.url))
