import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { LONGEST_SCRIPT, LONGEST_TEXT, type PageAnswer, type PageCall, WAIT } from '../src/pageBridge'
import { PAGE_TOOLS, type PageToolName, pageCallOf, pageOwnerOf } from '../src/PageTools'
import { Coordinator } from '../src/Coordinator'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, callToolWhole, listTools, repository, runtime, toolsOf } from './support'

/*
 * The page beside a conversation, read and driven by its lead and by the
 * coordinator (ADR-100): one set of tools for both, asking nothing, each
 * turned into a call on the page that the desktop app carries out. Whose page
 * it is comes from the session, never from what the agent says.
 */

/** A project with two tasks, each lead's access, and the coordinator's. */
const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const threadId = yield* (yield* Coordinator).thread(project.projectId)
  const task = (title: string) =>
    Effect.gen(function* () {
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title }),
        projectId: project.projectId,
        title,
        draft: true,
      })
      const lead: ToolAccess = {
        role: 'lead',
        projectId: project.projectId,
        threadId: created.threadId,
        sessionId: 'none',
        taskId: created.taskId,
      }
      return lead
    })
  const first = yield* task('Fix the refunds page')
  const second = yield* task('Say arm64')
  const coordinator: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
  return { project, first, second, coordinator }
})

/** What the host was asked, in order. */
interface Asked {
  readonly owner: string
  readonly call: PageCall
}

/** A host that answers every call with `text`, keeping what it was asked. */
const hosting =
  (asked: Array<Asked>, answer: (call: PageCall) => Effect.Effect<PageAnswer, string> = () => Effect.succeed({ text: 'Done.' })) =>
  (owner: string, call: PageCall) => {
    asked.push({ owner, call })
    return answer(call)
  }

/** A PNG of one pixel, as the main process would send one back. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('what an agent asks of its page', () => {
  const ask = (tool: PageToolName, input: unknown) => pageCallOf(tool, input)

  it('reads each tool’s input as a call, with what it leaves out as the tool’s usual', () => {
    assert.deepStrictEqual(ask('page_state', {}), { op: 'state' })
    assert.deepStrictEqual(ask('page_open', { url: ' localhost:5173/refunds ' }), { op: 'open', url: 'localhost:5173/refunds' })
    assert.deepStrictEqual(ask('page_move', { move: 'reload' }), { op: 'move', move: 'reload' })
    assert.deepStrictEqual(ask('page_viewport', { viewport: 'phone' }), { op: 'viewport', viewport: 'phone' })
    assert.deepStrictEqual(ask('page_snapshot', {}), { op: 'snapshot', target: null })
    assert.deepStrictEqual(ask('page_snapshot', { selector: ' main ' }), { op: 'snapshot', target: { selector: 'main' } })
    assert.deepStrictEqual(ask('page_screenshot', { ref: 'e4', full_page: true }), {
      op: 'screenshot',
      target: { ref: 'e4' },
      fullPage: true,
    })
    assert.deepStrictEqual(ask('page_screenshot', undefined), { op: 'screenshot', target: null, fullPage: false })
    assert.deepStrictEqual(ask('page_logs', {}), { op: 'logs', since: 0, kind: 'all' })
    assert.deepStrictEqual(ask('page_logs', { since: 41.6, kind: 'network' }), { op: 'logs', since: 42, kind: 'network' })
    assert.deepStrictEqual(ask('page_click', { ref: 'e12' }), {
      op: 'click',
      target: { ref: 'e12' },
      button: 'left',
      double: false,
    })
    assert.deepStrictEqual(ask('page_click', { selector: '#save', button: 'right', double: true }), {
      op: 'click',
      target: { selector: '#save' },
      button: 'right',
      double: true,
    })
    assert.deepStrictEqual(ask('page_hover', { ref: 'e2' }), { op: 'hover', target: { ref: 'e2' } })
    assert.deepStrictEqual(ask('page_type', { ref: 'e9', text: 'abc' }), {
      op: 'type',
      target: { ref: 'e9' },
      text: 'abc',
      replace: true,
      submit: false,
    })
    assert.deepStrictEqual(ask('page_type', { ref: 'e9', text: '', replace: false, submit: true }), {
      op: 'type',
      target: { ref: 'e9' },
      text: '',
      replace: false,
      submit: true,
    })
    assert.deepStrictEqual(ask('page_press', { key: ' ControlOrMeta+K ' }), { op: 'press', key: 'ControlOrMeta+K', target: null })
    assert.deepStrictEqual(ask('page_press', { key: 'Enter', ref: 'e9' }), { op: 'press', key: 'Enter', target: { ref: 'e9' } })
    assert.deepStrictEqual(ask('page_scroll', { to: 'bottom' }), { op: 'scroll', target: null, to: 'bottom', by: null })
    assert.deepStrictEqual(ask('page_scroll', { ref: 'e3', by: -300 }), { op: 'scroll', target: { ref: 'e3' }, to: null, by: -300 })
    assert.deepStrictEqual(ask('page_scroll', { ref: 'e3' }), { op: 'scroll', target: { ref: 'e3' }, to: null, by: null })
    assert.deepStrictEqual(ask('page_select', { ref: 'e5', values: ['Euro', 'usd'] }), {
      op: 'select',
      target: { ref: 'e5' },
      values: ['Euro', 'usd'],
    })
    assert.deepStrictEqual(ask('page_wait', { text: 'Saved' }), {
      op: 'wait',
      text: 'Saved',
      gone: null,
      target: null,
      seconds: WAIT.usual,
    })
    assert.deepStrictEqual(ask('page_wait', { gone: 'Loading…', selector: '.done', seconds: 99 }), {
      op: 'wait',
      text: null,
      gone: 'Loading…',
      target: { selector: '.done' },
      seconds: WAIT.most,
    })
    assert.deepStrictEqual(ask('page_wait', { text: 'x', seconds: 0 }), {
      op: 'wait',
      text: 'x',
      gone: null,
      target: null,
      seconds: WAIT.least,
    })
    assert.deepStrictEqual(ask('page_evaluate', { script: 'document.title' }), { op: 'evaluate', script: 'document.title' })
  })

  it('reads a reference as the snapshot prints it', () => {
    for (const written of ['e12', 'E12', ' e12 ', '[ref=e12]', 'ref=e12'])
      assert.deepStrictEqual(ask('page_hover', { ref: written }), { op: 'hover', target: { ref: 'e12' } }, written)
  })

  it('refuses what asks nothing or asks twice, in words', () => {
    assert.strictEqual(ask('page_open', {}), 'Give the url of the page, such as http://localhost:5173/.')
    assert.strictEqual(ask('page_open', { url: '   ' }), 'Give the url of the page, such as http://localhost:5173/.')
    assert.strictEqual(ask('page_open', { url: 5 }), 'url should be text.')
    assert.strictEqual(ask('page_move', { move: 'sideways' }), 'move should be one of back, forward, reload, stop.')
    assert.strictEqual(ask('page_move', {}), 'Say how to move: back, forward, reload, stop.')
    assert.strictEqual(ask('page_viewport', { viewport: 'watch' }), 'viewport should be one of fit, desktop, laptop, tablet, phone.')
    assert.strictEqual(ask('page_viewport', {}), 'Say which viewport: fit, desktop, laptop, tablet, phone.')
    assert.strictEqual(ask('page_click', {}), 'Say which element: its ref from page_snapshot, such as e12, or a CSS selector.')
    assert.strictEqual(ask('page_click', { ref: 'e1', selector: 'a' }), 'Name the element by ref or by selector, not both.')
    assert.strictEqual(
      ask('page_click', { ref: 'button' }),
      'button isn’t a reference. Take one from page_snapshot, such as e12, or give a selector.',
    )
    assert.strictEqual(ask('page_click', { ref: 'e1', button: 'back' }), 'button should be one of left, right, middle.')
    assert.strictEqual(ask('page_click', { ref: 'e1', double: 'yes' }), 'double should be true or false.')
    assert.strictEqual(ask('page_type', { ref: 'e1' }), 'Give the text to type.')
    assert.strictEqual(ask('page_type', { text: 'x' }), 'Say which element: its ref from page_snapshot, such as e12, or a CSS selector.')
    assert.match(
      ask('page_type', { ref: 'e1', text: 'x'.repeat(LONGEST_TEXT + 1) }) as string,
      /^text is 20001 characters long; at most 20,000/,
    )
    assert.strictEqual(ask('page_press', {}), 'Say which key, such as Enter, Escape or Control+A.')
    assert.match(ask('page_press', { key: 'a\nb' }) as string, /^key should be a key’s name/)
    assert.match(ask('page_scroll', {}) as string, /^Say where to scroll: to \(top, bottom, up or down\)/)
    assert.strictEqual(ask('page_scroll', { to: 'top', by: 10 }), 'Give to or by, not both.')
    assert.strictEqual(ask('page_scroll', { to: 'left' }), 'to should be one of top, bottom, up, down.')
    assert.strictEqual(ask('page_scroll', { by: 'far' }), 'by should be a number.')
    assert.strictEqual(ask('page_select', { ref: 'e1' }), 'Give values: the text or value of each option to choose.')
    assert.strictEqual(ask('page_select', { ref: 'e1', values: [] }), 'Give values: the text or value of each option to choose.')
    assert.strictEqual(ask('page_select', { ref: 'e1', values: ['a', 3] }), 'Each of values should be some text of at most 500 characters.')
    assert.strictEqual(
      ask('page_wait', {}),
      'Say what to wait for: text that shows, gone for text that goes, or an element by ref or selector.',
    )
    assert.strictEqual(
      ask('page_wait', { seconds: 5 }),
      'Say what to wait for: text that shows, gone for text that goes, or an element by ref or selector.',
    )
    assert.strictEqual(ask('page_evaluate', {}), 'Give the script to run.')
    assert.strictEqual(ask('page_evaluate', { script: '  ' }), 'Give the script to run.')
    assert.match(ask('page_evaluate', { script: 'x'.repeat(LONGEST_SCRIPT + 1) }) as string, /^script is 20001 characters long/)
    assert.strictEqual(ask('page_logs', { kind: 'all', since: 'then' }), 'since should be a number.')
  })

  it('belongs to the lead of a task and to the coordinator of a project, and to nobody else', () => {
    const base = { projectId: 'proj_a', threadId: 'thr_a', sessionId: 's' }
    assert.strictEqual(pageOwnerOf({ ...base, role: 'lead', taskId: 'task_a' }), 'task_a')
    assert.strictEqual(pageOwnerOf({ ...base, role: 'lead', taskId: null }), null)
    assert.strictEqual(pageOwnerOf({ ...base, role: 'coordinator', taskId: null }), 'proj_a')
    assert.strictEqual(pageOwnerOf({ ...base, role: 'reviewer', taskId: 'task_a' }), null)
  })
})

describe('the page tools', () => {
  it.live('are the lead’s and the coordinator’s, asking nothing, and no reviewer’s', () =>
    Effect.gen(function* () {
      const { first, coordinator } = yield* opened
      for (const access of [first, coordinator]) {
        const listed = yield* listTools(access)
        for (const name of PAGE_TOOLS) assert.include(listed, name, `${access.role} lacks ${name}`)
      }
      // A reviewer only reads what it is given: the page is its lead’s.
      const reviewer = yield* listTools({ ...first, role: 'reviewer' })
      for (const name of PAGE_TOOLS) assert.notInclude(reviewer, name)
      // Each says what it is; the whole set stays small, as every agent carries it.
      const tools = (yield* toolsOf(first)).filter((tool) => (PAGE_TOOLS as ReadonlyArray<string>).includes(tool.name))
      assert.lengthOf(tools, PAGE_TOOLS.length)
      for (const tool of tools) assert.isAbove(tool.description.length, 40, tool.name)
      assert.isBelow(
        tools.reduce((all, tool) => all + tool.description.length, 0),
        8_000,
      )
      // Neither names a task or a project: whose page it is isn’t the agent’s to say.
      for (const tool of tools) {
        for (const property of tool.properties) assert.notMatch(property, /task|project|owner|thread/i, `${tool.name} takes ${property}`)
      }
    }).pipe(Effect.provide(runtime())),
  )

  it.live('reach the lead’s own task’s page and the coordinator’s project’s, whatever the agent says', () => {
    const asked: Array<Asked> = []
    return Effect.gen(function* () {
      const { project, first, second, coordinator } = yield* opened
      assert.strictEqual(yield* callTool(first, 'page_snapshot', {}), 'Done.')
      assert.strictEqual(yield* callTool(second, 'page_snapshot', {}), 'Done.')
      assert.strictEqual(yield* callTool(coordinator, 'page_snapshot', {}), 'Done.')
      // An agent that names another task, or a project, is not heard.
      yield* callTool(first, 'page_click', {
        ref: 'e1',
        task: second.taskId,
        taskId: second.taskId,
        owner: second.taskId,
        project: project.projectId,
      })
      yield* callTool(second, 'page_open', { url: 'localhost:5173', owner: first.taskId, task_id: first.taskId })
      yield* callTool(coordinator, 'page_hover', { ref: 'e1', task: first.taskId, owner: first.taskId })
      assert.deepStrictEqual(
        asked.map((one) => one.owner),
        [first.taskId, second.taskId, project.projectId, first.taskId, second.taskId, project.projectId],
      )
      assert.deepStrictEqual(asked[3]?.call, { op: 'click', target: { ref: 'e1' }, button: 'left', double: false })
      assert.deepStrictEqual(asked[4]?.call, { op: 'open', url: 'localhost:5173' })
      assert.deepStrictEqual(asked[5]?.call, { op: 'hover', target: { ref: 'e1' } })
    }).pipe(Effect.provide(runtime(undefined, undefined, { page: hosting(asked) })))
  })

  it.live('refuse a lead with no task of its own, and an input that asks nothing, without asking the page', () => {
    const asked: Array<Asked> = []
    return Effect.gen(function* () {
      const { first } = yield* opened
      assert.strictEqual(
        yield* callTool({ ...first, taskId: null }, 'page_snapshot', {}),
        'You have no task of your own, so there is no page beside you.',
      )
      assert.strictEqual(
        yield* callTool(first, 'page_click', {}),
        'Say which element: its ref from page_snapshot, such as e12, or a CSS selector.',
      )
      assert.strictEqual(
        yield* callTool(first, 'page_wait', { seconds: 3 }),
        'Say what to wait for: text that shows, gone for text that goes, or an element by ref or selector.',
      )
      const refused = yield* callToolWhole(first, 'page_open', {})
      assert.isTrue(refused.isError)
      assert.deepStrictEqual(asked, [])
    }).pipe(Effect.provide(runtime(undefined, undefined, { page: hosting(asked) })))
  })

  it.live('say plainly where nothing carries them to a page, as on the command line', () =>
    Effect.gen(function* () {
      const { first, coordinator } = yield* opened
      for (const access of [first, coordinator]) {
        const refused = yield* callToolWhole(access, 'page_state', {})
        assert.isTrue(refused.isError)
        assert.deepStrictEqual(refused.content, [{ type: 'text', text: 'This Althar can’t drive pages: only the desktop app has them.' }])
      }
    }).pipe(Effect.provide(runtime())),
  )

  it.live('say a task that is done, or a project that was removed, has no page, without asking one', () => {
    const asked: Array<Asked> = []
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { project, first, second, coordinator } = yield* opened
      assert.strictEqual(yield* callTool(first, 'page_state', {}), 'Done.')
      yield* sql`UPDATE tasks SET state = 'done' WHERE id = ${first.taskId}`
      assert.strictEqual(yield* callTool(first, 'page_state', {}), 'This task is done, so its page is closed.')
      yield* sql`UPDATE tasks SET state = 'abandoned' WHERE id = ${second.taskId}`
      assert.strictEqual(yield* callTool(second, 'page_open', { url: 'localhost:5173' }), 'This task is done, so its page is closed.')
      assert.strictEqual(yield* callTool(coordinator, 'page_state', {}), 'Done.')
      yield* (yield* Projects).remove(project.projectId)
      assert.strictEqual(yield* callTool(coordinator, 'page_state', {}), 'This project was removed, so its page is closed.')
      assert.deepStrictEqual(
        asked.map((one) => one.owner),
        [first.taskId, project.projectId],
      )
    }).pipe(Effect.provide(runtime(undefined, undefined, { page: hosting(asked) })))
  })

  it.live('pass on what the page’s host says it can’t do, as it says it', () => {
    const asked: Array<Asked> = []
    const words = 'Althar has no window open, so there is no page beside this task. Open Althar’s window and ask again.'
    return Effect.gen(function* () {
      const { first } = yield* opened
      const refused = yield* callToolWhole(first, 'page_click', { ref: 'e1' })
      assert.isTrue(refused.isError)
      assert.deepStrictEqual(refused.content, [{ type: 'text', text: words }])
      assert.lengthOf(asked, 1)
    }).pipe(Effect.provide(runtime(undefined, undefined, { page: hosting(asked, () => Effect.fail(words)) })))
  })

  it.live('give a screenshot back as a picture with its words, and any other answer as words', () => {
    const asked: Array<Asked> = []
    const answer = (call: PageCall): Effect.Effect<PageAnswer, string> =>
      Effect.succeed(
        call.op === 'screenshot'
          ? { text: 'The page at http://localhost:5173/, 800×600.', picture: { png: PIXEL, width: 800, height: 600 } }
          : { text: 'Open beside the task: http://localhost:5173/' },
      )
    return Effect.gen(function* () {
      const { first, coordinator } = yield* opened
      const taken = yield* callToolWhole(first, 'page_screenshot', { full_page: true })
      assert.isFalse(taken.isError)
      assert.deepStrictEqual(taken.content, [
        { type: 'text', text: 'The page at http://localhost:5173/, 800×600.' },
        { type: 'image', data: PIXEL, mimeType: 'image/png' },
      ])
      const of = yield* callToolWhole(coordinator, 'page_screenshot', { selector: '#plan' })
      assert.strictEqual(of.content[1]?.type, 'image')
      const said = yield* callToolWhole(first, 'page_state', {})
      assert.deepStrictEqual(said.content, [{ type: 'text', text: 'Open beside the task: http://localhost:5173/' }])
      assert.deepStrictEqual(asked[0]?.call, { op: 'screenshot', target: null, fullPage: true })
      assert.deepStrictEqual(asked[1]?.call, { op: 'screenshot', target: { selector: '#plan' }, fullPage: false })
    }).pipe(Effect.provide(runtime(undefined, undefined, { page: hosting(asked, answer) })))
  })
})
