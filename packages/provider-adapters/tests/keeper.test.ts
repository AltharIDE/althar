import { chmodSync, existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'

import { keeper, keeperName, keeperStartedAt } from '../src/keeper'

/*
 * The keeper Althar builds on Windows with the .NET Framework's compiler,
 * here with a stand-in for that compiler where `compilerOf` looks for it
 * under `SystemRoot`: one that builds, one that fails as csc does, saying
 * why on stdout, one that fails saying nothing, and one that says it built
 * but leaves nothing.
 */

const script = (path: string, body: string) => {
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

/** A Windows folder whose compiler does `body`, its arguments as csc's: `/out:<path>` among them. */
const withCompiler = async <A>(body: string, run: (folder: string) => Promise<A>) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-keeper-'))
  const windows = join(root, 'Windows')
  script(`${windows}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`, body)
  const before = process.env.SystemRoot
  process.env.SystemRoot = windows
  try {
    return await run(join(root, 'althar'))
  } finally {
    if (before === undefined) delete process.env.SystemRoot
    else process.env.SystemRoot = before
  }
}

const BUILDS = 'for arg in "$@"; do case "$arg" in /out:*) printf MZ > "${arg#/out:}";; esac; done'

describe('the keeper', () => {
  it('is built once with the compiler Windows has, kept by its name, and found there after', async () => {
    await withCompiler(BUILDS, async (folder) => {
      const path = await Effect.runPromise(keeper(folder))
      assert.strictEqual(path, join(folder, keeperName))
      assert.isTrue(existsSync(path))
      // Its build folder is gone; only the keeper stays.
      assert.deepStrictEqual(readdirSync(folder), [keeperName])
      assert.strictEqual(await Effect.runPromise(keeper(folder)), path)
    })
    // One built before, by another Althar, is used as it is.
    const folder = mkdtempSync(join(tmpdir(), 'althar-keeper-'))
    writeFileSync(join(folder, keeperName), 'MZ')
    assert.strictEqual(await Effect.runPromise(keeper(folder)), join(folder, keeperName))
  })

  it('says why it couldn’t be built: the compiler’s own words, or what went wrong, and keeps nothing', async () => {
    const failure = async (body: string) =>
      withCompiler(body, async (folder) => {
        const exit = await Effect.runPromiseExit(keeper(folder))
        assert.deepStrictEqual(readdirSync(folder), [])
        return Exit.isFailure(exit) ? JSON.stringify(exit.cause) : 'built'
      })
    assert.include(await failure("echo 'keeper.cs(12,5): error CS1002: ; expected'; exit 1"), 'keeper.cs(12,5): error CS1002: ; expected')
    assert.include(await failure('exit 1'), 'Command failed')
    assert.include(await failure('exit 0'), "it couldn't be put in place")
  })

  it('says Windows has no compiler to build it with, where it has none', async () => {
    const before = process.env.SystemRoot
    process.env.SystemRoot = mkdtempSync(join(tmpdir(), 'althar-no-windows-'))
    try {
      const exit = await Effect.runPromiseExit(keeper(mkdtempSync(join(tmpdir(), 'althar-keeper-'))))
      assert.include(JSON.stringify(exit), 'Windows has no .NET Framework 4 compiler')
    } finally {
      if (before === undefined) delete process.env.SystemRoot
      else process.env.SystemRoot = before
    }
  })

  it('reads when a process started from what the keeper says, and nothing where it says nothing it can read', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'althar-keeper-'))
    const saying = (name: string, body: string) => script(join(folder, name), body)
    assert.strictEqual(
      await Effect.runPromise(keeperStartedAt(saying('started', "printf '2026-10-19T22:00:00.123Z'"), 42)),
      '2026-10-19T22:00:00.123Z',
    )
    assert.isUndefined(await Effect.runPromise(keeperStartedAt(saying('garbled', "printf 'not a time'"), 42)))
    // A process that has exited: the keeper says so by its exit code.
    assert.isUndefined(await Effect.runPromise(keeperStartedAt(saying('gone', 'exit 3'), 42)))
  })
})
