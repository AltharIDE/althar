import type { BroughtIn, Elsewhere, PlanStep } from '@althar/contracts'
import { useEffect, useMemo, useState } from 'react'

import type { Client } from '../../data/client'
import { picked, picksOf, tilesOf, words } from './tiles'

/*
 * What other tools left, for a project's welcome step or a new project's tab: read once as it opens (by the project, or
 * by the folders chosen before it is made), picked on the tiles, and brought in by the project once it is made. Nothing
 * is taken at first: a press takes a whole tool. Bringing in goes out at once and the window moves on; the board shows
 * what came in as it comes (the UI is instant).
 */

export interface ElsewhereModel {
  /** What was found; null while it is read, and where nothing could be. */
  readonly found: Elsewhere | null
  readonly tiles: ReturnType<typeof tilesOf>
  readonly picked: ReadonlySet<string>
  readonly onPick: (keys: ReadonlyArray<string>, on: boolean) => void
  /** What the main button says: what bringing in would bring, counted; null with nothing picked. */
  readonly go: string | null
  /** Brings in what was picked, into the project; nothing where nothing was. */
  readonly bring: (projectId: string, steps?: ReadonlyArray<PlanStep>) => Promise<BroughtIn | null>
  /** Reads a project now, as it is made, for a step that must know before it shows whether anything was found. */
  readonly load: (projectId: string) => Promise<Elsewhere>
}

const NONE: Elsewhere = { worktrees: [], setups: [], conversations: [] }

/** Several reads (a new project's folders), as one: what two of them found is found once. */
export const merged = (all: ReadonlyArray<Elsewhere>): Elsewhere => {
  const once = <A extends { readonly key: string }>(items: ReadonlyArray<A>) => [...new Map(items.map((one) => [one.key, one])).values()]
  return {
    worktrees: once(all.flatMap((one) => one.worktrees)),
    setups: once(all.flatMap((one) => one.setups)),
    conversations: once(all.flatMap((one) => one.conversations)),
  }
}

export const useElsewhere = (
  client: Pick<Client, 'lookElsewhere' | 'bringIn'>,
  /** Where to look: a project made, or the grants of the folders chosen for one; null to look nowhere yet. */
  at: { readonly projectId: string } | { readonly grants: ReadonlyArray<string> } | null,
): ElsewhereModel => {
  const [found, setFound] = useState<Elsewhere | null>(null)
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set())
  const where = at === null ? null : 'projectId' in at ? `project:${at.projectId}` : `grants:${at.grants.join('\n')}`
  useEffect(() => {
    if (at === null) {
      setFound(null)
      return
    }
    let live = true
    const reads =
      'projectId' in at ? [client.lookElsewhere({ projectId: at.projectId })] : at.grants.map((grant) => client.lookElsewhere({ grant }))
    // One that can't be read finds nothing: the others are shown all the same.
    void Promise.all(reads.map((read) => read.catch(() => NONE))).then((all) => {
      if (live) setFound(merged(all))
    })
    return () => {
      live = false
    }
    // Read again only where it looks changes, not as its object does each render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `where` stands for `at`.
  }, [where, client])
  const tiles = useMemo(() => (found === null ? [] : tilesOf(found)), [found])
  const chosen = found === null ? null : picksOf(found, keys)
  return {
    found,
    tiles,
    picked: keys,
    onPick: (some, on) => setKeys((now) => (found === null ? now : picked(found, now, some, on))),
    go: chosen === null ? null : words.bring(chosen.worktrees.length, chosen.setups.length, chosen.conversations.length),
    load: (projectId) =>
      client.lookElsewhere({ projectId }).then(
        (read) => {
          setFound(read)
          return read
        },
        () => {
          setFound(NONE)
          return NONE
        },
      ),
    bring: (projectId, steps = []) =>
      chosen === null || chosen.worktrees.length + chosen.setups.length + chosen.conversations.length === 0
        ? Promise.resolve(null)
        : client.bringIn({ projectId, ...chosen, steps }),
  }
}
