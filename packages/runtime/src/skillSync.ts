import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { SYNCED_AGENTS, type SyncedAgent } from '@althar/provider-adapters'

/*
 * One switch that keeps the person's skills the same in each of their
 * agents (docs/decisions/097, "Skills: a switch of their own"). A skill is a
 * folder with a `SKILL.md`, so there is nothing to translate and no secret
 * to carry: Althar links each skill into the other agents' folders, and the
 * skill stays where it is, so a change to it reaches every agent. It never
 * moves or copies one, and takes out only the links it made.
 *
 * It leaves alone what isn't the person's own folder: a plugin's skills
 * (they update with it), a repository's `.claude/skills`, and Althar's own,
 * which every role gets in Althar already; none of them is in the folders it
 * reads. Claude Code reads `~/.claude/skills`, Codex `~/.agents/skills`, and
 * OpenCode its own `~/.config/opencode/skills` and both of those.
 */

export interface SkillIo {
  readonly homeDir: string
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Where Althar keeps its record. */
  readonly folder: string
  readonly now: () => string
}

/** Each agent's own folder of the person's skills, where a link to one goes. */
export const skillFolders = (io: Pick<SkillIo, 'homeDir' | 'env'>): Readonly<Record<SyncedAgent, string>> => ({
  claude: join(io.homeDir, '.claude', 'skills'),
  codex: join(io.homeDir, '.agents', 'skills'),
  opencode: join(io.env?.['XDG_CONFIG_HOME'] || join(io.homeDir, '.config'), 'opencode', 'skills'),
})

/** The folders each agent reads skills from: its own, and for OpenCode the other two as well. */
const readsFrom = (folders: Readonly<Record<SyncedAgent, string>>): Readonly<Record<SyncedAgent, ReadonlyArray<string>>> => ({
  claude: [folders.claude],
  codex: [folders.codex],
  opencode: [folders.opencode, folders.claude, folders.codex],
})

export interface SkillLink {
  readonly agent: SyncedAgent
  readonly name: string
  readonly link: string
  readonly target: string
  readonly at: string
}

export interface SkillRecord {
  readonly on: boolean
  readonly linked: ReadonlyArray<SkillLink>
  readonly keptOut: Readonly<Record<SyncedAgent, ReadonlyArray<string>>>
  /** For one name with two versions: whose is linked into the others, or both kept as they are. */
  readonly picks: Readonly<Record<string, SyncedAgent | 'apart'>>
  /** What its last links couldn't do: said in Settings until they can. */
  readonly errors?: ReadonlyArray<string>
}

const NONE: Readonly<Record<SyncedAgent, ReadonlyArray<string>>> = { claude: [], codex: [], opencode: [] }
export const emptySkillRecord: SkillRecord = { on: false, linked: [], keptOut: NONE, picks: {} }

const recordPath = (io: SkillIo) => join(io.folder, 'skill-sync.json')

export const readSkillRecord = (io: SkillIo): SkillRecord => {
  try {
    const path = recordPath(io)
    return existsSync(path)
      ? { ...emptySkillRecord, ...(JSON.parse(readFileSync(path, 'utf8')) as Partial<SkillRecord>) }
      : emptySkillRecord
  } catch {
    return emptySkillRecord
  }
}

const writeSkillRecord = (io: SkillIo, record: SkillRecord) => {
  mkdirSync(io.folder, { recursive: true })
  writeFileSync(recordPath(io), `${JSON.stringify(record, null, 2)}\n`)
}

/** A skill in one folder: its name, where it really is, and what its `SKILL.md` says, to tell two versions apart. */
interface Found {
  readonly name: string
  readonly folder: string
  readonly real: string
  readonly text: string
}

const skillsIn = (folder: string): ReadonlyArray<Found> => {
  if (!existsSync(folder)) return []
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    try {
      const real = realpathSync(path)
      const text = readFileSync(join(real, 'SKILL.md'), 'utf8')
      return [{ name, folder, real, text }]
    } catch {
      return []
    }
  })
}

export type SkillHere = 'in' | 'linked' | 'missing' | 'out' | 'differs'

export type SkillSettle = {
  readonly kind: 'differs'
  readonly skill: string
  readonly versions: ReadonlyArray<{ readonly agent: SyncedAgent; readonly real: string; readonly link: boolean }>
}

export interface SkillPlan {
  readonly links: ReadonlyArray<{ readonly agent: SyncedAgent; readonly name: string; readonly target: string }>
  /** A link of the person's own, to the version not picked, that becomes a link to the one picked. */
  readonly relinks: ReadonlyArray<{ readonly agent: SyncedAgent; readonly name: string; readonly target: string }>
  readonly settle: ReadonlyArray<SkillSettle>
  readonly here: Readonly<Record<string, Readonly<Record<SyncedAgent, SkillHere>>>>
}

const ownerOf = (folders: Readonly<Record<SyncedAgent, string>>, folder: string): SyncedAgent =>
  SYNCED_AGENTS.find((agent) => folders[agent] === folder) ?? 'claude'

const isLink = (path: string) => {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

export const planSkills = (io: SkillIo, record: SkillRecord): SkillPlan => {
  const folders = skillFolders(io)
  const found = SYNCED_AGENTS.flatMap((agent) => skillsIn(folders[agent]))
  const names = [...new Set(found.map((each) => each.name))].sort()
  const reads = readsFrom(folders)
  const links: Array<SkillPlan['links'][number]> = []
  const relinks: Array<SkillPlan['relinks'][number]> = []
  const settle: Array<SkillSettle> = []
  const here: Record<string, Record<SyncedAgent, SkillHere>> = {}
  for (const name of names) {
    const copies = found.filter((each) => each.name === name)
    const versions = copies.filter(
      (one, index) => copies.findIndex((other) => other.real === one.real || other.text === one.text) === index,
    )
    const row: Record<SyncedAgent, SkillHere> = { claude: 'missing', codex: 'missing', opencode: 'missing' }
    for (const agent of SYNCED_AGENTS) {
      const mine = record.linked.some((each) => each.agent === agent && each.name === name)
      if (copies.some((each) => reads[agent].includes(each.folder))) row[agent] = mine ? 'linked' : 'in'
      else if (record.keptOut[agent].includes(name)) row[agent] = 'out'
    }
    here[name] = row
    const pick = record.picks[name]
    if (pick === 'apart') continue
    let source = versions[0]
    if (versions.length > 1) {
      const picked = pick === undefined ? undefined : versions.find((each) => ownerOf(folders, each.folder) === pick)
      if (picked === undefined) {
        settle.push({
          kind: 'differs',
          skill: name,
          versions: versions.map((each) => ({
            agent: ownerOf(folders, each.folder),
            real: each.real,
            link: isLink(join(each.folder, name)),
          })),
        })
        for (const each of versions) row[ownerOf(folders, each.folder)] = 'differs'
        continue
      }
      source = picked
      // Only a link of the person's own can point elsewhere: a folder of theirs is never moved.
      for (const other of copies)
        if (other.real !== picked.real && isLink(join(other.folder, name)))
          relinks.push({ agent: ownerOf(folders, other.folder), name, target: picked.real })
    }
    if (source === undefined) continue
    for (const agent of SYNCED_AGENTS) if (row[agent] === 'missing') links.push({ agent, name, target: source.real })
  }
  return { links, relinks, settle, here }
}

/** Makes what the plan says, while the switch is on: each link in the agent's own folder; nothing else is touched. */
export const reconcileSkills = (io: SkillIo): { readonly record: SkillRecord; readonly errors: ReadonlyArray<string> } => {
  let record = readSkillRecord(io)
  const folders = skillFolders(io)
  // A link Althar made that the person took out: kept out there.
  for (const each of record.linked)
    if (!isLink(each.link))
      record = {
        ...record,
        linked: record.linked.filter((one) => one !== each),
        keptOut: { ...record.keptOut, [each.agent]: [...new Set([...record.keptOut[each.agent], each.name])] },
      }
  if (!record.on) {
    writeSkillRecord(io, record)
    return { record, errors: [] }
  }
  const plan = planSkills(io, record)
  const errors: Array<string> = []
  for (const { agent, name, target } of [...plan.relinks, ...plan.links]) {
    const link = join(folders[agent], name)
    try {
      mkdirSync(folders[agent], { recursive: true })
      if (isLink(link)) unlinkSync(link)
      else if (existsSync(link)) continue
      symlinkSync(target, link, 'dir')
      record = {
        ...record,
        linked: [
          ...record.linked.filter((each) => !(each.agent === agent && each.name === name)),
          { agent, name, link, target, at: io.now() },
        ],
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  record = { ...record, errors }
  writeSkillRecord(io, record)
  return { record, errors }
}

/** Takes one link out, where it is still the one Althar made. */
const unlink = (each: SkillLink) => {
  try {
    if (isLink(each.link) && readlinkSync(each.link) === each.target) unlinkSync(each.link)
  } catch {
    // Gone already: nothing to take out.
  }
}

export const turnSkillsOn = (io: SkillIo) => {
  writeSkillRecord(io, { ...readSkillRecord(io), on: true })
  return reconcileSkills(io)
}

/** Off: the links stay, the person's now, or come out; the skills themselves never move. */
export const turnSkillsOff = (io: SkillIo, takeBack: boolean) => {
  const record = readSkillRecord(io)
  if (takeBack) record.linked.forEach(unlink)
  writeSkillRecord(io, { ...record, on: false, linked: [] })
}

export const keepSkillOut = (io: SkillIo, agent: SyncedAgent, name: string) => {
  const record = readSkillRecord(io)
  const mine = record.linked.find((each) => each.agent === agent && each.name === name)
  if (mine !== undefined) unlink(mine)
  writeSkillRecord(io, {
    ...record,
    linked: record.linked.filter((each) => each !== mine),
    keptOut: { ...record.keptOut, [agent]: [...new Set([...record.keptOut[agent], name])] },
  })
}

export const putSkillBack = (io: SkillIo, agent: SyncedAgent, name: string) => {
  const record = readSkillRecord(io)
  writeSkillRecord(io, { ...record, keptOut: { ...record.keptOut, [agent]: record.keptOut[agent].filter((each) => each !== name) } })
  return reconcileSkills(io)
}

export const pickSkill = (io: SkillIo, name: string, way: SyncedAgent | 'apart') => {
  const record = readSkillRecord(io)
  writeSkillRecord(io, { ...record, picks: { ...record.picks, [name]: way } })
  return reconcileSkills(io)
}
