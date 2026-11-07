import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  keepSkillOut,
  pickSkill,
  planSkills,
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
})
