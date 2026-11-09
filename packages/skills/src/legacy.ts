/*
 * What an older Althar left in a store: it shipped 32 skills of its own and installed them as `althar-default`,
 * with the hash of the catalog it came from beside them. Althar ships no skills now (docs/plans/skills-across-harnesses.md),
 * so a store is read without them, and the first start after the update takes them out for good (`removeBundledSkills`).
 * This reads the file as JSON, not through the install schema, which no longer has them.
 */

/** The source an install of a skill Althar shipped had. */
const BUNDLED = 'althar-default'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export interface WithoutBundled {
  /** The store's JSON without the skills Althar shipped, nor the catalog's hash, nor a rolled-back version of one; anything else as it was. */
  readonly value: unknown
  /** The ids of the installs taken out. */
  readonly removed: ReadonlyArray<string>
  /** The stored versions the taken-out installs and rollback entries pointed at. */
  readonly hashes: ReadonlyArray<string>
  readonly changed: boolean
}

export const withoutBundled = (parsed: unknown): WithoutBundled => {
  if (!isRecord(parsed) || !Array.isArray(parsed['installs'])) return { value: parsed, removed: [], hashes: [], changed: false }
  const { catalog: _catalog, ...rest } = parsed
  let changed = 'catalog' in parsed
  const removed: Array<string> = []
  const hashes: Array<string> = []
  const hashOf = (one: Record<string, unknown>) => {
    if (typeof one['treeHash'] === 'string') hashes.push(one['treeHash'])
  }
  const installs: Array<unknown> = []
  for (const raw of parsed['installs'] as ReadonlyArray<unknown>) {
    if (isRecord(raw) && raw['source'] === BUNDLED) {
      changed = true
      if (typeof raw['id'] === 'string') removed.push(raw['id'])
      hashOf(raw)
      for (const past of Array.isArray(raw['history']) ? (raw['history'] as ReadonlyArray<unknown>) : []) if (isRecord(past)) hashOf(past)
      continue
    }
    if (
      isRecord(raw) &&
      Array.isArray(raw['history']) &&
      (raw['history'] as ReadonlyArray<unknown>).some((past) => isRecord(past) && past['source'] === BUNDLED)
    ) {
      changed = true
      const kept = (raw['history'] as ReadonlyArray<unknown>).filter((past) => !(isRecord(past) && past['source'] === BUNDLED))
      for (const past of raw['history'] as ReadonlyArray<unknown>) if (isRecord(past) && past['source'] === BUNDLED) hashOf(past)
      const { history: _history, ...without } = raw
      installs.push(kept.length === 0 ? without : { ...without, history: kept })
      continue
    }
    installs.push(raw)
  }
  return { value: { ...rest, installs }, removed, hashes, changed }
}
