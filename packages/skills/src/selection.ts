import { Effect } from 'effect'
import { type SkillStoreFailed } from './errors'
import { listInstalls } from './store'

/** A skill a run is given: its id, the stored version, and what it needs of the agent. */
export interface Chosen {
  readonly id: string
  readonly treeHash: string
  readonly needs: ReadonlyArray<string>
}

/**
 * The skills a run is given: the active installs, with what each needs of the agent where the caller knows it. An
 * install whose record doesn't read is given to no run, and costs the others nothing.
 */
export const activeSelection = (
  root: string,
  needs: ReadonlyMap<string, ReadonlyArray<string>> = new Map(),
): Effect.Effect<ReadonlyArray<Chosen>, SkillStoreFailed> =>
  Effect.map(listInstalls(root), (listed) =>
    listed.flatMap((one) =>
      one.ok && one.install.active ? [{ id: one.install.id, treeHash: one.install.treeHash, needs: needs.get(one.install.id) ?? [] }] : [],
    ),
  )
