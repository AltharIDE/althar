import { spawnSync } from 'node:child_process'
import { constants } from 'node:os'
import { globSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A lead's worker budget is for its whole test command, not for every package at once. Bun 1.3.5's workspace
 * filter runs packages concurrently, so under that budget run them one at a time. An ordinary terminal or CI
 * without the variable keeps Bun's usual scheduling. Vitest itself reads VITEST_MAX_WORKERS.
 */
export const runWorkspaces = (
  script: string,
  args: ReadonlyArray<string> = [],
  root = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): number => {
  const budget = env.VITEST_MAX_WORKERS
  const limited = budget !== undefined && budget !== ''
  if (limited && (!/^\d+$/.test(budget) || !Number.isSafeInteger(Number(budget)) || Number(budget) < 1))
    throw new Error('VITEST_MAX_WORKERS must be a positive whole number')

  const run = (cwd: string, command: ReadonlyArray<string>) => {
    const result = spawnSync('bun', [...command], { cwd, env, stdio: 'inherit' })
    if (result.error !== undefined) throw result.error
    return result.status ?? (result.signal === null ? 1 : 128 + constants.signals[result.signal])
  }
  if (!limited) return run(root, ['--filter', '*', script, ...args])

  const { workspaces } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { workspaces: Array<string> }
  const packages = globSync(
    workspaces.map((pattern) => `${pattern}/package.json`),
    { cwd: root },
  ).toSorted()
  for (const file of packages) {
    const manifest = JSON.parse(readFileSync(join(root, file), 'utf8')) as { scripts?: Record<string, string> }
    if (manifest.scripts?.[script] === undefined) continue
    const code = run(resolve(root, file, '..'), ['run', script, ...args])
    if (code !== 0) return code
  }
  return 0
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = runWorkspaces(process.argv[2] ?? 'test', process.argv.slice(3))
