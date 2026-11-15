import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

import { removeTreeSync } from '../src/files'
import { runWorkspaces } from '../src/workspaces'

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-workspaces-'))
  const write = (path: string, content: unknown) => writeFileSync(join(root, path), JSON.stringify(content))
  write('package.json', { private: true, workspaces: ['packages/*', 'brand'] })
  for (const name of ['a', 'b', 'no-tests', 'brand']) {
    const dir = name === 'brand' ? name : `packages/${name}`
    mkdirSync(join(root, dir), { recursive: true })
    write(`${dir}/package.json`, {
      name,
      scripts: name === 'no-tests' ? {} : { test: 'bun run ./test.ts', verify: 'bun run ./test.ts' },
    })
    writeFileSync(
      join(root, dir, 'test.ts'),
      `import { appendFileSync } from 'node:fs'
appendFileSync(process.env.RESULT!, JSON.stringify({ name: '${name}', workers: process.env.VITEST_MAX_WORKERS, args: process.argv.slice(2) }) + '\\n')
process.exitCode = process.env.FAIL === '${name}' ? 7 : 0
`,
    )
  }
  const result = join(root, 'result.jsonl')
  const env: NodeJS.ProcessEnv = { ...process.env, RESULT: result }
  delete env.VITEST_MAX_WORKERS
  const rows = () =>
    readFileSync(result, 'utf8')
      .trim()
      .split('\n')
      .map((row) => JSON.parse(row))
  return { root, env, rows }
}

describe('workspace tests under a session’s worker budget', () => {
  for (const script of ['test', 'verify']) {
    it(`runs ${script} once per package in order, carrying the budget and arguments`, () => {
      const { root, env, rows } = fixture()
      try {
        expect(runWorkspaces(script, ['--maxWorkers=1', 'some.test.ts'], root, { ...env, VITEST_MAX_WORKERS: '2' })).toBe(0)
        expect(rows()).toEqual(['brand', 'a', 'b'].map((name) => ({ name, workers: '2', args: ['--maxWorkers=1', 'some.test.ts'] })))
      } finally {
        removeTreeSync(root)
      }
    })
  }

  it('stops on a failed package and returns its exit code', () => {
    const { root, env, rows } = fixture()
    try {
      expect(runWorkspaces('test', [], root, { ...env, VITEST_MAX_WORKERS: '1', FAIL: 'a' })).toBe(7)
      expect(rows().map((row) => row.name)).toEqual(['brand', 'a'])
    } finally {
      removeTreeSync(root)
    }
  })

  it('keeps ordinary terminal and CI workspace runs on Bun’s scheduler', () => {
    const { root, env, rows } = fixture()
    try {
      expect(runWorkspaces('test', ['file.test.ts'], root, { ...env, CI: 'true' })).toBe(0)
      expect(rows().sort((a, b) => a.name.localeCompare(b.name))).toEqual(
        ['a', 'b', 'brand'].map((name) => ({ name, args: ['file.test.ts'] })),
      )
    } finally {
      removeTreeSync(root)
    }
  })

  it('rejects a malformed budget before starting tests', () => {
    for (const value of ['0', '-1', '1.5', '50%', 'many', 'Infinity'])
      expect(() => runWorkspaces('test', [], '.', { VITEST_MAX_WORKERS: value })).toThrow('positive whole number')
  })
})
