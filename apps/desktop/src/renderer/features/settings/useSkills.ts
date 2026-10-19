import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import type { InstalledSkill, SkillList, SkillReviewCard, SkillsFound, SkillUpdate } from '@althar/contracts'
import type { SkillReviewModel, SkillRowModel } from '@althar/ui'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { text } from './text'

/*
 * The skills page's model: the store as the runtime keeps it, read before
 * the page shows (the settings route's loader) and read again as the feed
 * says a skill changed, in this window or another; and the one review open
 * at a time, of a skill to install from GitHub or an update to one
 * installed. It says, for each card, whether installing it updates the
 * version installed or replaces one of the same name from elsewhere. A
 * switch shows at once and reads the store again if it isn't kept;
 * everything else waits on the runtime and says in words what it couldn't
 * do. An update check only runs when the person asks.
 */

/** An update the check couldn't look for, and why. */
export interface SkillUnchecked {
  readonly id: string
  readonly error: string
}

export interface SkillsModel {
  /** Every skill as its row shows it; undefined until the store is read. */
  readonly rows: ReadonlyArray<SkillRowModel> | undefined
  /** Whether Althar has skills to give at all; when it hasn't, the page says so and nothing else. */
  readonly enabled: boolean
  /** Which revision of Althar's own catalog is installed, where there is one. */
  readonly catalogRevision: string | null
  readonly loadFailed: boolean
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
  readonly checkUpdates: () => void
  readonly toggle: (id: string, on: boolean) => void
  readonly rollBack: (id: string) => void
  readonly remove: (id: string) => void
}

const said = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Where an install is from, as the person reads it. */
const fromOf = (skill: { readonly source: InstalledSkill['source']; readonly repo?: string | null | undefined }) =>
  skill.source === 'althar-default' ? text.skillsFromAlthar : skill.source === 'github' ? (skill.repo ?? 'GitHub') : text.skillsFromFolder

export const rowOf = (skill: InstalledSkill): SkillRowModel => ({
  id: skill.id,
  description: skill.description,
  from: fromOf(skill),
  on: skill.active,
  needsSubagents: skill.needs.includes('subagents'),
  canRollBack: skill.canRollBack,
  removable: skill.source !== 'althar-default',
  problem: skill.problem,
})

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

export const useSkills = (): SkillsModel => {
  const { client, cache } = useServices()
  const query = useQuery(reads(client).skills())
  const [found, setFound] = useState<SkillsFound | null>(null)
  const [card, setCard] = useState<SkillReviewCard | null>(null)
  const [updates, setUpdates] = useState<ReadonlyArray<SkillUpdate> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reread = useCallback(() => void cache.refetchQueries({ queryKey: keys.skills }), [cache])
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
    rows: query.data?.skills.map(rowOf),
    enabled: query.data?.enabled ?? false,
    catalogRevision: query.data?.catalogRevision ?? null,
    loadFailed: query.isError,
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
          setUpdates((now) => now?.filter((update) => update.id !== card.id) ?? null)
          reread()
        },
      )
    },
    cancel: () => {
      setCard(null)
      setError(null)
    },
    checkUpdates: () => run(() => client.checkSkillUpdates(), setUpdates),
    toggle: (id, on) => {
      cache.setQueryData<SkillList>(keys.skills, (was) =>
        was === undefined ? was : { ...was, skills: was.skills.map((one) => (one.id === id ? { ...one, active: on } : one)) },
      )
      client.setSkillActive(id, on).then(kept, (failure: unknown) => {
        setError(said(failure))
        reread()
      })
    },
    rollBack: (id) => run(() => client.rollBackSkill(id), kept),
    remove: (id) => run(() => client.uninstallSkill(id), reread),
  }
}
