import { useCallback, useEffect, useSyncExternalStore } from 'react'

import type { AgentModels } from '@althar/contracts'

import type { Client } from './client'
import { useServices } from './services'

/*
 * The models each agent offers, read once for the window and shared by
 * every picker in it: read again when a picker appears, shortly after while
 * an agent is still being asked, when the agents' sign-ins are checked
 * again (one found signed in is asked its models afresh), and after the
 * person sets a default effort or switches a model off or on.
 *
 * What the person changes shows in every picker at once, ahead of the
 * runtime (docs/decisions/foundations.md, "The UI is instant"): it is held
 * beside what was read, by model and by what changed, until a read that
 * began after the runtime took it lands, so a read from before it never
 * takes it back. Changes made one after another to the same model are
 * written in turn, the latest last, and the window settles on the latest.
 * One the runtime doesn't take is taken back, and its caller told so.
 */

/** How soon an agent still being asked is read again. */
const AGAIN = 2000

/** What the person can change of a model: its default effort, and whether it is switched off. */
type Setting = { readonly kind: 'effort'; readonly effort: string } | { readonly kind: 'blocked'; readonly blocked: boolean }

/* One model's setting the person changed, held until a read confirms it. */
interface Change {
  readonly agentId: string
  readonly model: string
  /** What the person wants now: the latest they chose. */
  wanted: Setting
  /** Counts the person's changes to it, so a write answering knows whether a later one came since. */
  count: number
  /** A write of it is on its way. */
  writing: boolean
  /** Taken by the runtime: a read begun after this many confirms it. Null until then. */
  after: number | null
  /**
   * The latest the runtime took of it, and how many reads had begun then: where a later write isn't taken, this is what
   * shows, held until a read begun after it lands, never a read from before it. Null while it has taken none.
   */
  taken: { readonly setting: Setting; readonly after: number } | null
  /** Tells the latest change's caller it was taken back; an earlier one's says nothing, as a later one speaks for the model. */
  failed: () => void
}

interface Store {
  /* as last read */
  read: ReadonlyArray<AgentModels> | null
  /* as shown: as read, with the person's changes held over it */
  known: ReadonlyArray<AgentModels> | null
  /* how many reads have begun */
  begun: number
  readonly changes: Map<string, Change>
  reading: boolean
  /* asked for while a read was on its way: read again after it */
  again: boolean
  readonly listeners: Set<() => void>
}

const stores = new WeakMap<Client, Store>()

const storeOf = (client: Client): Store => {
  const found = stores.get(client)
  if (found !== undefined) return found
  const made: Store = {
    read: null,
    known: null,
    begun: 0,
    changes: new Map(),
    reading: false,
    again: false,
    listeners: new Set(),
  }
  stores.set(client, made)
  return made
}

/** Reads the models, unless a read is on its way; `again` reads once more after it, for something that changed since it began. */
const read = (client: Client, store: Store, again = false) => {
  if (store.reading) {
    store.again ||= again
    return
  }
  store.reading = true
  const begun = (store.begun += 1)
  const done = () => {
    store.reading = false
    if (!store.again) return false
    store.again = false
    read(client, store)
    return true
  }
  client.getModels().then(
    (known) => {
      store.read = known
      // A change this read began after the runtime took is in it: from here the read says.
      for (const [key, change] of store.changes) if (change.after !== null && begun > change.after) store.changes.delete(key)
      show(store)
      if (!done() && known.some((agent) => agent.probing) && store.listeners.size > 0) setTimeout(() => read(client, store), AGAIN)
    },
    // A picker without them offers each agent's own default.
    () => void done(),
  )
}

/** The models as read, with each change the person made that no read has confirmed yet held over them. */
const held = (read: ReadonlyArray<AgentModels>, changes: ReadonlyMap<string, Change>): ReadonlyArray<AgentModels> => {
  if (changes.size === 0) return read
  return read.map((offered) => {
    const mine = [...changes.values()].filter((change) => change.agentId === offered.agentId)
    if (mine.length === 0) return offered
    let { defaults, blocked } = offered
    for (const { model, wanted } of mine) {
      if (wanted.kind === 'effort') defaults = [...defaults.filter((one) => one.model !== model), { model, effort: wanted.effort }]
      else blocked = wanted.blocked ? (blocked.includes(model) ? blocked : [...blocked, model]) : blocked.filter((one) => one !== model)
    }
    return { ...offered, defaults, blocked }
  })
}

/* Shows what was read with the changes held over it, in every picker. */
const show = (store: Store) => {
  store.known = store.read === null ? null : held(store.read, store.changes)
  store.listeners.forEach((listener) => listener())
}

const keyOf = (agentId: string, model: string, kind: Setting['kind']) => JSON.stringify([agentId, model, kind])

const send = (client: Client, change: Change) =>
  change.wanted.kind === 'effort'
    ? client.setDefaultEffort({ agentId: change.agentId, model: change.model, effort: change.wanted.effort })
    : client.setModelBlocked({ agentId: change.agentId, model: change.model, blocked: change.wanted.blocked })

/* Writes what the person wants of one model's setting; once it is answered, a later change is written next. */
const write = (client: Client, store: Store, key: string, change: Change) => {
  const count = change.count
  const sent = change.wanted
  change.writing = true
  const answered = (taken: boolean) => {
    change.writing = false
    if (store.changes.get(key) !== change) return
    if (taken) change.taken = { setting: sent, after: store.begun }
    // Changed again while this was on its way: that one is written now, and it says how it ends.
    if (change.count !== count) return write(client, store, key, change)
    if (taken) change.after = store.begun
    else if (change.taken === null) {
      // Not taken, nor any before it: shown as last read.
      store.changes.delete(key)
      show(store)
    } else {
      // Not taken, but an earlier one was: that shows, until a read begun after it says, never a read from before it.
      change.wanted = change.taken.setting
      change.after = change.taken.after
      show(store)
    }
    // Either way the runtime's word is read afresh.
    read(client, store, true)
    if (!taken) change.failed()
  }
  send(client, change).then(
    () => answered(true),
    () => answered(false),
  )
}

/** Shows a change to one model's setting at once, in every picker, then writes it; `failed` is told if it isn't taken and was taken back. */
const change = (client: Client, agentId: string, model: string, wanted: Setting, failed: () => void) => {
  const store = storeOf(client)
  const key = keyOf(agentId, model, wanted.kind)
  const now = store.changes.get(key)
  if (now !== undefined) {
    // A later change speaks for this model from here.
    now.wanted = wanted
    now.count += 1
    now.after = null
    now.failed = failed
    show(store)
    if (!now.writing) write(client, store, key, now)
    return
  }
  const made: Change = { agentId, model, wanted, count: 0, writing: false, after: null, taken: null, failed }
  store.changes.set(key, made)
  show(store)
  write(client, store, key, made)
}

const quiet = () => undefined

/** Reads the models ahead, as the window opens, so the first picker shows them. */
export const readModelsAhead = (client: Client) => read(client, storeOf(client))

/** Reads the models again, after something that may change them, such as an agent found signed in or newly installed. */
export const readModelsAgain = (client: Client) => {
  const store = storeOf(client)
  if (store.reading || store.read !== null || store.listeners.size > 0) read(client, store, true)
}

/** Every agent's models, as far as they are known; null until first read. */
export const useModels = (): ReadonlyArray<AgentModels> | null => {
  const { client } = useServices()
  const store = storeOf(client)
  const subscribe = useCallback(
    (listener: () => void) => {
      store.listeners.add(listener)
      return () => void store.listeners.delete(listener)
    },
    [store],
  )
  const known = useSyncExternalStore(subscribe, () => store.known)
  useEffect(() => read(client, store), [client, store])
  return known
}

/** Sets the person's default effort for one of an agent's models: every picker shows it at once, and takes it back, telling `failed`, if it isn't set. */
export const useSetDefaultEffort = () => {
  const { client } = useServices()
  return useCallback(
    (input: { readonly agentId: string; readonly model: string; readonly effort: string }, failed: () => void = quiet) =>
      change(client, input.agentId, input.model, { kind: 'effort', effort: input.effort }, failed),
    [client],
  )
}

/** Switches one of an agent's models off, or on again: every picker and plan leaves it out or offers it at once, and takes it back, telling `failed`, if it isn't switched. */
export const useSetModelBlocked = () => {
  const { client } = useServices()
  return useCallback(
    (input: { readonly agentId: string; readonly model: string; readonly blocked: boolean }, failed: () => void = quiet) =>
      change(client, input.agentId, input.model, { kind: 'blocked', blocked: input.blocked }, failed),
    [client],
  )
}
