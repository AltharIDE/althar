import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_WORKER_SKILL_BYTES, MAX_WORKER_SKILL_FILES } from '@althar/worker-protocol/agent-runs'
import { describe, expect, it } from 'vitest'
import { workerSkillFiles } from '../src/workerSkills'

describe('selected worker skills', () => {
  it('transfers the session projection with executable assets and no home paths', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'worker-skill-projection-'))
    try {
      const skill = join(folder, '.agents', 'skills', 'lint')
      await mkdir(join(skill, 'scripts'), { recursive: true })
      await writeFile(join(skill, 'SKILL.md'), 'Use the lint helper')
      await writeFile(join(skill, 'scripts', 'run'), 'exit 0')
      const files = (await workerSkillFiles(folder)).map(({ path, data, executable }) => [path, Buffer.from(data).toString(), executable])
      expect(files).toHaveLength(2)
      expect(files).toContainEqual(['.agents/skills/lint/scripts/run', 'exit 0', true])
      expect(files).toContainEqual(['.agents/skills/lint/SKILL.md', 'Use the lint helper', false])
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  it('refuses repository internals, oversized assets and links outside a projection', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'worker-skill-unavailable-'))
    try {
      const git = join(folder, '.git')
      await mkdir(git)
      await expect(workerSkillFiles(folder)).rejects.toThrow('invalid path')
      await rm(git, { recursive: true })
      const oversized = join(folder, 'oversized')
      await writeFile(oversized, '')
      await truncate(oversized, MAX_WORKER_SKILL_BYTES + 1)
      await expect(workerSkillFiles(folder)).rejects.toThrow('too large')
      await rm(oversized)
      if (process.platform !== 'win32') {
        await symlink(tmpdir(), join(folder, 'outside'))
        await expect(workerSkillFiles(folder)).rejects.toThrow('contain links')
      }
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  it('bounds the combined projection and rejects paths too long for the worker', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'worker-skill-bounds-'))
    try {
      if (process.platform !== 'win32') {
        const first = 'a'.repeat(110)
        const long = join(folder, first, ...Array.from({ length: 4 }, (_, at) => String(at).repeat(110)))
        await mkdir(long, { recursive: true })
        await expect(workerSkillFiles(folder)).rejects.toThrow('invalid path')
        await rm(join(folder, first), { recursive: true })
      }
      await Promise.all(Array.from({ length: MAX_WORKER_SKILL_FILES + 1 }, (_, at) => writeFile(join(folder, 'file-' + at), '')))
      await expect(workerSkillFiles(folder)).rejects.toThrow('too large')
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
})
