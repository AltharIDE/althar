import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import type {
  AppSettings,
  AutomationDefinition,
  AutomationSnapshot,
  AutomationsSnapshot,
  AutomationStep,
  AutomationView,
} from '@althar/contracts'
import { AUTOMATION_DEFAULTS } from '@althar/contracts'

import { messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { FIRST_SCHEDULE, needsYou } from './words'

/*
 * A project's automations, as its Automations tab shows them, and one, as
 * its own page does: read from the window's cache, read again as the feed
 * says they changed. What the person does shows at once (turned on or
 * paused, changed, its reviews posting themselves, all of them paused), and
 * gives way to what the runtime kept once it is read again; what it couldn't
 * keep is said, and what it kept is read. A new one is a draft in the window
 * until it is made, turned on or tried once.
 */

/** What went wrong, said where it was done. */
const failed = (failure: unknown) => messageOf(failure)

export interface AutomationsModel {
  /** Null until it is read. */
  readonly snapshot: AutomationsSnapshot | null
  readonly error: string | null
  /** One of them paused itself: the violet dot on the tab. */
  readonly needsYou: boolean
  /** Pauses every automation, or lets them run again. */
  readonly setAllPaused: (paused: boolean) => void
}

export const useAutomations = (projectId: string): AutomationsModel => {
  const { client, cache } = useServices()
  // A project not known yet has none to read.
  const read = useQuery({ ...reads(client).automations(projectId), enabled: projectId !== '' })
  const [error, setError] = useState<string | null>(null)
  const snapshot = read.data ?? null
  const setAllPaused = useCallback(
    (paused: boolean) => {
      setError(null)
      cache.setQueryData<AutomationsSnapshot>(keys.automations(projectId), (was) =>
        was === undefined ? was : { ...was, allPaused: paused },
      )
      cache.setQueryData<AppSettings>(keys.settings, (was) => (was === undefined ? was : { ...was, automationsPaused: paused }))
      client.setAutomationsPaused(paused).then(
        () => void cache.invalidateQueries({ queryKey: ['automation'] }),
        (failure: unknown) => {
          setError(failed(failure))
          void cache.invalidateQueries({ queryKey: keys.automations(projectId) })
          void cache.invalidateQueries({ queryKey: keys.settings })
        },
      )
    },
    [cache, client, projectId],
  )
  return {
    snapshot,
    error: error ?? (read.error === null ? null : failed(read.error)),
    needsYou: snapshot !== null && needsYou(snapshot.automations),
    setAllPaused,
  }
}

export interface AutomationModel {
  /** Null until it is read. */
  readonly view: AutomationView | null
  readonly error: string | null
  /** Something asked of it is on its way. */
  readonly pending: boolean
  /** The whole of what it is, changed: its name, prompt, schedule, lead, work or limits. */
  readonly change: (definition: AutomationDefinition) => void
  readonly turnOn: () => void
  readonly pause: () => void
  readonly runNow: () => void
  /** Deleted: whether it went. */
  readonly remove: () => Promise<boolean>
  readonly setPostsReviews: (on: boolean) => void
}

export const useAutomation = (automationId: string): AutomationModel => {
  const { client, cache } = useServices()
  const read = useQuery(reads(client).automation(automationId))
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // Changes in the order they were made: only the latest failing reads again.
  const made = useRef(0)
  const view = read.data?.automation ?? null

  /** Shows a change at once, as the window keeps the automation. */
  const shown = useCallback(
    (change: (view: AutomationView) => AutomationView) => {
      cache.setQueryData<AutomationSnapshot>(keys.automation(automationId), (was) =>
        was === undefined ? was : { ...was, automation: change(was.automation) },
      )
    },
    [cache, automationId],
  )

  /**
   * Sends it. What it changes is read again as the feed says it changed; one
   * that couldn't be done, and is still the latest, says why, and reads again
   * what the runtime kept: the page and the tab.
   */
  const send = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      const at = ++made.current
      setError(null)
      setPending(true)
      try {
        await action()
        return true
      } catch (failure) {
        if (at !== made.current) return false
        setError(failed(failure))
        const projectId = cache.getQueryData<AutomationSnapshot>(keys.automation(automationId))?.automation.projectId
        void cache.invalidateQueries({ queryKey: keys.automation(automationId) })
        if (projectId !== undefined) void cache.invalidateQueries({ queryKey: keys.automations(projectId) })
        return false
      } finally {
        if (at === made.current) setPending(false)
      }
    },
    [cache, automationId],
  )

  return {
    view,
    error: error ?? (read.error === null ? null : failed(read.error)),
    pending,
    change: (definition) => {
      shown((was) => ({
        ...was,
        definition,
        name: definition.name,
        prompt: definition.prompt,
        schedule: definition.schedule,
        work: definition.work.kind,
      }))
      void send(() => client.changeAutomation(automationId, definition))
    },
    turnOn: () => {
      shown((was) => ({ ...was, state: 'on', pausedBy: null, pauseReason: null }))
      void send(() => client.turnOnAutomation(automationId))
    },
    pause: () => {
      shown((was) => ({ ...was, state: 'paused', pausedBy: 'person', pauseReason: null, nextAt: null }))
      void send(() => client.pauseAutomation(automationId))
    },
    runNow: () => void send(() => client.runAutomationNow(automationId)),
    remove: () => send(() => client.deleteAutomation(automationId)),
    setPostsReviews: (on) => {
      shown((was) => ({ ...was, postsReviews: on }))
      void send(() => client.setAutomationPostsReviews(automationId, on))
    },
  }
}

/** What a new automation starts as: blank, the person's usual lead, every weekday at 9:00, its task ending on this computer, with every limit's default. */
export const blankDefinition = (
  lead: AutomationStep,
  zone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): AutomationDefinition => ({
  name: '',
  prompt: '',
  schedule: FIRST_SCHEDULE,
  zone,
  lead,
  work: { kind: 'task', review: null, end: null },
  ...AUTOMATION_DEFAULTS,
})

export interface NewAutomationModel {
  readonly definition: AutomationDefinition
  readonly change: (definition: AutomationDefinition) => void
  readonly error: string | null
  readonly pending: boolean
  /** Makes it, on; its id once made, null where it couldn't be. */
  readonly turnOn: () => Promise<string | null>
  /** Makes it, proposed, and runs it once now, as it would run; its id once made. */
  readonly tryOnce: () => Promise<string | null>
}

export const useNewAutomation = (projectId: string, lead: AutomationStep): NewAutomationModel => {
  const { client, cache } = useServices()
  const [definition, setDefinition] = useState(() => blankDefinition(lead))
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const make = async (on: boolean, then?: (id: string) => Promise<void>): Promise<string | null> => {
    setError(null)
    setPending(true)
    let made: string | null = null
    try {
      made = await client.makeAutomation({ projectId, definition: { ...definition, name: definition.name.trim() }, on })
      await then?.(made)
      return made
    } catch (failure) {
      setError(failed(failure))
      return made
    } finally {
      setPending(false)
      void cache.invalidateQueries({ queryKey: keys.automations(projectId) })
    }
  }
  return {
    definition,
    change: setDefinition,
    error,
    pending,
    turnOn: () => make(true),
    tryOnce: () => make(false, (id) => client.runAutomationNow(id)),
  }
}

/** What the person does to an automation from its card in the coordinator's thread, each by the card's item where it asks. */
export interface AutomationActions {
  readonly turnOn: (automationId: string, itemId?: string) => Promise<void>
  readonly pause: (automationId: string) => Promise<void>
  readonly runNow: (automationId: string, itemId?: string) => Promise<void>
  readonly undo: (itemId: string) => Promise<void>
  readonly change: (automationId: string, definition: AutomationDefinition) => Promise<void>
}

/** The actions, reading again the automations they move once done: the thread's card reads itself again as the feed says. */
export const useAutomationActions = (projectId: string): AutomationActions => {
  const { client, cache } = useServices()
  const then = (automationId?: string) => {
    void cache.invalidateQueries({ queryKey: keys.automations(projectId) })
    if (automationId !== undefined) void cache.invalidateQueries({ queryKey: keys.automation(automationId) })
  }
  return {
    turnOn: (automationId, itemId) => client.turnOnAutomation(automationId, itemId).finally(() => then(automationId)),
    pause: (automationId) => client.pauseAutomation(automationId).finally(() => then(automationId)),
    runNow: (automationId, itemId) => client.runAutomationNow(automationId, itemId).finally(() => then(automationId)),
    undo: (itemId) => client.undoAutomationChange(itemId).finally(() => then()),
    change: (automationId, definition) => client.changeAutomation(automationId, definition).finally(() => then(automationId)),
  }
}
