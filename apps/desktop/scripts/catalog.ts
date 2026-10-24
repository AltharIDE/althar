import { cpSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { skillsCatalog } from '../src/main/skillsCatalog.ts'

/*
 * The default skill catalog in the packaged app: copied from packages/skills
 * with its licences and THIRD_PARTY.md (its CURATION.md stays in the
 * repository), then looked for where the packaged main process will look,
 * so a package without it, or with a skill missing, is never made.
 */

/** Copies the catalog into a staged app and returns where the packaged runtime will read it; throws if it can't. */
export const stageSkillsCatalog = (source: string, stage: string): string => {
  const target = join(stage, 'resources', 'skills-catalog')
  cpSync(source, target, { recursive: true, filter: (path) => !path.endsWith('CURATION.md') })
  const found = skillsCatalog(join(stage, 'dist', 'main'), true)
  const listed = join(found, 'catalog.json')
  if (!existsSync(listed)) throw new Error(`The packaged app would find no skill catalog at ${found}`)
  const { entries } = JSON.parse(readFileSync(listed, 'utf8')) as { entries: ReadonlyArray<{ id: string }> }
  const missing = entries.filter(({ id }) => !existsSync(join(found, 'skills', id, 'SKILL.md'))).map(({ id }) => id)
  if (entries.length === 0 || missing.length > 0)
    throw new Error(`The packaged skill catalog is missing ${missing.join(', ') || 'every skill'}`)
  return found
}
