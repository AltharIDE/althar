import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Launches } from '../src/Launches'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { lineOf, runCommandIn, scriptsIn } from '../src/runCommand'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, repository, runtime, until } from './support'

/*
 * The project run by Althar itself, with no agent (ADR-023): how a repository
 * runs, worked out from what is in it; a run of the default branch in a copy
 * of its own, or of what a task built in its worktree, with where it answers
 * read from what it prints; stopped by the person, or kept, once it ends by
 * itself, to say how; and agents keeping how it runs.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd })

/** A server that says where it answers, as Vite does, and keeps running. */
const SERVE = "console.log('  VITE ready')\nconsole.log('  ➜  Local:   http://localhost:5199/')\nsetInterval(() => {}, 1000)\n"

/** A repository whose package.json runs a server. */
const served = () => {
  const path = repository()
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'meridian', scripts: { dev: 'node serve.js' } }))
  writeFileSync(join(path, 'serve.js'), SERVE)
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', 'Serve')
  return path
}

const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

const open = (path: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    return yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
  })

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The run cards in a task's thread, or, with a project, its coordinator's, as a client reads them. */
const cardsIn = (where: { readonly threadId: string } | { readonly projectId: string }) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const { items } =
      'threadId' in where ? yield* Effect.orDie(queries.thread(where.threadId)) : yield* Effect.orDie(queries.coordinator(where.projectId))
    return items.flatMap((item) => (item.kind === 'run' ? [item.content] : []))
  })

const processOf = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ purpose: string; state: string; pid: number | null; exitCode: number | null }>`
      SELECT purpose, state, pid, exit_code FROM processes WHERE id = ${id}`
  })

describe('how a repository runs', () => {
  const folder = () => mkdtempSync(join(tmpdir(), 'althar-run-'))

  it('runs its dev script, else start or serve, with the package manager its lockfile names, installing first where it has packages', () => {
    const here = folder()
    writeFileSync(join(here, 'package.json'), JSON.stringify({ scripts: { start: 'node .', dev: 'vite' }, dependencies: { vite: '7' } }))
    writeFileSync(join(here, 'bun.lock'), '')
    assert.deepStrictEqual(runCommandIn(here, here, 'darwin'), {
      command: 'bun run dev',
      setup: 'test -d node_modules || bun install --frozen-lockfile',
    })
    assert.strictEqual(
      lineOf(runCommandIn(here, here, 'darwin') ?? { command: '', setup: null }),
      '(test -d node_modules || bun install --frozen-lockfile) && bun run dev',
    )
    // On Windows, its own shell's words.
    assert.strictEqual(runCommandIn(here, here, 'win32')?.setup, 'if not exist node_modules bun install --frozen-lockfile')

    // A folder of a larger repository, with its lockfile at the root; nothing to install.
    const root = folder()
    const app = join(root, 'apps', 'web')
    mkdirSync(app, { recursive: true })
    writeFileSync(join(root, 'package-lock.json'), '{}')
    writeFileSync(join(app, 'package.json'), JSON.stringify({ scripts: { serve: 'http-server' } }))
    assert.deepStrictEqual(runCommandIn(app, root, 'darwin'), { command: 'npm run serve', setup: null })

    // No lockfile: npm, and an install that writes none.
    const loose = folder()
    writeFileSync(join(loose, 'package.json'), JSON.stringify({ scripts: { dev: 'next dev' }, devDependencies: { next: '15' } }))
    assert.strictEqual(runCommandIn(loose, loose, 'darwin')?.setup, 'test -d node_modules || npm install --no-package-lock')
  })

  it('runs a Procfile’s web process, else a Makefile’s dev, run or serve target, and says nothing where nothing says', () => {
    const procfile = folder()
    writeFileSync(join(procfile, 'Procfile'), 'worker: bin/worker\nweb: bundle exec rails server\n')
    assert.deepStrictEqual(runCommandIn(procfile), { command: 'bundle exec rails server', setup: null })
    const makefile = folder()
    writeFileSync(join(makefile, 'Makefile'), 'build:\n\tgo build\nrun: build\n\t./app\n')
    assert.deepStrictEqual(runCommandIn(makefile), { command: 'make run', setup: null })
    const scripts = folder()
    writeFileSync(join(scripts, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }))
    assert.isNull(runCommandIn(scripts))
    const broken = folder()
    writeFileSync(join(broken, 'package.json'), '{ not json')
    assert.isNull(runCommandIn(broken))
    assert.isNull(runCommandIn(folder()))
  })
})

describe('what a repository offers to run', () => {
  const folder = () => mkdtempSync(join(tmpdir(), 'althar-scripts-'))
  const write = (path: string, manifest: Record<string, unknown>) => {
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'package.json'), JSON.stringify(manifest))
  }

  it("reads the root's scripts and each workspace's, as run from the root with the package manager its lockfile names", () => {
    const here = folder()
    write(here, {
      name: 'althar',
      scripts: { dev: 'bun --filter @althar/pitch dev', prepare: 'vp config', test: 'vp test' },
      workspaces: ['apps/*', 'packages/ui', '!apps/old'],
    })
    writeFileSync(join(here, 'bun.lock'), '')
    write(join(here, 'apps', 'desktop'), { name: '@althar/desktop', scripts: { dev: 'electron .', postinstall: 'rebuild' } })
    write(join(here, 'apps', 'unnamed'), { scripts: { start: 'node .' } })
    mkdirSync(join(here, 'apps', 'notes'))
    write(join(here, 'packages', 'ui'), { name: '@althar/ui', scripts: { storybook: 'storybook dev --port 6006' } })
    assert.deepStrictEqual(
      scriptsIn(here).map((script) => [script.package, script.name, script.body, script.command]),
      [
        ['althar', 'dev', 'bun --filter @althar/pitch dev', 'bun run dev'],
        ['althar', 'test', 'vp test', 'bun run test'],
        ['@althar/desktop', 'dev', 'electron .', 'bun --filter @althar/desktop dev'],
        ['apps/unnamed', 'start', 'node .', 'bun --filter ./apps/unnamed start'],
        ['@althar/ui', 'storybook', 'storybook dev --port 6006', 'bun --filter @althar/ui storybook'],
      ],
    )
  })

  it('names a workspace as each package manager runs it, and finds nothing where there is no package.json', () => {
    const commandsWith = (lockfile: string) => {
      const here = folder()
      write(here, { name: 'meridian', workspaces: { packages: ['web', 'tools'] } })
      writeFileSync(join(here, lockfile), '')
      write(join(here, 'web'), { name: 'web', scripts: { dev: 'next dev' } })
      write(join(here, 'tools'), { scripts: { lint: 'eslint .' } })
      return scriptsIn(here).map((script) => script.command)
    }
    assert.deepStrictEqual(commandsWith('pnpm-lock.yaml'), ['pnpm --filter web dev', 'pnpm --filter ./tools lint'])
    assert.deepStrictEqual(commandsWith('package-lock.json'), ['npm run dev --workspace web', 'npm run lint --workspace ./tools'])
    // Yarn runs a workspace by its name only.
    assert.deepStrictEqual(commandsWith('yarn.lock'), ['yarn workspace web dev'])
    assert.deepStrictEqual(scriptsIn(folder()), [])
  })
})

describe('running the project', () => {
  it.live('runs the default branch in a copy of its own, says where it answers, and stops it', () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const queries = yield* Queries
      const { projectId } = yield* open(served())
      const threadId = yield* (yield* Coordinator).thread(projectId)
      assert.deepStrictEqual(
        (yield* launches.runnables(projectId, null)).map((one) => [one.command, one.own, one.from]),
        [['npm run dev', true, 'repository']],
      )
      const started = yield* launches.start({ projectId, taskId: null, threadId })
      assert.deepInclude(started, { taskId: null, where: 'main', command: 'npm run dev', label: 'npm run dev', ended: null })
      // Where it answers, from what it printed.
      const [serving] = yield* until(launches.ofProject(projectId), (all) => all[0]?.url != null)
      assert.strictEqual(serving?.url, 'http://localhost:5199/')
      // Its card, in the thread it was asked for in, says so too.
      const [card] = yield* until(cardsIn({ projectId }), (all) => all[0]?.url != null)
      assert.deepInclude(card, { launchId: started.id, where: 'main', command: 'npm run dev', url: 'http://localhost:5199/', ended: null })
      // Asked again while it runs, it is the same run: two would want the same port.
      assert.strictEqual((yield* launches.start({ projectId, taskId: null, threadId: null })).id, started.id)
      // The coordinator's screen shows it, and what running would run.
      const coordinator = yield* queries.coordinator(projectId)
      assert.deepStrictEqual(
        coordinator.launches.map((launch) => launch.id),
        [started.id],
      )
      assert.deepStrictEqual(
        coordinator.runnables.map((one) => one.command),
        ['npm run dev'],
      )
      // It is Althar's own process, recorded as one.
      const [row] = yield* processOf(started.id)
      assert.deepInclude(row, { purpose: 'run', state: 'running' })
      const pid = row?.pid ?? 0
      assert.isTrue(alive(pid))
      yield* launches.stop(started.id)
      assert.lengthOf(yield* launches.ofProject(projectId), 0)
      assert.isFalse(alive(pid))
      assert.strictEqual((yield* processOf(started.id))[0]?.state, 'killed')
      // Its card stays, saying it was stopped.
      assert.deepInclude((yield* cardsIn({ projectId }))[0]?.ended, { stopped: true, code: null })
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('runs what a task built in its worktree, and keeps one that ended by itself, to say how, until it is cleared', () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const queries = yield* Queries
      const projects = yield* Projects
      const instance = yield* Instance
      const { projectId } = yield* open(served())
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Fail fast' }),
        projectId,
        title: 'Fail fast',
      })
      const exits = `node -e "console.log('Error: Port 5173 is already in use'); process.exit(3)"`
      yield* launches.keep({ projectId, run: { command: exits, setup: null }, actorId: instance.personId })
      const started = yield* launches.start({ projectId, taskId: task.taskId, threadId: task.threadId })
      assert.deepInclude(started, { taskId: task.taskId, where: 'Fail fast' })
      const [ended] = yield* until(launches.ofProject(projectId), (all) => all[0]?.ended != null)
      assert.strictEqual(ended?.ended?.code, 3)
      assert.strictEqual((yield* processOf(started.id))[0]?.state, 'exited')
      // Its card, in the task's thread, says how, with what it printed last.
      const [card] = yield* until(cardsIn({ threadId: task.threadId }), (all) => all[0]?.ended != null)
      assert.deepStrictEqual(card?.ended && { code: card.ended.code, stopped: card.ended.stopped, last: card.ended.last }, {
        code: 3,
        stopped: false,
        last: 'Error: Port 5173 is already in use',
      })
      // The task's thread shows it, and what running would run now that one is kept.
      const thread = yield* queries.thread(task.threadId, { limit: 0 })
      assert.deepStrictEqual(
        thread.task.launches.map((launch) => launch.id),
        [started.id],
      )
      assert.deepStrictEqual(
        thread.task.runnables.map((one) => [one.command, one.from]),
        [[exits, 'agent']],
      )
      // The coordinator's shows every run in the project, the task's too, saying where.
      assert.deepStrictEqual(
        (yield* queries.coordinator(projectId)).launches.map((launch) => [launch.id, launch.where]),
        [[started.id, 'Fail fast']],
      )
      yield* launches.clear(started.id)
      assert.lengthOf(yield* launches.ofProject(projectId), 0)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('says when nothing says how it runs; an agent keeps how, and the coordinator runs it', () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const path = repository()
      const { projectId } = yield* open(path)
      const coordinator: ToolAccess = { role: 'coordinator', projectId, threadId: 'none', sessionId: 'none', taskId: null }
      const lead: ToolAccess = { role: 'lead', projectId, threadId: 'none', sessionId: 'none', taskId: null }
      assert.lengthOf(yield* launches.runnables(projectId, null), 0)
      assert.match(
        yield* callTool(coordinator, 'run_project', {}),
        /^Althar can't tell how .* runs: .* keep how it runs with set_run_command/,
      )
      assert.match(yield* callTool(coordinator, 'run_project', { task: 'nothing' }), /no task nothing/)
      // One that ends at once: the coordinator hears how, with what it printed last, to tell the person.
      yield* callTool(lead, 'set_run_command', { command: `node -e "console.log('Error: Port 5173 is already in use'); process.exit(1)"` })
      assert.match(
        yield* callTool(coordinator, 'run_project', {}),
        /ended at once, with exit code 1\. Its last lines:\n\nError: Port 5173 is already in use\n/,
      )
      for (const ended of yield* launches.ofProject(projectId)) yield* launches.clear(ended.id)
      assert.match(
        yield* callTool(lead, 'set_run_command', {
          command: `node -e "console.log('Local: http://localhost:5199/'); setInterval(() => {}, 1000)"`,
        }),
        /^Kept: .* runs with `node -e/,
      )
      // It waits for where it answers, so the coordinator gives the person a link at once.
      assert.match(
        yield* callTool(coordinator, 'run_project', {}),
        /^Running `node -e .*` in a fresh copy of the default branch, at http:\/\/localhost:5199\/\. Give the person that address as a link/,
      )
      // Its copy is Althar's own, beside the coordinator's.
      const [running] = yield* launches.ofProject(projectId)
      assert.isTrue(existsSync(join(path, '.git')))
      yield* launches.stop(running?.id ?? '')
      // A null command goes back to working it out.
      assert.match(yield* callTool(lead, 'set_run_command', { command: null }), /works out how .* runs from the repository again/)
      assert.lengthOf(yield* launches.runnables(projectId, null), 0)
      // A name that isn't a repository is said.
      assert.match(yield* callTool(lead, 'set_run_command', { command: 'make', repository: 'elsewhere' }), /no repository called elsewhere/)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('stops and clears only what it should, and says where there is nothing to run, or no such repository', () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const projects = yield* Projects
      const path = served()
      const name = basename(path)
      const { projectId } = yield* open(path)
      const coordinator: ToolAccess = { role: 'coordinator', projectId, threadId: 'none', sessionId: 'none', taskId: null }
      const lead: ToolAccess = { role: 'lead', projectId, threadId: 'none', sessionId: 'none', taskId: null }
      // No such run: nothing to stop or clear.
      yield* launches.stop('nothing')
      yield* launches.clear('nothing')
      // A task with no worktree on this Mac has nothing to run, nor a repository by any name.
      assert.deepInclude(yield* Effect.flip(launches.start({ projectId, taskId: 'elsewhere', threadId: null })), {
        why: 'elsewhere',
        message: 'The task has no worktree here to run.',
      })
      assert.deepInclude(yield* Effect.flip(launches.start({ projectId, taskId: 'elsewhere', repository: 'web', threadId: null })), {
        why: 'which',
        message: "There's no repository called web in the task. Its repositories: none.",
      })
      // Named, the repository runs; cleared while it runs, it keeps running.
      const started = yield* launches.start({ projectId, taskId: null, repository: name.toUpperCase(), threadId: null })
      yield* launches.clear(started.id)
      assert.lengthOf(yield* launches.ofProject(projectId), 1)
      yield* launches.stop(started.id)

      // One that ends at once, printing nothing: the coordinator hears so, and Stop only takes it off the list.
      assert.match(
        yield* callTool(lead, 'set_run_command', { command: 'node -e "process.exit(2)"', setup: 'true' }),
        /^Kept: .* runs with `node -e "process\.exit\(2\)"`, after `true`, which sets up each new task's worktree too\.$/,
      )
      assert.match(
        yield* callTool(coordinator, 'run_project', { repository: name }),
        /in a fresh copy of the default branch ended at once, with exit code 2\. Its last lines:\n\n\(nothing\)\n/,
      )
      const [ended] = yield* launches.ofProject(projectId)
      yield* launches.stop(ended?.id ?? '')
      assert.lengthOf(yield* launches.ofProject(projectId), 0)
      // Asked for a task by its id, it runs in that task's worktree.
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Exit early' }),
        projectId,
        title: 'Exit early',
      })
      assert.match(
        yield* callTool(coordinator, 'run_project', { task: task.taskId }),
        /^`node -e .*` in exit-early's worktree ended at once/,
      )
    }).pipe(Effect.provide(withQueries())),
  )
})

/** A server on another port, as Storybook says where it answers. */
const SERVE_TOO = "console.log('Storybook started')\nconsole.log('  Local:   http://localhost:6199/')\nsetInterval(() => {}, 1000)\n"

/** A repository whose package.json runs a server, and Storybook beside it. */
const twoServers = () => {
  const path = repository()
  writeFileSync(
    join(path, 'package.json'),
    JSON.stringify({ name: 'meridian', scripts: { dev: 'node serve.js', storybook: 'node storybook.js', prepare: 'true' } }),
  )
  writeFileSync(join(path, 'serve.js'), SERVE)
  writeFileSync(join(path, 'storybook.js'), SERVE_TOO)
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', 'Serve')
  return path
}

describe('what a project runs', () => {
  it.live('keeps more to run beside its own way, in the person’s order, and runs several at once, one of each in a place', () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const queries = yield* Queries
      const instance = yield* Instance
      const path = twoServers()
      const { projectId } = yield* open(path)
      // Its repository's own way first, as the one Run button had it; its scripts to pick from.
      const [own] = yield* launches.runnables(projectId, null)
      assert.deepInclude(own, { name: null, command: 'npm run dev', repository: basename(path), own: true, from: 'repository' })
      assert.deepStrictEqual(
        (yield* launches.scripts(projectId)).map((script) => [script.repository, script.name, script.command]),
        [
          [basename(path), 'dev', 'npm run dev'],
          [basename(path), 'storybook', 'npm run storybook'],
        ],
      )
      const storybook = yield* launches.keepRunnable({
        projectId,
        name: 'Storybook',
        command: 'npm run storybook',
        actorId: instance.personId,
      })
      assert.deepStrictEqual(storybook, { id: storybook.id, name: 'Storybook', repository: basename(path) })
      // The same again is the one there is.
      assert.strictEqual(
        (yield* launches.keepRunnable({ projectId, name: null, command: ' npm run storybook ', actorId: instance.personId })).id,
        storybook.id,
      )
      assert.deepStrictEqual(
        (yield* queries.coordinator(projectId)).runnables.map((one) => [one.name, one.command, one.from]),
        [
          [null, 'npm run dev', 'repository'],
          ['Storybook', 'npm run storybook', 'person'],
        ],
      )
      // Both run at once, from the default branch's one copy; each answers where it says. Asked together, as from
      // the Run button's list, they take turns at the copy, and the same one asked twice is one run.
      const [dev, book, twice] = yield* Effect.all(
        [
          launches.start({ projectId, taskId: null, threadId: null }),
          launches.start({ projectId, taskId: null, runnableId: storybook.id, threadId: null }),
          launches.start({ projectId, taskId: null, runnableId: storybook.id, threadId: null }),
        ],
        { concurrency: 'unbounded' },
      )
      assert.strictEqual(twice.id, book.id)
      assert.deepInclude(dev, { runnableId: own?.id ?? null, command: 'npm run dev', label: 'npm run dev' })
      assert.deepInclude(book, { runnableId: storybook.id, command: 'npm run storybook', label: 'Storybook' })
      const serving = yield* until(launches.ofProject(projectId), (all) => all.length === 2 && all.every((one) => one.url !== null))
      assert.deepStrictEqual(
        serving.map((one) => [one.label, one.url]),
        [
          ['npm run dev', 'http://localhost:5199/'],
          ['Storybook', 'http://localhost:6199/'],
        ],
      )
      // Asked again, each is the run there is.
      assert.strictEqual((yield* launches.start({ projectId, taskId: null, runnableId: storybook.id, threadId: null })).id, book.id)
      // First in the person's order, Storybook is the default.
      yield* launches.orderRunnables({ projectId, ids: [storybook.id, 'nothing'], actorId: instance.personId })
      assert.deepStrictEqual(
        (yield* launches.runnables(projectId, null)).map((one) => one.id),
        [storybook.id, own?.id],
      )
      assert.strictEqual((yield* launches.start({ projectId, taskId: null, threadId: null })).id, book.id)
      // Renamed, and changed by the person, it stays theirs; its run goes on.
      yield* launches.keepRunnable({
        projectId,
        id: storybook.id,
        name: 'Storybook, the kit',
        command: 'npm run storybook',
        actorId: instance.personId,
      })
      assert.deepInclude((yield* launches.runnables(projectId, null))[0], { name: 'Storybook, the kit', from: 'person' })
      // Dropped, it goes from the list, and its run goes on until stopped.
      yield* launches.dropRunnable({ projectId, id: storybook.id, actorId: instance.personId })
      yield* launches.dropRunnable({ projectId, id: storybook.id, actorId: instance.personId })
      assert.deepStrictEqual(
        (yield* launches.runnables(projectId, null)).map((one) => one.id),
        [own?.id],
      )
      assert.lengthOf(yield* launches.ofProject(projectId), 2)
      // What isn't kept any more can't be run, or changed.
      assert.deepInclude(yield* Effect.flip(launches.start({ projectId, taskId: null, runnableId: storybook.id, threadId: null })), {
        why: 'which',
      })
      assert.deepInclude(
        yield* Effect.flip(launches.keepRunnable({ projectId, id: storybook.id, name: null, command: 'x', actorId: instance.personId })),
        { why: 'which' },
      )
      for (const running of yield* launches.ofProject(projectId)) yield* launches.stop(running.id)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('runs one in a task’s worktree, as the task’s screen lists it, with its repository’s setup first', () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const queries = yield* Queries
      const projects = yield* Projects
      const instance = yield* Instance
      const { projectId } = yield* open(twoServers())
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Show the kit' }),
        projectId,
        title: 'Show the kit',
      })
      const kit = yield* launches.keepRunnable({ projectId, name: 'Storybook', command: 'npm run storybook', actorId: instance.personId })
      const thread = yield* queries.thread(task.threadId, { limit: 0 })
      assert.deepStrictEqual(
        thread.task.runnables.map((one) => one.name ?? one.command),
        ['npm run dev', 'Storybook'],
      )
      const started = yield* launches.start({ projectId, taskId: task.taskId, runnableId: kit.id, threadId: task.threadId })
      assert.deepInclude(started, { where: 'Show the kit', runnableId: kit.id, label: 'Storybook' })
      // Its card says which it ran, so Run again runs it again.
      const [card] = yield* until(cardsIn({ threadId: task.threadId }), (all) => all.length > 0)
      assert.strictEqual(card?.runnableId, kit.id)
      yield* launches.stop(started.id)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('lets agents keep more to run by name, run one by name, and drop it', () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const { projectId } = yield* open(twoServers())
      const coordinator: ToolAccess = { role: 'coordinator', projectId, threadId: 'none', sessionId: 'none', taskId: null }
      const lead: ToolAccess = { role: 'lead', projectId, threadId: 'none', sessionId: 'none', taskId: null }
      assert.strictEqual(
        yield* callTool(coordinator, 'keep_run', { name: 'Storybook', command: 'npm run storybook' }),
        'Kept: Storybook runs with `npm run storybook`. What the project runs, the first by default:\n- npm run dev (' +
          (yield* launches.runnables(projectId, null))[0]?.repository +
          "'s own way to run)\n- Storybook: `npm run storybook`",
      )
      assert.deepInclude((yield* launches.runnables(projectId, null))[1], { name: 'Storybook', from: 'coordinator' })
      // Kept again by a lead under the same name, it changes, and is the lead's.
      assert.match(
        yield* callTool(lead, 'keep_run', { name: 'storybook', command: 'node storybook.js' }),
        /^Kept: storybook runs with `node storybook\.js`/,
      )
      assert.deepInclude((yield* launches.runnables(projectId, null))[1], {
        name: 'storybook',
        command: 'node storybook.js',
        from: 'agent',
      })
      // The coordinator runs it by name, and is given its address.
      assert.match(
        yield* callTool(coordinator, 'run_project', { run: 'Storybook' }),
        /^Running `node storybook\.js` in a fresh copy of the default branch, at http:\/\/localhost:6199\/\./,
      )
      assert.match(
        yield* callTool(coordinator, 'run_project', { run: 'Docs' }),
        /^The project runs nothing called Docs\. What the project runs/,
      )
      // A null command drops it; nothing by that name, or no name, is said.
      assert.match(
        yield* callTool(coordinator, 'keep_run', { name: 'Storybook', command: null }),
        /^Dropped Storybook\. What the project runs, the first by default:\n- npm run dev/,
      )
      assert.match(yield* callTool(coordinator, 'keep_run', { name: 'Storybook', command: null }), /runs nothing called Storybook/)
      assert.match(yield* callTool(coordinator, 'keep_run', { name: ' ', command: 'x' }), /Give it a name/)
      for (const running of yield* launches.ofProject(projectId)) yield* launches.stop(running.id)
    }).pipe(Effect.provide(withQueries())),
  )
})
