import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { InstalledSkill, SkillList, SkillReviewCard, SkillsFound, SkillUpdate } from '@althar/contracts'
import type { SkillReviewModel } from '@althar/ui'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { text } from './text'

/*
 * The skills page's model: the store as the runtime keeps it, read before
 * the page shows (the settings route's loader) and read again as the feed
 * says a skill changed, in this window or another; and the one review open
 * at a time, of a skill to install from GitHub or an update to one
 * installed. It says, for each card, whether installing it updates the
 * version installed or replaces one of the same name from elsewhere.
 * Everything waits on the runtime and says in words what it couldn't do. A
 * newer version of one from GitHub is looked for quietly as the skills open,
 * and shows as Update ready where there is one.
 */

/** An update the check couldn't look for, and why. */
export interface SkillUnchecked {
  readonly id: string
  readonly error: string
}

export interface SkillsModel {
  /** Whether the store has been read. */
  readonly loaded: boolean
  /** Whether Althar has skills to give at all; when it hasn't, the page says so and nothing else. */
  readonly enabled: boolean
  readonly loadFailed: boolean
  /** Reads the store again. */
  readonly reload: () => void
  readonly found: SkillsFound | null
  /** The card open for review, as it shows: whether installing it updates or replaces what is installed. */
  readonly card: SkillReviewModel | null
  /** Whether an update check has come back. */
  readonly checked: boolean
  /** The skills from GitHub with a newer version to review. */
  readonly available: ReadonlyArray<string>
  readonly unchecked: ReadonlyArray<SkillUnchecked>
  readonly busy: boolean
  readonly error: string | null
  readonly find: (source: string) => void
  readonly review: (subpath: string) => void
  /** Opens the newer version's card the update check found for a skill. */
  readonly reviewUpdate: (id: string) => void
  readonly install: (replace: boolean) => void
  readonly cancel: () => void
  /** How many times a skill has been added or updated while this view is open: a dialog that was adding shuts when it goes up. */
  readonly added: number
  readonly checkUpdates: () => void
  readonly rollBack: (id: string) => void
  readonly remove: (id: string) => void
}

const said = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Where an install is from, as the person reads it. */
const fromOf = (skill: { readonly source: InstalledSkill['source']; readonly repo?: string | null | undefined }) =>
  skill.source === 'github' ? (skill.repo ?? 'GitHub') : text.skillsFromFolder

/**
 * A card as the review shows it. From the same folder of the same repository
 * as the one installed it is an update, as approving it takes it
 * (packages/skills' approve); from anywhere else it replaces the one of the
 * same name, and says where that one is from.
 */
export const reviewOf = (card: SkillReviewCard): SkillReviewModel => {
  const { installed } = card
  const update =
    installed !== null && installed.source === 'github' && installed.repo === card.source.repo && installed.subpath === card.source.subpath
  return {
    id: card.id,
    ...card.source,
    license: card.license,
    description: card.description,
    instructions: card.instructions,
    files: card.files,
    findings: card.findings,
    installable: card.installable,
    replaces: installed === null || update ? null : fromOf(installed),
    update,
    changes: card.changes,
  }
}

export const useSkills = (options: { readonly check?: boolean } = {}): SkillsModel => {
  const { client, cache } = useServices()
  const query = useQuery(reads(client).skills())
  const [found, setFound] = useState<SkillsFound | null>(null)
  const [card, setCard] = useState<SkillReviewCard | null>(null)
  const [updates, setUpdates] = useState<ReadonlyArray<SkillUpdate> | null>(null)
  const [busy, setBusy] = useState(false)
  const [addedCount, setAdded] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const reread = useCallback(() => void cache.refetchQueries({ queryKey: keys.skills }), [cache])
  // Asked quietly as the skills open: what GitHub says shows as Update ready; nothing says where it couldn't be asked.
  const checked = useRef<number | null>(null)
  const fromGitHub = query.data?.skills.some((skill) => skill.source === 'github') === true
  useEffect(() => {
    if (options.check !== true || !fromGitHub || checked.current !== null) return
    checked.current = Date.now()
    client.checkSkillUpdates().then(setUpdates, () => undefined)
  }, [fromGitHub, client, options.check])
  const run = useCallback(<A>(work: () => Promise<A>, then: (value: A) => void) => {
    setBusy(true)
    setError(null)
    work().then(
      (value) => {
        setBusy(false)
        then(value)
      },
      (failure: unknown) => {
        setBusy(false)
        setError(said(failure))
      },
    )
  }, [])
  const kept = useCallback(
    (skill: InstalledSkill) =>
      cache.setQueryData<SkillList>(keys.skills, (was) =>
        was === undefined ? was : { ...was, skills: was.skills.map((one) => (one.id === skill.id ? skill : one)) },
      ),
    [cache],
  )

  const available = (updates ?? []).flatMap((update) => (update.state === 'available' ? [update] : []))
  return {
    loaded: query.data !== undefined,
    enabled: query.data?.enabled ?? false,
    loadFailed: query.isError,
    reload: reread,
    found,
    card: card === null ? null : reviewOf(card),
    checked: updates !== null,
    available: available.map((update) => update.id),
    unchecked: (updates ?? []).flatMap((update) => (update.state === 'failed' ? [{ id: update.id, error: update.error }] : [])),
    busy,
    error,
    find: (source) =>
      run(
        () => client.findSkills({ source }),
        (value) => {
          setFound(value)
          setCard(null)
        },
      ),
    review: (subpath) => {
      if (found === null) return
      run(() => client.stageSkill({ repo: found.repo, ref: found.ref, subpath }), setCard)
    },
    reviewUpdate: (id) => {
      const update = available.find((one) => one.id === id)
      if (update === undefined) return
      setError(null)
      setCard(update.card)
    },
    install: (replace) => {
      if (card === null) return
      run(
        () => client.approveSkill(card, replace),
        () => {
          setCard(null)
          setFound(null)
          setAdded((count) => count + 1)
          setUpdates((now) => now?.filter((update) => update.id !== card.id) ?? null)
          reread()
        },
      )
    },
    cancel: () => {
      setCard(null)
      setError(null)
    },
    added: addedCount,
    checkUpdates: () => run(() => client.checkSkillUpdates(), setUpdates),
    rollBack: (id) => run(() => client.rollBackSkill(id), kept),
    remove: (id) => run(() => client.uninstallSkill(id), reread),
  }
}
