import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { AfterMergeRule, ProjectInk, ProjectList, ProjectNote, ProjectRulesView, ProjectSummary, WorksIn } from '@althar/contracts'

import { canCall, messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * A project's settings' view model: its name and ink, changed in place, its
 * rules, whether its leads resolve conflicts and its tasks move their issues
 * along, whether skill and OpenSpec files a task commits may stay in
 * its repositories and be pushed, the notes its coordinator keeps, and
 * removing it. A new name or ink shows at once, and goes to the runtime one change
 * after another; the tabs and the home hear it through the change feed, and
 * the projects are read again at once too, so it shows everywhere before the
 * feed is heard. One that didn't hold goes back, and says why. So do the
 * switches, each a rule saved as the rules screen saves one, and a note
 * dropped or said in other words, which goes at once. Removing it from
 * Althar is asked in a dialog first.
 */

/** A rule the settings switch in place. */
export type RuleSwitch = 'resolveConflicts' | 'pushCommits' | 'postScreenshots' | 'moveIssues' | 'linkIssues' | 'repositoryFiles'
/** A rule set from General: one of its switches, where new tasks start (ADR-091), what an explicitly requested review after merge brings back, or the review bots its leads hear. */
export type GeneralRule = RuleSwitch | 'worksIn' | 'afterMergeReview' | 'trustedBots'

/** One of the three permissions for skill and OpenSpec files in its repositories. */
export type RepositoryFile = keyof ProjectRulesView['repositoryFiles']

export interface ProjectSettingsModel {
  readonly project: ProjectSummary | null
  /** Its name and ink as the person last chose them, before the runtime has said so. */
  readonly name: string | null
  readonly ink: ProjectInk | null
  /** The other projects' names, by the ink each has. */
  readonly taken: Partial<Record<ProjectInk, string>>
  readonly rename: (name: string) => void
  readonly setInk: (ink: ProjectInk) => void
  /** Why the last new name or ink didn't hold. */
  readonly failed: string | null
  readonly rules: ProjectRulesView | null
  /** The decisions its coordinator keeps, oldest first (ADR-031). */
  readonly notes: ReadonlyArray<ProjectNote> | null
  readonly dropNote: (noteId: string) => Promise<void>
  /** Says a note in the person's words: shown at once, and back as it was, saying why, where that didn't hold. */
  readonly editNote: (noteId: string, body: string) => Promise<void>
  /** Why the last note dropped is still there, or the last one changed says what it did. */
  readonly noteFailed: string | null
  /** Turns on or off the project's leads resolving conflicts on their own (ADR-030). */
  readonly setResolveConflicts: (on: boolean) => void
  /** Turns on or off the project's leads' commits going up on their own as each turn ends (ADR-072). */
  readonly setPushCommits: (on: boolean) => void
  /** Turns on or off a task's screenshots going up to its pull request on their own, kept as Outputs shows them (ADR-077). */
  readonly setPostScreenshots: (on: boolean) => void
  /** Whether its leads hear a bot, by its account (code-hosts § Review and triage bots): trusted, or not. */
  readonly setTrustsBot: (login: string, on: boolean) => void
  /** Looks at each open task now for a conflict with its default branch, under the project's rules (ADR-030). */
  readonly lookForConflicts: () => void
  /** Since it was last asked: looking (`asked`), or why it couldn't. */
  readonly looked: 'asked' | { readonly failed: string } | null
  /** Moves a task's issue along with it: to In Progress as it starts, In Review and Done with its pull request. */
  readonly setMoveIssues: (on: boolean) => void
  /** Links a task's pull request on its issue as it opens: on ClickUp, by a comment on the task. */
  readonly setLinkIssues: (on: boolean) => void
  /** Allows or holds back skill or OpenSpec files in a task's commits, or pushing them: each a new revision of its rules. */
  readonly setRepositoryFile: (file: RepositoryFile, on: boolean) => void
  /** Where new tasks start: Local, in the person's checkout, or a worktree of their own (ADR-091). */
  readonly setWorksIn: (worksIn: WorksIn) => void
  /** What an explicitly requested review after merge brings back: only major findings, every one, or no review. */
  readonly setAfterMergeReview: (rule: AfterMergeRule) => void
  /** Which rule didn't hold, and why. */
  readonly ruleFailed: { readonly rule: GeneralRule; readonly message: string } | null
  /** Asking whether to remove it from Althar. */
  readonly removing: boolean
  readonly askRemove: () => void
  readonly closeRemove: () => void
  /** The removal is on its way. */
  readonly busy: boolean
  /** Why it couldn't be removed. */
  readonly error: string | null
  /** Removes the project; `onRemoved` is called once it is gone, from here or from another window. */
  readonly remove: () => Promise<void>
}

/** A rule the person switched, held over what is read: which change it was, and the revision its reply kept it as, once it came. */
interface HeldRule {
  readonly value: unknown
  readonly change: number
  readonly revision: number | null
}

/** A name or ink the person chose, and which change it was, in the order they were made. */
interface Chosen {
  readonly name?: { readonly value: string; readonly change: number }
  readonly ink?: { readonly value: ProjectInk; readonly change: number }
}

/** No ink taken by another project. */
const NONE_TAKEN: Partial<Record<ProjectInk, string>> = {}

/** What a project's settings read of the projects: itself, and which inks the others took, by the first to take each. */
const settingsOf = (list: ProjectList, projectId: string) => {
  const taken: Partial<Record<ProjectInk, string>> = {}
  for (const other of list.projects) if (other.id !== projectId && taken[other.ink] === undefined) taken[other.ink] = other.name
  return { project: list.projects.find((each) => each.id === projectId) ?? null, taken }
}

export const useProjectSettings = (projectId: string, onRemoved: () => void): ProjectSettingsModel => {
  const { client, cache } = useServices()
  const read = reads(client)
  // Only what the settings say of the list, this project and the inks others took: another's change of name draws nothing here.
  const listed = useQuery({ ...read.projects(), select: useCallback((list: ProjectList) => settingsOf(list, projectId), [projectId]) }).data
  const project = listed?.project ?? null
  // What a home keeps from this window isn't asked of it: its sections say so instead.
  const rulesRead = useQuery({ ...read.rules(projectId), enabled: canCall(client, 'GetProjectRules') })
  const notes = useQuery({ ...read.notes(projectId), enabled: canCall(client, 'GetProjectNotes') }).data ?? null

  // What the person chose, shown until the runtime says the same or says no.
  const [chosen, setChosen] = useState<Chosen>({})
  const [failed, setFailed] = useState<{ readonly message: string; readonly change: number } | null>(null)
  // One change after another, in the order they were made, so the last one chosen is the one kept.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const made = useRef(0)

  const change = useCallback(
    <K extends keyof Chosen>(field: K, value: NonNullable<Chosen[K]>['value'], send: () => Promise<void>) => {
      const mine = ++made.current
      setChosen((was) => ({ ...was, [field]: { value, change: mine } }))
      const done = (failure: string | null) => {
        // Only this change's own choice goes, to the runtime's word or back: a later one of the same thing stays shown.
        setChosen((was) => (was[field]?.change === mine ? { ...was, [field]: undefined } : was))
        // A failure is said until a later change holds.
        setFailed((was) => (failure !== null ? { message: failure, change: mine } : was !== null && was.change < mine ? null : was))
      }
      queue.current = queue.current.then(async () => {
        try {
          await send()
          await cache.refetchQueries({ queryKey: keys.projects })
          done(null)
        } catch (failure) {
          done(messageOf(failure))
        }
      })
    },
    [cache],
  )

  const rename = useCallback(
    (name: string) => change('name', name, () => client.renameProject(projectId, name)),
    [change, client, projectId],
  )
  const setInk = useCallback(
    (ink: ProjectInk) => change('ink', ink, () => client.setProjectInk(projectId, ink)),
    [change, client, projectId],
  )

  // Shown switched at once; the rules as kept once saved, or as they were, with why, when it isn't.
  const [ruleFailed, setRuleFailed] = useState<{ readonly rule: GeneralRule; readonly message: string } | null>(null)
  // Each switched, held over what is read until a read of the rules has it, by its own change: one switched a moment after
  // another never flicks back as the first's reply, or a read from between them, lands (foundations.md, The UI is instant).
  const [switched, setSwitched] = useState<ReadonlyMap<GeneralRule, HeldRule>>(new Map())
  const switchedNow = useRef(switched)
  // Read by a press, not in render: what is held as of the last render.
  useEffect(() => {
    switchedNow.current = switched
  })
  const ruleMade = useRef(0)
  const readRules = rulesRead.data
  // A read that has a switch's own revision says it from here.
  if (readRules !== undefined && [...switched.values()].some((one) => one.revision !== null && readRules.revision >= one.revision))
    setSwitched((now) => new Map([...now].filter(([, one]) => one.revision === null || readRules.revision < one.revision)))
  const rules = useMemo(
    () =>
      readRules === undefined
        ? null
        : switched.size === 0
          ? readRules
          : { ...readRules, ...Object.fromEntries([...switched].map(([rule, one]) => [rule, one.value])) },
    [readRules, switched],
  )
  const setRule = useCallback(
    <R extends GeneralRule>(rule: R, value: ProjectRulesView[R]) => {
      const key = keys.rules(projectId)
      const mine = ++ruleMade.current
      setRuleFailed(null)
      setSwitched((now) => new Map([...now, [rule, { value, change: mine, revision: null }]]))
      cache.setQueryData<ProjectRulesView>(key, (now) => (now === undefined ? now : { ...now, [rule]: value }))
      const own = (change: (one: HeldRule) => HeldRule | null) =>
        setSwitched((now) => {
          const one = now.get(rule)
          if (one?.change !== mine) return now
          const next = new Map(now)
          const changed = change(one)
          if (changed === null) next.delete(rule)
          else next.set(rule, changed)
          return next
        })
      queue.current = queue.current.then(async () => {
        try {
          const kept = await client.setProjectRules({ projectId, [rule]: value })
          // Held until a read has this revision; the reply is that read only where no switch was made since, whose own is newer.
          own((one) => ({ ...one, revision: kept.revision }))
          if (mine === ruleMade.current) cache.setQueryData(key, kept)
        } catch (failure) {
          own(() => null)
          setRuleFailed({ rule, message: messageOf(failure) })
          await cache.invalidateQueries({ queryKey: key, exact: true })
        }
      })
    },
    [cache, client, projectId],
  )
  const setResolveConflicts = useCallback((on: boolean) => setRule('resolveConflicts', on), [setRule])
  const [looked, setLooked] = useState<ProjectSettingsModel['looked']>(null)
  const lookForConflicts = useCallback(() => {
    setLooked('asked')
    client.lookForConflicts(projectId).catch((failure: unknown) => setLooked({ failed: messageOf(failure) }))
  }, [client, projectId])
  const setPushCommits = useCallback((on: boolean) => setRule('pushCommits', on), [setRule])
  const setPostScreenshots = useCallback((on: boolean) => setRule('postScreenshots', on), [setRule])
  // The list goes whole, as last shown with this bot switched; a bot untrusted stays suggested, to trust again.
  const setTrustsBot = useCallback(
    (login: string, on: boolean) => {
      const key = keys.rules(projectId)
      const now = cache.getQueryData<ProjectRulesView>(key)
      if (now === undefined) return
      const bot = [...now.trustedBots, ...now.suggestedBots].find((one) => one.login === login) ?? { login, name: login }
      const trustedBots = on
        ? [...now.trustedBots.filter((one) => one.login !== login), bot]
        : now.trustedBots.filter((one) => one.login !== login)
      const suggestedBots = on ? now.suggestedBots.filter((one) => one.login !== login) : [bot, ...now.suggestedBots]
      setRuleFailed(null)
      cache.setQueryData<ProjectRulesView>(key, { ...now, trustedBots, suggestedBots })
      queue.current = queue.current.then(async () => {
        try {
          cache.setQueryData(key, await client.setProjectRules({ projectId, trustedBots: trustedBots.map((one) => one.login) }))
        } catch (failure) {
          setRuleFailed({ rule: 'trustedBots', message: messageOf(failure) })
          await cache.invalidateQueries({ queryKey: key, exact: true })
        }
      })
    },
    [cache, client, projectId],
  )
  const setMoveIssues = useCallback((on: boolean) => setRule('moveIssues', on), [setRule])
  const setLinkIssues = useCallback((on: boolean) => setRule('linkIssues', on), [setRule])
  // The three are one rule: each switch sends all three, the one switched as now chosen, the others as last shown.
  const setRepositoryFile = useCallback(
    (file: RepositoryFile, on: boolean) => {
      const now =
        (switchedNow.current.get('repositoryFiles')?.value as ProjectRulesView['repositoryFiles'] | undefined) ??
        cache.getQueryData<ProjectRulesView>(keys.rules(projectId))?.repositoryFiles
      if (now !== undefined) setRule('repositoryFiles', { ...now, [file]: on })
    },
    [cache, projectId, setRule],
  )
  const setWorksIn = useCallback((worksIn: WorksIn) => setRule('worksIn', worksIn), [setRule])
  const setAfterMergeReview = useCallback((rule: AfterMergeRule) => setRule('afterMergeReview', rule), [setRule])

  const taken = listed?.taken ?? NONE_TAKEN

  const [noteFailed, setNoteFailed] = useState<string | null>(null)
  const dropNote = useCallback(
    async (noteId: string) => {
      setNoteFailed(null)
      cache.setQueryData<ReadonlyArray<ProjectNote>>(keys.notes(projectId), (was) => was?.filter((note) => note.id !== noteId))
      try {
        await client.dropProjectNote(projectId, noteId)
      } catch (failure) {
        setNoteFailed(messageOf(failure))
      }
      await cache.invalidateQueries({ queryKey: keys.notes(projectId) })
    },
    [cache, client, projectId],
  )
  const editNote = useCallback(
    async (noteId: string, body: string) => {
      setNoteFailed(null)
      cache.setQueryData<ReadonlyArray<ProjectNote>>(keys.notes(projectId), (was) =>
        was?.map((note) => (note.id === noteId ? { ...note, body } : note)),
      )
      try {
        await client.editProjectNote(projectId, noteId, body)
      } catch (failure) {
        setNoteFailed(messageOf(failure))
      }
      await cache.invalidateQueries({ queryKey: keys.notes(projectId) })
    },
    [cache, client, projectId],
  )

  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const askRemove = useCallback(() => {
    setError(null)
    setRemoving(true)
  }, [])
  const closeRemove = useCallback(() => {
    setError(null)
    setRemoving(false)
  }, [])
  // Once it is read again without it, the watch below sends the window on.
  const remove = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await client.removeProject(projectId)
      await cache.refetchQueries({ queryKey: keys.projects })
      setRemoving(false)
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }, [cache, client, projectId])

  useWhenRemoved(projectId, onRemoved)

  return {
    project,
    name: chosen.name?.value ?? project?.name ?? null,
    ink: chosen.ink?.value ?? project?.ink ?? null,
    taken,
    rename,
    setInk,
    failed: failed?.message ?? null,
    rules,
    notes,
    dropNote,
    editNote,
    noteFailed,
    setResolveConflicts,
    setPushCommits,
    setPostScreenshots,
    setTrustsBot,
    lookForConflicts,
    looked,
    setMoveIssues,
    setLinkIssues,
    setRepositoryFile,
    setWorksIn,
    setAfterMergeReview,
    ruleFailed,
    removing,
    askRemove,
    closeRemove,
    busy,
    error,
    remove,
  }
}

/**
 * Removed from another window, or by this one: once listed and then gone, the
 * window goes where `onRemoved` says, from the project or one of its tasks.
 */
export const useWhenRemoved = (projectId: string | undefined, onRemoved: () => void) => {
  const { client } = useServices()
  // Only whether it is listed: another project's change draws nothing here. Undefined until the list is read.
  const there = useQuery({
    ...reads(client).projects(),
    select: useCallback((list: ProjectList) => projectId !== undefined && list.projects.some((each) => each.id === projectId), [projectId]),
  }).data
  const seen = useRef(false)
  useEffect(() => {
    if (there === true) seen.current = true
    else if (seen.current && there === false) {
      seen.current = false
      onRemoved()
    }
  }, [there, onRemoved])
}
