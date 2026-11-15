import { createRequire } from 'node:module'

import { afterEach, beforeEach, vi } from 'vitest'

import { Ready } from '../src/outputs/ChangeSet/ChangeSet.stories'
import { runStories, type StoryFile } from './stories'

// An asynchronous Testing Library wait can restore its act flag while Storybook's own renderer awaits its root.
// Both renderers must not wait for each other's commit in that interval.
const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
// Storybook's native dynamic import and Testing Library's CommonJS renderer must see the same instrumented root.
const client = createRequire(import.meta.url)('react-dom/client') as typeof import('react-dom/client')
let was: boolean | undefined
beforeEach(() => {
  was = reactEnvironment.IS_REACT_ACT_ENVIRONMENT
  const createRoot = client.createRoot
  vi.spyOn(client, 'createRoot').mockImplementation((...args) => {
    const root = createRoot(...args)
    queueMicrotask(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false }))
    return root
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = was
})

const file = '../src/outputs/ChangeSet/ChangeSet.stories.tsx'
const changeSet = import.meta.glob<StoryFile>('../src/outputs/ChangeSet/ChangeSet.stories.tsx', { eager: true })[file]!
const selected = { default: changeSet.default, Ready }
runStories({ 'outputs/ChangeSet/ChangeSet.stories.tsx': selected })
