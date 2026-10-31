import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { copyablePath, copyInto, lineOf, type Recorded, recordedOf, type SetUp } from '../src/Setups'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, items, repository, runtime, until } from './support'

/*
 * A repository's setup as its first lead works it out (ADR-023): nobody
 * writes one. Where none is recorded, the lead is asked to get its folder
 * ready and to record what worked with record_setup; Althar keeps it on the
 * repository and replays it in every later task's worktree before its lead
 * starts, copying the ignored files it names from the person's checkout and
 * running its commands one after another. A replay that fails reaches the
 * lead, which records the setup that works, replacing the old one.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd, encoding: 'utf8' })

/** A repository that ignores `.env`, with one in the person's checkout. */
const withEnv = () => {
  const path = repository()
  writeFileSync(join(path, '.gitignore'), '.env\nran.txt\n')
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', 'Ignore .env')
  writeFileSync(join(path, '.env'), 'API_KEY=local\n')
  return path
}

/** A command that adds its word to `ran.txt` in the folder it runs in, and fails where told. */
const step = (word: string, fails = false) =>
  `node -e "require('fs').appendFileSync('ran.txt','${word}\\n')${fails ? `;console.error('${word} failed');process.exit(4)` : ''}"`

/** Opens a repository as a project where it isn't yet, and makes a task in it, whose lead's access it gives. */
const taskIn = (path: string, title = 'Retry checkout') =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId: project.projectId,
      title,
    })
    const lead: ToolAccess = { role: 'lead', projectId: project.projectId, threadId: task.threadId, sessionId: 'none', taskId: task.taskId }
    return { project, task, lead }
  })

/** How the task's worktree was set up, once it has been. */
const setUpOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* until(
      sql<{ setup: string | null }>`SELECT setup FROM workspaces WHERE task_id = ${taskId}`,
      (rows) => rows.length > 0 && rows.every((one) => one.setup !== null),
    )
    return JSON.parse(row?.setup ?? 'null') as SetUp
  })

/** The setup the project's repository has recorded. */
const recordedIn = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{
      recordedSetup: string | null
    }>`SELECT recorded_setup FROM repository_bindings WHERE project_id = ${projectId}`
    return recordedOf(row?.recordedSetup ?? null)
  })

/** Starts a lead on the task's thread, and gives its first turn, its brief. */
const brief = (threadId: string) =>
  Effect.gen(function* () {
    yield* (yield* Sessions).start({ threadId, agentId: 'claude-code' })
    const sql = yield* SqlClient.SqlClient
    const [first] = yield* until(
      sql<{ prompt: string | null }>`SELECT prompt FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at, id`,
      (rows) => rows.length > 0,
    )
    return first?.prompt ?? ''
  })

const setupItems = (threadId: string) =>
  Effect.map(items(threadId), (rows) => rows.flatMap((row) => (row.kind === 'setup' ? [row.content] : [])))

describe('a setup a lead records', () => {
  it.live('is asked for where none is recorded, copies the files it names into the lead’s folder at once, and is kept', () =>
    Effect.gen(function* () {
      const path = withEnv()
      const first = yield* taskIn(path)
      yield* setUpOf(first.task.taskId)
      // Asked of the first lead, which reads where the person's checkout is.
      const said = yield* brief(first.task.threadId)
      assert.include(said, 'No setup is recorded for the repository yet, so get the worktree ready to work in before anything else')
      assert.include(said, `copy the ignored files it needs from the person's checkout at ${realpathSync(path)}, such as \`.env\``)
      assert.include(said, 'record what worked with record_setup')
      assert.isFalse(existsSync(join(first.task.worktree, '.env')))

      const recorded = yield* callTool(first.lead, 'record_setup', { copy: ['.env', './.env'], commands: [' bun install ', step('one')] })
      assert.strictEqual(
        recorded,
        `Recorded ${basename(path)}'s setup: Althar gets every later task's folder ready with it before its lead starts. In your folder now: Copied .env.`,
      )
      assert.strictEqual(readFileSync(join(first.task.worktree, '.env'), 'utf8'), 'API_KEY=local\n')
      assert.deepInclude((yield* recordedIn(first.project.projectId)) ?? {}, {
        copy: ['.env'],
        commands: ['bun install', step('one')],
        taskId: first.task.taskId,
      })
    }).pipe(Effect.provide(runtime())),
  )

  it.live('is refused with nothing in it, a file outside the repository, or off a task', () =>
    Effect.gen(function* () {
      const { lead } = yield* taskIn(withEnv())
      assert.match(yield* callTool(lead, 'record_setup', { commands: [] }), /^Give the commands that got the folder ready/)
      assert.match(yield* callTool(lead, 'record_setup', { copy: ['../secrets.env'], commands: [] }), /^Name each file to copy/)
      assert.match(yield* callTool(lead, 'record_setup', { copy: ['.git/config'], commands: ['make'] }), /^Name each file to copy/)
      assert.match(yield* callTool({ ...lead, taskId: null }, 'record_setup', { commands: ['make'] }), /^This tool is for a task’s lead/)
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a recorded setup in a later task', () => {
  it.live('copies its files and runs its commands in order before the lead starts, and the lead is told it went through', () =>
    Effect.gen(function* () {
      const path = withEnv()
      const first = yield* taskIn(path)
      yield* setUpOf(first.task.taskId)
      yield* callTool(first.lead, 'record_setup', { copy: ['.env'], commands: [step('one'), step('two')] })

      const later = yield* taskIn(path, 'Refund over budget')
      const setUp = yield* setUpOf(later.task.taskId)
      assert.deepInclude(setUp, { command: `${step('one')}\n${step('two')}`, code: 0, timedOut: false })
      assert.isUndefined(setUp.missing)
      assert.include(setUp.last ?? '', 'Copied .env')
      assert.strictEqual(readFileSync(join(later.task.worktree, '.env'), 'utf8'), 'API_KEY=local\n')
      assert.strictEqual(readFileSync(join(later.task.worktree, 'ran.txt'), 'utf8'), 'one\ntwo\n')
      // The thread shows it as installing, which the card says too, with what it did kept for the fold.
      const [item] = yield* setupItems(later.task.threadId)
      assert.deepInclude(item, { kept: false })
      assert.include(String((item?.ended as { last?: string } | null)?.last), 'Copied .env')
      // Told it went through, and not asked to record one.
      const said = yield* brief(later.task.threadId)
      assert.include(said, "Althar set it up with the repository's recorded setup, and that went through")
      assert.notInclude(said, 'No setup is recorded')
    }).pipe(Effect.provide(runtime())),
  )

  it.live(
    'that fails stops at the command that failed, starts the lead all the same, told what failed, and its correction replaces it',
    () =>
      Effect.gen(function* () {
        const path = withEnv()
        const first = yield* taskIn(path)
        yield* setUpOf(first.task.taskId)
        yield* callTool(first.lead, 'record_setup', { copy: ['.env'], commands: [step('one'), step('two', true), step('three')] })

        const later = yield* taskIn(path, 'Refund over budget')
        const setUp = yield* setUpOf(later.task.taskId)
        assert.deepInclude(setUp, { code: 4 })
        // What came after the one that failed never ran; the files were copied all the same.
        assert.strictEqual(readFileSync(join(later.task.worktree, 'ran.txt'), 'utf8'), 'one\ntwo\n')
        assert.isTrue(existsSync(join(later.task.worktree, '.env')))
        const said = yield* brief(later.task.threadId)
        assert.include(said, "Althar set it up with the repository's recorded setup, and it failed with exit code 4.")
        assert.include(said, 'two failed')
        assert.include(said, 'record the setup that works with record_setup: it replaces the one that failed, for every later task')

        // The lead's correction replaces it, and the next task gets that alone.
        yield* callTool(later.lead, 'record_setup', { commands: [step('fixed')] })
        assert.deepInclude((yield* recordedIn(later.project.projectId)) ?? {}, {
          copy: [],
          commands: [step('fixed')],
          taskId: later.task.taskId,
        })
        const next = yield* taskIn(path, 'Partner budget')
        assert.deepInclude(yield* setUpOf(next.task.taskId), { code: 0 })
        assert.strictEqual(readFileSync(join(next.task.worktree, 'ran.txt'), 'utf8'), 'fixed\n')
        assert.isFalse(existsSync(join(next.task.worktree, '.env')))
      }).pipe(Effect.provide(runtime())),
  )
})

describe('a recorded setup’s files', () => {
  it.live('that are gone from the checkout fail the setup, and the lead is told which, though its commands went through', () =>
    Effect.gen(function* () {
      const path = withEnv()
      const first = yield* taskIn(path)
      yield* setUpOf(first.task.taskId)
      yield* callTool(first.lead, 'record_setup', { copy: ['.env', 'config/local.yml'], commands: [step('one')] })

      const later = yield* taskIn(path, 'Refund over budget')
      const setUp = yield* setUpOf(later.task.taskId)
      assert.deepInclude(setUp, { code: 0, missing: ['config/local.yml'] })
      assert.include(setUp.last ?? '', 'Copied .env\nNot in the checkout: config/local.yml')
      const [item] = yield* setupItems(later.task.threadId)
      assert.deepInclude((item?.ended ?? {}) as object, { code: 0, missing: ['config/local.yml'] })
      const said = yield* brief(later.task.threadId)
      assert.include(said, "Althar set it up with the repository's recorded setup, and it couldn't copy `config/local.yml`.")
      assert.include(said, 'Not in the checkout: config/local.yml')
      assert.include(said, 'record the setup that works with record_setup')
    }).pipe(Effect.provide(runtime())),
  )

  it.effect('are never copied through a link out of the task’s folder, nor over or into what it has', () =>
    Effect.gen(function* () {
      const checkout = mkdtempSync(join(tmpdir(), 'althar-checkout-'))
      mkdirSync(join(checkout, 'config'))
      writeFileSync(join(checkout, 'config', 'local.env'), 'SECRET=1\n')
      writeFileSync(join(checkout, '.env'), 'API_KEY=local\n')
      const worktree = mkdtempSync(join(tmpdir(), 'althar-worktree-'))
      const elsewhere = mkdtempSync(join(tmpdir(), 'althar-elsewhere-'))
      // A commit can make a folder of the worktree a link to anywhere.
      symlinkSync(elsewhere, join(worktree, 'config'))
      writeFileSync(join(worktree, '.env'), 'API_KEY=the task’s\n')
      const { said, missing } = yield* copyInto(checkout, worktree, ['config/local.env', '.env'])
      assert.deepStrictEqual(missing, ['config/local.env'])
      assert.deepStrictEqual(said, ["Not copied, as it leads outside the task's folder: config/local.env", 'Already there: .env'])
      assert.deepStrictEqual(readdirSync(elsewhere), [])
      assert.strictEqual(readFileSync(join(worktree, '.env'), 'utf8'), 'API_KEY=the task’s\n')
    }),
  )
})

describe('how a recorded setup reads', () => {
  it('runs its commands one after another, each on its own, stopping at the first that fails', () => {
    assert.strictEqual(lineOf(['a', 'b'], 'darwin'), '(\na\n) || exit $?\n(\nb\n) || exit $?')
    assert.strictEqual(lineOf(['a', 'b'], 'win32'), '(a) && (b)')
  })

  it('copies only from inside the repository, never its .git', () => {
    assert.strictEqual(copyablePath('./apps/web/.env.local'), 'apps/web/.env.local')
    assert.strictEqual(copyablePath('config/'), 'config')
    for (const outside of ['', '.', '/etc/passwd', '../x', 'a/../../x', '.git', '.git/config', 'C:\\x'])
      assert.isNull(copyablePath(outside), outside)
  })

  it('is none where its column can’t be read', () => {
    assert.isNull(recordedOf(null))
    assert.isNull(recordedOf('{"copy":1}'))
    const recorded: Recorded = { copy: ['.env'], commands: ['make'], at: '2026-10-31T10:00:00.000Z', taskId: null }
    assert.deepStrictEqual(recordedOf(JSON.stringify(recorded)), recorded)
  })
})
