import { keeperFirst } from '@althar/provider-adapters/testing'

/** Vitest's global setup: on Windows, the keeper of agents' processes is built before any test worker starts. */
export default keeperFirst
