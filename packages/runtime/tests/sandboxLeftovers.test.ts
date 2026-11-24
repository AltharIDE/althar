import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { Ids, newId, now } from '@althar/domain'
import { bundledCodex } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { missingPlaces, mountPoints, placesIn, recordPlaces, settle, sweepPlaces } from '../src/sandboxLeftovers'
import { runtime } from './support'

/*
 * What an agent's sandbox leaves in the person's checkout and a task's
 * worktree (DEV-286), and Althar taking it away: written by hand as Claude
 * Code's and Codex's sandboxes leave it when they are killed, and, where
 * bubblewrap runs, left by Codex's own sandbox killed mid-command.
 */

const linux = process.platform === 'linux'

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@althar.test',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@althar.test',
}
const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd, env, encoding: 'utf8' })

/** The person's checkout with one commit, and a task's worktree of it beside it. */
const checkoutAndWorktree = () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-leftovers-'))
  const checkout = join(root, 'checkout')
  mkdirSync(checkout)
  git(checkout, 'init', '-q', '-b', 'main')
  git(checkout, 'config', 'maintenance.auto', 'false')
  writeFileSync(join(checkout, 'README.md'), 'hello\n')
  git(checkout, 'add', '.')
  git(checkout, 'commit', '-q', '-m', 'first')
  const worktree = join(root, 'task')
  git(checkout, 'worktree', 'add', '-q', '-b', 'task', worktree)
  return { checkout, worktree }
}

/** Every path under a folder with its kind, mode and bytes: byte-identical means equal. */
const snapshot = (folder: string): Record<string, string> => {
  const found: Record<string, string> = {}
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name)
      const stat = lstatSync(path)
      const kind = stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : 'other'
      found[relative(folder, path)] = `${kind} ${(stat.mode & 0o777).toString(8)} ${kind === 'file' ? readFileSync(path, 'base64') : ''}`
      if (stat.isDirectory()) walk(path)
    }
  }
  walk(folder)
  return found
}

/** What Claude Code's sandbox leaves when killed: an empty read-only file where a path it protects was missing. */
const claudePlaceholder = (path: string) => {
  writeFileSync(path, '')
  chmodSync(path, 0o444)
}

/** What Codex's leaves: an empty folder it mounted a read-only one on. */
const codexPlaceholder = (path: string) => mkdirSync(path)

const nothingMounted = new Set<string>()

describe('placesIn', () => {
  it('names the root of a worktree and the git directory it shares with the checkout', () => {
    const { checkout, worktree } = checkoutAndWorktree()
    const places = placesIn(worktree, 'codex')
    assert.include(places, join(worktree, '.codex'))
    assert.include(places, join(worktree, '.agents'))
    assert.include(places, join(worktree, '.aws'))
    assert.include(places, join(checkout, '.git', 'config.lock'))
    assert.notInclude(places, join(worktree, '.git'))
  })

  it("names Codex's folders only for Codex, whose sandbox alone makes them", () => {
    const { checkout, worktree } = checkoutAndWorktree()
    const places = placesIn(worktree, 'claude-code')
    for (const name of ['.agents', '.aws', '.codex']) assert.notInclude(places, join(worktree, name))
    assert.include(places, join(worktree, '.idea'))
    assert.include(places, join(checkout, '.git', 'config.lock'))
  })

  it('is nothing to record off Linux, where no sandbox mounts over a missing path', async () => {
    const { worktree } = checkoutAndWorktree()
    assert.deepStrictEqual(await missingPlaces([worktree], 'codex', 'darwin'), [])
  })
})

describe.skipIf(!linux)('taking away what a sandbox left', () => {
  it('leaves the checkout and the worktree byte-identical after a killed sandbox', async () => {
    const { checkout, worktree } = checkoutAndWorktree()
    const before = { checkout: snapshot(checkout), worktree: snapshot(worktree) }
    const recorded = await missingPlaces([worktree], 'codex')
    // Claude Code's in the shared .git and at the root, Codex's at the root, as each leaves them when it is killed.
    claudePlaceholder(join(checkout, '.git', 'config.lock'))
    claudePlaceholder(join(worktree, '.idea'))
    claudePlaceholder(join(checkout, '.git', 'branches'))
    for (const name of ['.agents', '.aws', '.codex']) codexPlaceholder(join(worktree, name))
    assert.notDeepEqual(snapshot(worktree), before.worktree)

    const settled = await Promise.all(recorded.map((path) => settle(path, nothingMounted)))
    const removed = recorded.filter((_, index) => settled[index] === 'removed').map((path) => path.slice(path.lastIndexOf('/') + 1))
    assert.deepStrictEqual(removed.sort(), ['.agents', '.aws', '.codex', '.idea', 'branches', 'config.lock'])
    assert.deepStrictEqual({ checkout: snapshot(checkout), worktree: snapshot(worktree) }, before)
  })

  it("lets the person's git config work again once a left config.lock is taken away", async () => {
    const { checkout, worktree } = checkoutAndWorktree()
    const recorded = await missingPlaces([worktree], 'codex')
    claudePlaceholder(join(checkout, '.git', 'config.lock'))
    const locked = spawnSync('git', ['config', 'user.name', 'Person'], { cwd: checkout, encoding: 'utf8' })
    assert.notStrictEqual(locked.status, 0)
    assert.match(locked.stderr, /could not lock config file/)

    await Promise.all(recorded.map((path) => settle(path, nothingMounted)))
    git(checkout, 'config', 'user.name', 'Person')
    git(checkout, 'config', '--unset', 'user.name')
  })

  it("keeps the person's own .codex, whatever its shape, and keeps a missing one missing", async () => {
    const { worktree } = checkoutAndWorktree()
    const theirs = join(worktree, '.codex')
    // An empty read-only file, as the one in ai-teacher was: there before the sandbox started, so never recorded.
    claudePlaceholder(theirs)
    const recorded = await missingPlaces([worktree], 'codex')
    assert.notInclude(recorded, theirs)
    await Promise.all(recorded.map((path) => settle(path, nothingMounted)))
    assert.isTrue(lstatSync(theirs).isFile())

    const { worktree: other } = checkoutAndWorktree()
    const missing = join(other, '.codex')
    const places = await missingPlaces([other], 'codex')
    assert.include(places, missing)
    codexPlaceholder(missing)
    await Promise.all(places.map((path) => settle(path, nothingMounted)))
    assert.isFalse(existsSync(missing))
  })

  it('leaves what holds something, can be written, or is mounted on', async () => {
    const { worktree } = checkoutAndWorktree()
    const holding = join(worktree, '.codex')
    mkdirSync(holding)
    writeFileSync(join(holding, 'config.toml'), 'model = "x"\n')
    assert.strictEqual(await settle(holding, nothingMounted), 'theirs')
    const writable = join(worktree, '.mcp.json')
    writeFileSync(writable, '')
    assert.strictEqual(await settle(writable, nothingMounted), 'theirs')
    const mounted = join(worktree, '.aws')
    codexPlaceholder(mounted)
    assert.strictEqual(await settle(mounted, new Set([mounted])), 'mounted')
    assert.isTrue(existsSync(mounted))
    assert.strictEqual(await settle(join(worktree, '.agents'), nothingMounted), 'gone')
  })

  it('leaves an empty folder the person makes where a sandbox protects a file or a folder of its own', async () => {
    const { checkout, worktree } = checkoutAndWorktree()
    // Missing when a Claude Code session started; the person makes them, writable and empty, while it runs.
    const recorded = await missingPlaces([worktree], 'claude-code')
    const made = [join(worktree, '.idea'), join(worktree, '.vscode'), join(checkout, '.git', 'branches')]
    for (const path of made) {
      assert.include(recorded, path)
      mkdirSync(path)
    }
    // Their .codex is no place Claude Code's sandbox makes: never recorded, so it stays as well.
    mkdirSync(join(worktree, '.codex'))
    assert.notInclude(recorded, join(worktree, '.codex'))
    for (const path of recorded) assert.notStrictEqual(await settle(path, nothingMounted), 'removed')
    for (const path of [...made, join(worktree, '.codex')]) assert.isTrue(lstatSync(path).isDirectory())
  })

  it('reads every mount namespace once, with mountinfo escapes read back', async () => {
    const proc = mkdtempSync(join(tmpdir(), 'althar-proc-'))
    const proc_ = (pid: string, space: string, points: Array<string>) => {
      mkdirSync(join(proc, pid, 'ns'), { recursive: true })
      symlinkSync(space, join(proc, pid, 'ns', 'mnt'))
      writeFileSync(join(proc, pid, 'mountinfo'), points.map((point, index) => `${index} 1 0:7 / ${point} ro - tmpfs tmpfs ro\n`).join(''))
    }
    proc_('1', 'mnt:[1]', ['/'])
    proc_('20', 'mnt:[2]', ['/', '/home/me/my\\040repo/.git/config.lock'])
    // The same namespace again: not read twice.
    proc_('21', 'mnt:[2]', ['/never/read'])
    mkdirSync(join(proc, 'self'))
    const points = await mountPoints(proc)
    assert.isTrue(points.has('/home/me/my repo/.git/config.lock'))
    assert.isFalse(points.has('/never/read'))
  })
})

/** A process of an agent, as the runtime records one before it spawns it; ended or not. */
const agentProcess = (state: 'running' | 'exited' | 'launching', runtimeInstanceId?: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const id = yield* newId(Ids.process)
    yield* sql`INSERT INTO processes ${sql.insert({
      id,
      deviceId: instance.deviceId,
      runtimeInstanceId: runtimeInstanceId ?? instance.id,
      purpose: 'agent',
      executable: 'claude',
      launchedAt: yield* now,
      state,
      // Spawned, as a pid above Linux's pid_max no process here has, so recovering never signals one.
      ...(state === 'launching' ? {} : { pid: 2_147_483_000 }),
    })}`
    return id
  })

const ended = (id: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`UPDATE processes SET state = 'exited', ended_at = ${new Date().toISOString()} WHERE id = ${id}`,
  )

describe.skipIf(!linux)('the record of where sandboxes may leave placeholders', () => {
  it.effect('takes them away once every process that recorded the place has ended', () =>
    Effect.gen(function* () {
      const { checkout, worktree } = checkoutAndWorktree()
      const before = snapshot(checkout)
      const first = yield* agentProcess('running')
      const second = yield* agentProcess('running')
      yield* recordPlaces(first, [worktree], 'claude-code')
      yield* recordPlaces(second, [worktree], 'codex')
      claudePlaceholder(join(checkout, '.git', 'config.lock'))
      yield* ended(first)
      // The second still runs, its sandbox perhaps mounted on it: nothing is taken away yet.
      assert.deepStrictEqual(yield* sweepPlaces({ mounted: async () => nothingMounted }), [])
      assert.isTrue(existsSync(join(checkout, '.git', 'config.lock')))
      yield* ended(second)
      assert.deepStrictEqual(yield* sweepPlaces({ mounted: async () => nothingMounted }), [join(checkout, '.git', 'config.lock')])
      assert.deepStrictEqual(snapshot(checkout), before)
      const sql = yield* SqlClient.SqlClient
      assert.deepStrictEqual(yield* sql`SELECT * FROM sandbox_places`, [])
    }).pipe(Effect.provide(runtime())),
  )

  it.effect('keeps a place mounted on to try again, and forgets one the person has made theirs', () =>
    Effect.gen(function* () {
      const { worktree } = checkoutAndWorktree()
      const agent = yield* agentProcess('running')
      yield* recordPlaces(agent, [worktree], 'codex')
      const mounted = join(worktree, '.aws')
      codexPlaceholder(mounted)
      writeFileSync(join(worktree, '.mcp.json'), '{}')
      yield* ended(agent)
      assert.deepStrictEqual(yield* sweepPlaces({ mounted: async () => new Set([mounted]) }), [])
      const sql = yield* SqlClient.SqlClient
      const left = yield* sql<{ path: string }>`SELECT path FROM sandbox_places`
      assert.deepStrictEqual(
        left.map((row) => row.path),
        [mounted],
      )
      assert.strictEqual(readFileSync(join(worktree, '.mcp.json'), 'utf8'), '{}')
      assert.deepStrictEqual(yield* sweepPlaces({ mounted: async () => nothingMounted }), [mounted])
    }).pipe(Effect.provide(runtime())),
  )

  it.effect('keeps what the person makes after a launch that crashed before it spawned anything', () =>
    Effect.gen(function* () {
      const file = join(mkdtempSync(join(tmpdir(), 'althar-profile-')), 'althar.sqlite')
      const { checkout, worktree } = checkoutAndWorktree()
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const instance = yield* Instance
        const crashed = yield* newId(Ids.runtimeInstance)
        yield* sql`INSERT INTO runtime_instances ${sql.insert({ id: crashed, deviceId: instance.deviceId, pid: 4242, appVersion: '0.0.0', startedAt: yield* now })}`
        // Recorded before it was spawned; Althar crashed before it spawned it.
        yield* recordPlaces(yield* agentProcess('launching', crashed), [worktree], 'codex')
      }).pipe(Effect.provide(runtime(file)))
      // Before Althar starts again, the person makes their own: no sandbox ran to make them.
      mkdirSync(join(worktree, '.codex'))
      claudePlaceholder(join(worktree, '.idea'))
      const made = { checkout: snapshot(checkout), worktree: snapshot(worktree) }
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        assert.deepStrictEqual(yield* sql`SELECT * FROM sandbox_places`, [])
      }).pipe(Effect.provide(runtime(file)))
      assert.deepStrictEqual({ checkout: snapshot(checkout), worktree: snapshot(worktree) }, made)
    }),
  )

  it.effect("takes away a crashed session's read-only files when Althar starts again, and keeps folders it can't hold to it", () =>
    Effect.gen(function* () {
      const file = join(mkdtempSync(join(tmpdir(), 'althar-profile-')), 'althar.sqlite')
      const { checkout, worktree } = checkoutAndWorktree()
      const before = snapshot(checkout)
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const instance = yield* Instance
        const crashed = yield* newId(Ids.runtimeInstance)
        yield* sql`INSERT INTO runtime_instances ${sql.insert({ id: crashed, deviceId: instance.deviceId, pid: 4242, appVersion: '0.0.0', startedAt: yield* now })}`
        // Spawned and running when Althar crashed.
        yield* recordPlaces(yield* agentProcess('running', crashed), [worktree], 'codex')
      }).pipe(Effect.provide(runtime(file)))
      claudePlaceholder(join(checkout, '.git', 'config.lock'))
      // Codex's shape, or the person's own made after the crash: the same, so it stays.
      mkdirSync(join(worktree, '.codex'))
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        assert.deepStrictEqual(yield* sql`SELECT * FROM sandbox_places`, [])
      }).pipe(Effect.provide(runtime(file)))
      assert.deepStrictEqual(snapshot(checkout), before)
      assert.isTrue(lstatSync(join(worktree, '.codex')).isDirectory())
    }),
  )

  it.effect('forgets, without touching, what a process that was never spawned recorded', () =>
    Effect.gen(function* () {
      const { worktree } = checkoutAndWorktree()
      const never = yield* agentProcess('launching')
      yield* recordPlaces(never, [worktree], 'codex')
      mkdirSync(join(worktree, '.codex'))
      // Its launch failed before it was spawned, as a failed start records it.
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE processes SET state = 'unknown', ended_at = ${new Date().toISOString()} WHERE id = ${never}`
      assert.deepStrictEqual(yield* sweepPlaces({ mounted: async () => nothingMounted }), [])
      assert.isTrue(existsSync(join(worktree, '.codex')))
      assert.deepStrictEqual(yield* sql`SELECT * FROM sandbox_places`, [])
    }).pipe(Effect.provide(runtime())),
  )
})

/** Whether bubblewrap starts a namespace here: not in a container or a sandbox that forbids nesting one. */
const bubblewrapStarts = () =>
  linux && spawnSync('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-user', '--unshare-net', 'true']).status === 0

const codex = bundledCodex()

/*
 * Codex's own sandbox, killed mid-command as a stopped lead's can be: it leaves
 * its folders, Althar takes them away, and Codex starts in the worktree after.
 */
describe.skipIf(!bubblewrapStarts() || codex === null)("Codex's sandbox, killed", () => {
  const sandboxed = (worktree: string, home: string, command: Array<string>) =>
    spawn(codex ?? 'codex', ['sandbox', '-P', ':workspace', '-C', worktree, '--', ...command], {
      cwd: worktree,
      env: { ...process.env, CODEX_HOME: home, HOME: home },
      stdio: 'ignore',
      detached: true,
    })

  it('leaves the worktree byte-identical once Althar has swept, and Codex starts there after', async () => {
    const { checkout, worktree } = checkoutAndWorktree()
    const home = mkdtempSync(join(tmpdir(), 'althar-codex-home-'))
    const before = { checkout: snapshot(checkout), worktree: snapshot(worktree) }
    const recorded = await missingPlaces([worktree], 'codex')

    // Killed as a whole, as a lead that won't stop in its grace period is: no sandbox of it is left to take its folders away.
    const running = sandboxed(worktree, home, ['sleep', '30'])
    const deadline = Date.now() + 10_000
    while (!existsSync(join(worktree, '.codex')) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50))
    assert.isTrue(existsSync(join(worktree, '.codex')), "Codex's sandbox mounted its protected folders")
    // Mounted on while it runs: none of them is taken away.
    for (const path of recorded) assert.notStrictEqual(await settle(path, await mountPoints()), 'removed')
    process.kill(-(running.pid ?? 0), 'SIGKILL')
    await new Promise((done) => running.once('exit', done))
    await new Promise((done) => setTimeout(done, 300))
    for (const name of ['.agents', '.aws', '.codex']) assert.isTrue(existsSync(join(worktree, name)), `Codex left ${name}`)

    for (const path of recorded) await settle(path, await mountPoints())
    assert.deepStrictEqual({ checkout: snapshot(checkout), worktree: snapshot(worktree) }, before)

    const started = sandboxed(worktree, home, ['true'])
    const code = await new Promise((done) => started.once('exit', done))
    assert.strictEqual(code, 0)
    assert.isFalse(existsSync(join(worktree, '.codex')))
  }, 30_000)
})
