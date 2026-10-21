import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import type { Screenshot, Shot } from '../src/Config'
import { Instance } from '../src/Instance'
import { Launches } from '../src/Launches'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { isLocal, mayDraw, shotOf, shotWords } from '../src/screenshots'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, callToolWhole, items, listTools, repository, runtime, until } from './support'

/*
 * What a lead does outside its sandbox through Althar, rather than around it:
 * its worktree's setup run again, as when the worktree was made (ADR-023);
 * the project run in its worktree and stopped, as the run the person sees in
 * the Running pill (ADR-044); and a screenshot of a page on this computer,
 * which the coordinator takes too.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd })

/** A server that says where it answers, as Vite does, and keeps running. */
const SERVE = "console.log('  VITE ready')\nconsole.log('  ➜  Local:   http://localhost:5199/')\nsetInterval(() => {}, 1000)\n"

/** A repository whose package.json runs a server, and Storybook beside it. */
const served = () => {
  const path = repository()
  writeFileSync(
    join(path, 'package.json'),
    JSON.stringify({ name: 'meridian', scripts: { dev: 'node serve.js', storybook: 'node serve.js' } }),
  )
  writeFileSync(join(path, 'serve.js'), SERVE)
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', 'Serve')
  return path
}

/** Opens a repository as a project, keeping a setup for it where one is given, and makes a task in it, whose lead's access it gives. */
const taskIn = (path: string, setup?: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
    if (setup !== undefined)
      yield* (yield* Launches).keep({
        projectId: project.projectId,
        run: { command: 'node serve.js', setup },
        actorId: (yield* Instance).personId,
      })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title: 'Retry checkout' }),
      projectId: project.projectId,
      title: 'Retry checkout',
    })
    const lead: ToolAccess = {
      role: 'lead',
      projectId: project.projectId,
      threadId: task.threadId,
      sessionId: 'none',
      taskId: task.taskId,
    }
    const coordinator: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId: 'none', sessionId: 'none', taskId: null }
    return { project, task, lead, coordinator }
  })

/** How each of a task's worktrees was set up, where it has been. */
const setUps = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ setup: string | null }>`SELECT setup FROM workspaces WHERE task_id = ${taskId} ORDER BY rowid`
    return rows.map((row) => (row.setup === null ? null : (JSON.parse(row.setup) as Record<string, unknown>)))
  })

const setupItems = (threadId: string) =>
  Effect.map(items(threadId), (rows) => rows.flatMap((row) => (row.kind === 'setup' ? [row.content] : [])))

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('install_dependencies', () => {
  // Counts its runs in the worktree, and fails from its third, saying why as an install would.
  const SETUP = `node -e "const f='installs.txt';const fs=require('fs');const n=(fs.existsSync(f)?Number(fs.readFileSync(f,'utf8')):0)+1;fs.writeFileSync(f,String(n));console.log('added 12 packages, run '+n);if(n>2){console.error('npm ERR! EACCES: permission denied');process.exit(3)}"`

  it.live(
    'runs the kept setup again in the lead’s worktree, outside its sandbox, and says how it went with the end of what it printed',
    () =>
      Effect.gen(function* () {
        const { task, lead } = yield* taskIn(repository(), SETUP)
        yield* until(setUps(task.taskId), (rows) => rows.length > 0 && rows.every((row) => row !== null), Duration.seconds(30))
        assert.strictEqual(readFileSync(join(task.worktree, 'installs.txt'), 'utf8'), '1')

        // As it ran when the worktree was made: the kept setup, which went through, with what it printed.
        const again = yield* callTool(lead, 'install_dependencies', {})
        assert.strictEqual(
          again,
          `Althar ran \`${SETUP}\` in the worktree, outside your sandbox, and it went through. The end of what it printed:\n\`\`\`\nadded 12 packages, run 2\n\`\`\``,
        )
        assert.strictEqual(readFileSync(join(task.worktree, 'installs.txt'), 'utf8'), '2')
        // The thread shows each, as the person sees the first; the workspace keeps the last.
        const shown = yield* setupItems(task.threadId)
        assert.lengthOf(shown, 2)
        assert.deepInclude((shown[1]?.ended ?? {}) as object, { code: 0, timedOut: false })

        // One that fails says how, and what it printed last, stderr too.
        const failed = yield* callTool(lead, 'install_dependencies', {})
        assert.include(failed, 'outside your sandbox, and it failed with exit code 3.')
        assert.include(failed, 'added 12 packages, run 3\nnpm ERR! EACCES: permission denied')
        const [kept] = yield* setUps(task.taskId)
        assert.deepInclude(kept ?? {}, { command: SETUP, code: 3 })
      }).pipe(Effect.provide(runtime())),
  )

  it.live('says where there is nothing to install, or no such repository, and is refused off a task', () =>
    Effect.gen(function* () {
      // Nothing to install: no setup kept, and no manifest.
      const bare = yield* taskIn(repository())
      yield* until(setUps(bare.task.taskId), (rows) => rows.every((row) => row !== null), Duration.seconds(30))
      assert.match(
        yield* callTool(bare.lead, 'install_dependencies', {}),
        /^The repository has no setup kept, and nothing Althar can tell to install/,
      )
      // A repository named that the task hasn't.
      assert.match(
        yield* callTool(bare.lead, 'install_dependencies', { repository: 'web' }),
        /^This task has no worktree of a repository called web\. Its repositories: /,
      )
      // Only a task's lead has a worktree to set up.
      assert.strictEqual(yield* callTool(bare.coordinator, 'install_dependencies', {}), 'Althar has no tool called install_dependencies.')
      assert.strictEqual(yield* callTool({ ...bare.lead, taskId: null }, 'install_dependencies', {}), 'This tool is for a task’s lead.')
    }).pipe(Effect.provide(runtime())),
  )
})

describe('run_project and stop_project, for a lead', () => {
  const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

  it.live('runs the project in the lead’s worktree as the person’s run, shown in its thread, and stops only its task’s runs', () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const queries = yield* Queries
      const { project, task, lead, coordinator } = yield* taskIn(served())
      const projectId = project.projectId

      assert.strictEqual(yield* callTool(lead, 'stop_project', {}), 'Nothing runs in your worktree, so there was nothing to stop.')
      // Its default, in its worktree, once it says where it answers.
      const ran = yield* callTool(lead, 'run_project', {})
      assert.match(ran, /^Running `npm run dev` in your worktree, at http:\/\/localhost:5199\/\. Read it there, or take a screenshot of it/)
      const [running] = yield* launches.ofProject(projectId)
      assert.deepInclude(running, { taskId: task.taskId, where: 'Retry checkout', url: 'http://localhost:5199/' })
      // The same run the person sees: its card in the task's thread, in the pill with the project's runs.
      const { items: shown } = yield* Effect.orDie(queries.thread(task.threadId))
      assert.deepInclude(shown.find((item) => item.kind === 'run')?.content ?? {}, { taskId: task.taskId, url: 'http://localhost:5199/' })
      // Asked again, the run already going is the one there is.
      assert.match(yield* callTool(lead, 'run_project', {}), /^Running `npm run dev` in your worktree/)
      assert.lengthOf(yield* launches.ofProject(projectId), 1)
      // Another of the things it runs, by name; and one it doesn't, with what it does.
      assert.match(
        yield* callTool(lead, 'run_project', { run: 'nothing' }),
        /^The project runs nothing called nothing\. What the project runs/,
      )

      // The default branch's run is the coordinator's and the person's: the lead's stop leaves it.
      assert.match(yield* callTool(coordinator, 'run_project', {}), /in a fresh copy of the default branch/)
      assert.lengthOf(yield* launches.ofProject(projectId), 2)
      assert.match(
        yield* callTool(lead, 'stop_project', { run: 'storybook' }),
        /^Nothing called storybook runs in your worktree\. What runs there: npm run dev\.$/,
      )
      assert.strictEqual(yield* callTool(lead, 'stop_project', {}), 'Stopped `npm run dev` in your worktree.')
      const left = yield* launches.ofProject(projectId)
      assert.deepStrictEqual(
        left.map((launch) => launch.taskId),
        [null],
      )
      // Its process is gone, as when the person stops it.
      const sql = yield* SqlClient.SqlClient
      const [stopped] = yield* sql<{ state: string; pid: number }>`SELECT state, pid FROM processes WHERE id = ${running?.id ?? ''}`
      assert.strictEqual(stopped?.state, 'killed')
      yield* until(
        Effect.sync(() => (alive(stopped?.pid ?? 0) ? [stopped] : [])),
        (up) => up.length === 0,
      )
      for (const one of left) yield* launches.stop(one.id)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('says how a run that ended at once ended, for the lead to fix; and is a lead’s only', () =>
    Effect.gen(function* () {
      const { lead } = yield* taskIn(repository())
      yield* callTool(lead, 'set_run_command', { command: `node -e "console.log('Error: Cannot find module vite'); process.exit(1)"` })
      const ended = yield* callTool(lead, 'run_project', {})
      assert.match(
        ended,
        /in your worktree ended at once, with exit code 1\. Its last lines:\n\nError: Cannot find module vite\n\nFix what stopped it/,
      )
      assert.strictEqual(yield* callTool({ ...lead, taskId: null }, 'run_project', {}), 'This tool is for a task’s lead.')
      assert.strictEqual(yield* callTool({ ...lead, taskId: null }, 'stop_project', {}), 'This tool is for a task’s lead.')
      const listed = yield* listTools(lead)
      for (const name of ['install_dependencies', 'run_project', 'stop_project', 'screenshot', 'rerun_check']) assert.include(listed, name)
    }).pipe(Effect.provide(runtime())),
  )
})

describe('screenshot', () => {
  it('takes only a page served on this computer, or by a run Althar started, over http, at a viewport kept within a screen', () => {
    for (const host of ['localhost', 'app.localhost', '127.0.0.1', '127.1.2.3', '[::1]', '0.0.0.0']) assert.isTrue(isLocal(host), host)
    for (const host of ['example.com', 'localhost.example.com', '10.0.0.4', '192.168.1.2']) assert.isFalse(isLocal(host), host)

    assert.deepStrictEqual(shotOf({ url: 'localhost:5173/settings' }, []), {
      url: 'http://localhost:5173/settings',
      width: 1280,
      height: 800,
      fullPage: false,
      selector: null,
      origins: [],
    })
    assert.deepStrictEqual(shotOf({ url: 'http://127.0.0.1:6006/', width: 99_999, height: 10, full_page: true, selector: ' main ' }, []), {
      url: 'http://127.0.0.1:6006/',
      width: 3840,
      height: 160,
      fullPage: true,
      selector: 'main',
      origins: [],
    })
    // A run that answers by this computer's name is Althar's, so it is taken.
    assert.deepInclude(shotOf({ url: 'http://studio.lan:3000/a' }, ['http://studio.lan:3000/']) as object, {
      url: 'http://studio.lan:3000/a',
      origins: ['http://studio.lan:3000'],
    })
    // What the page goes on to is held to the same: this computer, or the runs' origins.
    assert.isTrue(mayDraw('http://localhost:6006/iframe.html', []))
    assert.isTrue(mayDraw('http://studio.lan:3000/b', ['http://studio.lan:3000']))
    assert.isFalse(mayDraw('http://studio.lan:4000/', ['http://studio.lan:3000']))
    assert.isFalse(mayDraw('https://example.com/', []))
    assert.isFalse(mayDraw('file:///etc/hosts', []))
    assert.strictEqual(
      shotOf({ url: 'https://example.com/' }, ['http://studio.lan:3000/']),
      "Althar takes screenshots only of what is served on this computer, such as a run's or a dev server's on localhost: not example.com.",
    )
    assert.match(shotOf({ url: 'file:///etc/hosts' }, []) as string, /web pages only, over http: not file: addresses/)
    assert.strictEqual(shotOf({}, []), 'Give the url of the page, such as http://localhost:5173/.')
    assert.strictEqual(shotOf({ url: 'http://' }, []), "http:// isn't an address Althar can open.")

    const shot: Shot = { url: 'http://localhost:5173/', width: 800, height: 600, fullPage: false, selector: '#plan', origins: [] }
    assert.strictEqual(
      shotWords(shot, { width: 320, height: 120, title: 'Meridian' }),
      'A screenshot of http://localhost:5173/ ("Meridian"), the element #plan, at a 800×600 viewport: 320×120 pixels, at 1×.',
    )
    assert.strictEqual(
      shotWords({ ...shot, selector: null, fullPage: true }, { width: 800, height: 2400, title: '' }),
      'A screenshot of http://localhost:5173/, the whole page, at a 800×600 viewport: 800×2400 pixels, at 1×.',
    )
  })

  /** A PNG of one pixel, as the main process would send one back. */
  const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  it.live('gives the coordinator and a lead the picture Althar took, with what it is of; and says why where it couldn’t', () => {
    const asked: Array<Shot> = []
    const screenshot = (shot: Shot) =>
      shot.url.includes('/down')
        ? Effect.fail('the page didn’t load: ERR_CONNECTION_REFUSED')
        : Effect.sync((): Screenshot => {
            asked.push(shot)
            return { png: PIXEL, width: shot.width, height: shot.height, title: 'Meridian' }
          })
    return Effect.gen(function* () {
      const { lead, coordinator } = yield* taskIn(repository())
      assert.include(yield* listTools(coordinator), 'screenshot')
      const taken = yield* callToolWhole(coordinator, 'screenshot', { url: 'http://localhost:5173/settings', width: 800, height: 600 })
      assert.isFalse(taken.isError)
      assert.deepStrictEqual(taken.content, [
        {
          type: 'text',
          text: 'A screenshot of http://localhost:5173/settings ("Meridian"), at a 800×600 viewport: 800×600 pixels, at 1×.',
        },
        { type: 'image', data: PIXEL, mimeType: 'image/png' },
      ])
      const byLead = yield* callToolWhole(lead, 'screenshot', { url: 'localhost:6006', full_page: true, selector: '#root' })
      assert.strictEqual(byLead.content[1]?.type, 'image')
      assert.deepStrictEqual(asked, [
        { url: 'http://localhost:5173/settings', width: 800, height: 600, fullPage: false, selector: null, origins: [] },
        { url: 'http://localhost:6006/', width: 1280, height: 800, fullPage: true, selector: '#root', origins: [] },
      ])
      // A page out on the internet isn't taken; one that won't load says why.
      const outside = yield* callToolWhole(lead, 'screenshot', { url: 'https://example.com' })
      assert.isTrue(outside.isError)
      assert.match(String(outside.content[0]?.text), /only of what is served on this computer/)
      assert.strictEqual(
        yield* callTool(lead, 'screenshot', { url: 'http://localhost:1/down' }),
        'Althar couldn’t take it: the page didn’t load: ERR_CONNECTION_REFUSED',
      )
      assert.lengthOf(asked, 2)
    }).pipe(Effect.provide(runtime(undefined, undefined, { screenshot })))
  })

  it.live('says this Althar can’t take one where nothing draws pages, as on the command line', () =>
    Effect.gen(function* () {
      const { coordinator } = yield* taskIn(repository())
      assert.strictEqual(
        yield* callTool(coordinator, 'screenshot', { url: 'http://localhost:5173/' }),
        'This Althar can’t take screenshots: only the desktop app draws pages.',
      )
    }).pipe(Effect.provide(runtime())),
  )
})
