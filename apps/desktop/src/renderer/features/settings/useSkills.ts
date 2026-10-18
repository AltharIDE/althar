import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import type { InstalledSkill, SkillList, SkillReviewCard, SkillsFound, SkillUpdate } from '@althar/contracts'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * The skills page's model: the store as the runtime keeps it, and the one
 * review open at a time, of a skill to install from GitHub or an update to
 * one installed. A switch shows at once and reads the store again if it
 * isn't kept; everything else waits on the runtime and says in words what
 * it couldn't do. An update check only runs when the person asks.
 */

export interface SkillsModel {
  readonly list: SkillList | undefined
  readonly loadFailed: boolean
  readonly found: SkillsFound | null
  readonly card: SkillReviewCard | null
  readonly updates: ReadonlyArray<SkillUpdate> | null
  readonly busy: boolean
  readonly error: string | null
  readonly find: (source: string) => void
  readonly review: (subpath: string) => void
  /** Opens a newer version's card from the update check. */
  readonly reviewUpdate: (card: SkillReviewCard) => void
  readonly install: (replace: boolean) => void
  readonly cancel: () => void
  readonly checkUpdates: () => void
  readonly toggle: (id: string, on: boolean) => void
  readonly rollBack: (id: string) => void
  readonly remove: (id: string) => void
}

const said = (error: unknown) => (error instanceof Error ? error.message : String(error))

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

  return {
    list: query.data,
    loadFailed: query.isError,
    found,
    card,
    updates,
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
    reviewUpdate: (update) => {
      setError(null)
      setCard(update)
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
