import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { projectRun } from '../src/projection'
import { setActive } from '../src/review'
import { activeSelection } from '../src/selection'
import { clean, good, install, run } from './support'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'althar-store-'))
})
afterEach(async () => {
  await clean(root)
})

describe('the skills a run is given', () => {
  it('are the active installs, with what each needs where the caller knows it, and none before any is installed', async () => {
    expect(await run(activeSelection(root))).toEqual([])
    await install(root, 'alpha', good('alpha'))
    await install(root, 'beta', good('beta'), false)
    expect((await run(activeSelection(root, new Map([['alpha', ['subagents']]])))).map(({ id, needs }) => `${id} ${needs.join()}`)).toEqual(
      ['alpha subagents'],
    )
    await run(setActive(root, 'beta', true))
    expect((await run(activeSelection(root))).map(({ id }) => id)).toEqual(['alpha', 'beta'])
  })

  it('cost the others nothing when one install does not read, and are refused whole when the file is not JSON', async () => {
    await install(root, 'alpha', good('alpha'))
    await writeFile(
      join(root, 'installs.json'),
      JSON.stringify({
        version: 1,
        installs: [{ id: 'broken', source: 'github' }, ...JSON.parse(await readFile(join(root, 'installs.json'), 'utf8')).installs],
      }),
    )
    expect((await run(activeSelection(root))).map(({ id }) => id)).toEqual(['alpha'])
    await writeFile(join(root, 'installs.json'), '{nope')
    await expect(run(activeSelection(root))).rejects.toThrow('not JSON')
  })
})

describe('the Claude Code plugin layout', () => {
  it('puts skills and a bare manifest under the run, and nothing outside it', async () => {
    await install(root, 'alpha', good('alpha'))
    const result = await run(
      projectRun({
        root,
        runId: 'r1',
        agent: 'claude-code',
        selected: await run(activeSelection(root)),
        capabilities: [],
        keepOutOf: ['/repo'],
        layout: 'claude-plugin',
      }),
    )
    expect(result.directory).toBe(join(root, 'runs', 'r1', 'claude-code', 'plugin'))
    expect(await readFile(join(result.directory, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toContain('name: alpha')
    const manifest = JSON.parse(await readFile(join(result.directory, '.claude-plugin', 'plugin.json'), 'utf8'))
    expect(manifest).toEqual({ name: 'althar', description: 'Skills Althar selected for this run', version: '0.0.0' })
    expect(existsSync(join(result.directory, 'hooks'))).toBe(false)
  })
})

describe('the Agent Skills layout', () => {
  it('puts skills under the run folder’s .agents/skills, which a session is given as an added directory', async () => {
    await install(root, 'alpha', good('alpha'))
    const result = await run(
      projectRun({
        root,
        runId: 'r1',
        agent: 'codex',
        selected: await run(activeSelection(root)),
        capabilities: [],
        keepOutOf: ['/repo'],
        layout: 'agents',
      }),
    )
    expect(result.directory).toBe(join(root, 'runs', 'r1', 'codex'))
    expect(await readFile(join(result.directory, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toContain('name: alpha')
    expect(result.projected).toEqual(['alpha'])
  })
})
