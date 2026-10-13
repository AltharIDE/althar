import type { ReactNode } from 'react'

import { follow } from '../../src/renderer/data/feed'
import { makeQueryClient } from '../../src/renderer/data/reads'
import { ServicesProvider } from '../../src/renderer/data/services'
import type { TaskModel } from '../../src/renderer/features/task/useTask'
import { agents, fakeClient, fakeHost } from '../../tests/fixtures'
import { type Scenario, scenarios, snapshotOf } from './scenario'

/*
 * What the app's screens reach for, faked as its tests fake it: a runtime
 * that answers with the scenario, and a task's view model whose actions do
 * nothing.
 */

const { client } = fakeClient({ getThread: async () => snapshotOf(scenarios[0] as Scenario) })
const services = (() => {
  const cache = makeQueryClient()
  return { client, host: fakeHost(), cache, feed: follow(client, cache) }
})()

export function Services({ children }: { children: ReactNode }) {
  return <ServicesProvider value={services}>{children}</ServicesProvider>
}

const nothing = async () => undefined

/** The task's view model for a scenario. */
export const modelOf = (scenario: Scenario): TaskModel => {
  const base: Partial<TaskModel> = {
    snapshot: snapshotOf(scenario),
    streaming: new Map(),
    outputs: new Map(),
    agents,
    agentsKnown: true,
    error: null,
    conflict: null,
    refused: null,
    pending: false,
    doing: null,
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
  }
  // Anything else the view calls does nothing.
  return new Proxy(base, { get: (target, key) => (key in target ? target[key as keyof TaskModel] : nothing) }) as TaskModel
}
