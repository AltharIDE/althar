import type { ReactNode } from 'react'

import { follow } from '../../src/renderer/data/feed'
import { makeQueryClient } from '../../src/renderer/data/reads'
import { ServicesProvider } from '../../src/renderer/data/services'
import { doing } from '../../src/renderer/features/task/actions'
import type { TaskModel } from '../../src/renderer/features/task/useTask'
import { agents, fakeClient, fakeHost } from '../../tests/fixtures'
import { type PushStage, snapshotAt, URL } from './scenario'

/*
 * What the app's screens reach for, faked as its tests fake it: a runtime
 * that answers with the scenario, and a task's view model whose actions do
 * nothing unless the page gives them something to do.
 */

const { client } = fakeClient({ getThread: async () => snapshotAt('ahead') })
const services = (() => {
  const cache = makeQueryClient()
  return { client, host: fakeHost(), cache, feed: follow(client, cache) }
})()

export function Services({ children }: { children: ReactNode }) {
  return <ServicesProvider value={services}>{children}</ServicesProvider>
}

const nothing = async () => undefined

/** The task's view model at a stage: pushing is an action on its way, as the real one says it. */
export const modelAt = (stage: PushStage, overrides: Partial<TaskModel> = {}): TaskModel => {
  const base: Partial<TaskModel> = {
    snapshot: snapshotAt(stage),
    streaming: new Map(),
    outputs: new Map(),
    agents,
    agentsKnown: true,
    error: null,
    conflict: null,
    refused: null,
    pending: stage === 'pushing',
    doing: stage === 'pushing' ? doing.push(URL) : null,
    loadingEarlier: false,
    send: async () => true,
    sendNow: async () => true,
    takeBack: async () => true,
    abandon: async () => true,
    answer: async () => true,
    answerQuestion: async () => null,
    mergeNote: async () => null,
    dismissConflict: () => {},
    dismissError: () => {},
    readFiles: () => {},
    ...overrides,
  }
  // Anything else the view calls does nothing.
  return new Proxy(base, { get: (target, key) => (key in target ? target[key as keyof TaskModel] : nothing) }) as TaskModel
}
