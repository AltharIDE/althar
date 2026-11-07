import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  keepSkillOut,
  pickSkill,
  planSkills,
  putSkillBack,
  readSkillRecord,
  reconcileSkills,
  type SkillIo,
  turnSkillsOff,
  turnSkillsOn,
} from '../src/skillSync'

/* Keeping the person's skills the same in each agent, in a temporary home: links only, never a move or a copy. */

const skill = (folder: string, name: string, body = `---\nname: ${name}\n---\n${name}\n`) => {
  mkdirSync(join(folder, name), { recursive: true })
  writeFileSync(join(folder, name, 'SKILL.md'), body)
}

const setUp = () => {
  const homeDir = realpathSync(mkdtempSync(join(tmpdir(), 'althar-skills-')))
  const claude = join(homeDir, '.claude', 'skills')
  const codex = join(homeDir, '.agents', 'skills')
  const openCode = join(homeDir, '.config', 'opencode', 'skills')
  let tick = 0
  const io: SkillIo = { homeDir, folder: join(homeDir, 'profile'), now: () => `2026-11-07T10:00:0${tick++}.000Z` }
  return { io, claude, codex, openCode }
}

describe('keeping the agents’ skills the same', () => {
  it('links each skill into the agents that don’t see it, and moves or copies nothing', () => {
    const { io, claude, codex, openCode } = setUp()
    skill(claude, 'design-review')
    skill(openCode, 'impeccable')
    expect(planSkills(io, readSkillRecord(io)).links.map((each) => `${each.name}→${each.agent}`)).toEqual([
      'design-review→codex',
      'impeccable→claude',
      'impeccable→codex',
    ])
    turnSkillsOn(io)
    expect(lstatSync(join(codex, 'design-review')).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(codex, 'design-review'))).toBe(join(claude, 'design-review'))
    expect(readlinkSync(join(claude, 'impeccable'))).toBe(join(openCode, 'impeccable'))
    // The skill itself stays where it was, a folder of its own.
    expect(lstatSync(join(claude, 'design-review')).isDirectory()).toBe(true)
  })

  it('takes out only its own links, and leaves the skills', () => {
    const { io, claude, codex } = setUp()
    skill(claude, 'design-review')
    skill(codex, 'improve')
    turnSkillsOn(io)
    turnSkillsOff(io, true)
    expect(existsSync(join(codex, 'design-review'))).toBe(false)
    expect(existsSync(join(claude, 'improve'))).toBe(false)
    expect(existsSync(join(claude, 'design-review', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(codex, 'improve', 'SKILL.md'))).toBe(true)
  })

  it('keeps a skill out of one agent from its chip, and one the person unlinked stays out', () => {
    const { io, claude, codex } = setUp()
    skill(claude, 'a')
    skill(claude, 'b')
    turnSkillsOn(io)
    keepSkillOut(io, 'codex', 'a')
    expect(existsSync(join(codex, 'a'))).toBe(false)
    rmSync(join(codex, 'b'))
    const { record } = reconcileSkills(io)
    expect(existsSync(join(codex, 'b'))).toBe(false)
    expect(record.keptOut.codex).toEqual(['a', 'b'])
  })

  it('waits on the person for one name with two versions, and never replaces a folder of theirs', () => {
    const { io, claude, codex } = setUp()
    skill(claude, 'release-notes', 'new version')
    skill(codex, 'release-notes', 'old version')
    turnSkillsOn(io)
    expect(planSkills(io, readSkillRecord(io)).settle).toEqual([expect.objectContaining({ kind: 'differs', skill: 'release-notes' })])
    pickSkill(io, 'release-notes', 'claude')
    // Codex's is a folder of the person's: it stays as it is.
    expect(lstatSync(join(codex, 'release-notes')).isDirectory()).toBe(true)
    expect(planSkills(io, readSkillRecord(io)).settle).toEqual([])
  })

  it('leaves one name with two versions alone once the person keeps it apart', () => {
    const { io, claude, codex } = setUp()
    skill(claude, 'notes', 'one')
    skill(codex, 'notes', 'two')
    turnSkillsOn(io)
    pickSkill(io, 'notes', 'apart')
    const plan = planSkills(io, readSkillRecord(io))
    expect(plan.settle).toEqual([])
    expect(plan.links).toEqual([])
    expect(plan.here['notes']).toEqual({ claude: 'in', codex: 'in', opencode: 'in' })
  })

  it('points a link of the person’s own at the version they picked', () => {
    const { io, claude, codex } = setUp()
    skill(claude, 'notes', 'new')
    const elsewhere = join(io.homeDir, 'my-skills')
    skill(elsewhere, 'notes', 'old')
    mkdirSync(codex, { recursive: true })
    symlinkSync(join(elsewhere, 'notes'), join(codex, 'notes'), 'dir')
    turnSkillsOn(io)
    expect(planSkills(io, readSkillRecord(io)).settle[0]?.versions).toEqual([
      { agent: 'claude', real: join(claude, 'notes'), link: false },
      { agent: 'codex', real: join(elsewhere, 'notes'), link: true },
    ])
    pickSkill(io, 'notes', 'claude')
    expect(readlinkSync(join(codex, 'notes'))).toBe(join(claude, 'notes'))
    // The version that was left stays where it is.
    expect(existsSync(join(elsewhere, 'notes', 'SKILL.md'))).toBe(true)
  })

  it('never puts a link over a folder there that isn’t a skill, and says a folder it can’t write', () => {
    const { io, claude, codex } = setUp()
    skill(claude, 'notes')
    mkdirSync(join(codex, 'notes'), { recursive: true })
    writeFileSync(join(codex, 'notes', 'README.md'), 'the person’s own')
    const { errors } = turnSkillsOn(io)
    expect(errors).toEqual([])
    expect(lstatSync(join(codex, 'notes')).isDirectory()).toBe(true)
    expect(readSkillRecord(io).linked.some((each) => each.agent === 'codex')).toBe(false)

    const other = setUp()
    skill(other.claude, 'notes')
    // Codex's folder can't be made: a file is where it would go.
    writeFileSync(join(other.io.homeDir, '.agents'), '')
    expect(turnSkillsOn(other.io).errors).toEqual([expect.stringContaining('.agents')])
  })

  it('puts a skill kept out back, and leaves the links in, the person’s now, when turned off with Leave them in', () => {
    const { io, claude, codex } = setUp()
    skill(claude, 'notes')
    // Kept out before it was ever linked.
    keepSkillOut(io, 'codex', 'notes')
    turnSkillsOn(io)
    expect(existsSync(join(codex, 'notes'))).toBe(false)
    putSkillBack(io, 'codex', 'notes')
    expect(readlinkSync(join(codex, 'notes'))).toBe(join(claude, 'notes'))
    turnSkillsOff(io, false)
    expect(lstatSync(join(codex, 'notes')).isSymbolicLink()).toBe(true)
    expect(readSkillRecord(io).linked).toEqual([])
    // Off, it only notes what the person took out.
    rmSync(join(codex, 'notes'))
    expect(reconcileSkills(io).record.on).toBe(false)
    expect(existsSync(join(codex, 'notes'))).toBe(false)
  })
})
