import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { _electron as electron, expect, type Page, test } from '@playwright/test'

import { mainWindow, openFirstProject, say } from './support'

/*
 * How long a plain "hi" and a short question about the code take, in the
 * coordinator's conversation and in an aside, with a real agent on this
 * machine's own sign-in, and where the time went: from Enter to Althar
 * taking the words, getting the turn ready (the coordinator's copies, its
 * news, the record), starting the aside's worktree and session, the model's
 * wait for its first word, the tools it called and the turn's end. Read from
 * what Althar keeps of each turn (`turn_deliveries.timings`) and the record's
 * events, beside the window's own clock at Enter.
 *
 * The project is a clone of this repository sharing its objects, its origin
 * the same remote, so fetches and copies cost what they cost the person.
 * Runs only by hand: ALTHAR_REAL_AGENT=claude-code; ALTHAR_REAL_MODEL picks
 * the model by its name ("Opus 5.5"), ALTHAR_REAL_EFFORT its effort
 * ("High"), ALTHAR_TIMINGS_APP another build of the app to time (a folder
 * with its package.json), and ALTHAR_TIMINGS_LABEL names what it writes:
 * test-results/real-timings-<label>.json. ALTHAR_TEST_SCALE=3 gives a real
 * agent's turns their time.
 */

const agent = process.env.ALTHAR_REAL_AGENT
const names: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }
const label = process.env.ALTHAR_TIMINGS_LABEL ?? 'now'

test.skip(agent === undefined, 'Set ALTHAR_REAL_AGENT to time a real agent')

const QUESTION = 'Which file in this repository draws the pills over the coordinator’s conversation? Answer with its path only.'

/** The agent's model in the picker `picker` names, as ALTHAR_REAL_MODEL says or its first, at ALTHAR_REAL_EFFORT where set. */
const pick = async (page: Page, picker: RegExp, name: string) => {
  await page.getByRole('button', { name: picker }).click()
  await page.getByRole('button', { name: /All models/ }).click()
  const models = page.getByRole('dialog')
  await models.getByRole('radio', { name: new RegExp(`^${name}`) }).click()
  const wanted = process.env.ALTHAR_REAL_MODEL
  const choices = models.getByRole('button', { name: /^Use / })
  await (wanted === undefined ? choices.first() : choices.filter({ hasText: new RegExp(wanted, 'i') }).first()).click()
  const effort = process.env.ALTHAR_REAL_EFFORT
  if (effort === undefined) return
  await page.getByRole('button', { name: picker }).click()
  await page.getByRole('radio', { name: effort, exact: true }).click()
  await page.keyboard.press('Escape')
}

const at = (iso: string | null | undefined) => (iso == null ? null : Date.parse(iso))
const gap = (from: number | null, to: number | null) => (from === null || to === null ? null : to - from)

interface Turn {
  readonly id: string
  readonly threadId: string
  readonly model: string | null
  readonly effort: string | null
  readonly requestedAt: string
  readonly deliveredAt: string | null
  readonly endedAt: string | null
  readonly timings: string | null
  readonly usage: string | null
  readonly prompt: number
}

/** What the store says of a thread's turns since `since`, oldest first; each with the tools it called and when it first spoke. */
const turnsOf = (store: string, threadId: string, since: number) => {
  const db = new DatabaseSync(store, { readOnly: true })
  try {
    const turns = db
      .prepare(
        `SELECT id, thread_id AS threadId, model, effort, requested_at AS requestedAt, delivered_at AS deliveredAt, ended_at AS endedAt,
          timings, usage, length(prompt) AS prompt FROM turn_deliveries WHERE thread_id = ? ORDER BY requested_at`,
      )
      .all(threadId) as unknown as ReadonlyArray<Turn>
    return turns
      .filter((turn) => Date.parse(turn.requestedAt) >= since)
      .map((turn) => {
        const items = db
          .prepare(`SELECT kind, created_at AS createdAt, content FROM thread_items WHERE delivery_id = ? ORDER BY sequence`)
          .all(turn.id) as unknown as ReadonlyArray<{ kind: string; createdAt: string; content: string }>
        const said = items.find((item) => item.kind === 'agent_message')
        return {
          ...turn,
          tools: items.filter((item) => item.kind === 'tool_call').map((item) => (JSON.parse(item.content) as { title?: string }).title),
          said: said === undefined ? null : (JSON.parse(said.content) as { text?: string }).text?.slice(0, 120),
          checked: items.some(
            (item) => item.kind === 'step_result' && (JSON.parse(item.content) as { evidence?: unknown[] }).evidence?.length,
          ),
        }
      })
  } finally {
    db.close()
  }
}

/** When each step of starting an aside's task came, from the record. */
const startOf = (store: string, taskId: string) => {
  const db = new DatabaseSync(store, { readOnly: true })
  try {
    const rows = db
      .prepare(
        `SELECT e.type, e.occurred_at AS at FROM record_events e WHERE e.aggregate_id = ?1
           OR e.aggregate_id IN (SELECT id FROM workspaces WHERE task_id = ?1)
           OR e.aggregate_id IN (SELECT s.id FROM provider_sessions s JOIN threads t ON t.id = s.thread_id WHERE t.task_id = ?1)
         ORDER BY e.sequence`,
      )
      .all(taskId) as unknown as ReadonlyArray<{ type: string; at: string }>
    const first = (type: string) => at(rows.find((row) => row.type === type)?.at)
    return {
      created: first('task.created'),
      worktree: first('workspace.ready'),
      starting: first('provider_session.starting'),
      active: first('provider_session.active'),
    }
  } finally {
    db.close()
  }
}

/** The input the person sent at `since` in a thread, as Althar took it. */
const takenAt = (store: string, threadId: string, since: number) => {
  const db = new DatabaseSync(store, { readOnly: true })
  try {
    const rows = db
      .prepare(`SELECT accepted_at AS at FROM user_inputs WHERE thread_id = ? ORDER BY sequence`)
      .all(threadId) as unknown as ReadonlyArray<{ at: string }>
    return at(rows.map((row) => row.at).find((when) => Date.parse(when) >= since - 1_000))
  } finally {
    db.close()
  }
}

const one = (store: string, sql: string, ...args: Array<string>) => {
  const db = new DatabaseSync(store, { readOnly: true })
  try {
    return db.prepare(sql).get(...args) as Record<string, string> | undefined
  } finally {
    db.close()
  }
}

/** A turn's stages, in milliseconds from Enter. */
const stages = (enter: number, taken: number | null, turn: ReturnType<typeof turnsOf>[number], begun?: ReturnType<typeof startOf>) => {
  const timings = (turn.timings === null ? {} : JSON.parse(turn.timings)) as Record<string, number | string | null>
  const usage = (turn.usage === null ? {} : JSON.parse(turn.usage)) as Record<string, number>
  const delivered = at(turn.deliveredAt)
  const firstWord = delivered === null || typeof timings.first !== 'number' ? null : delivered + timings.first
  return {
    model: turn.model,
    effort: turn.effort,
    enterToTaken: gap(enter, taken ?? begun?.created ?? null),
    ...(begun === undefined
      ? {}
      : {
          taskToWorktree: gap(begun.created, begun.worktree),
          worktreeToSession: gap(begun.worktree, begun.starting),
          sessionStart: gap(begun.starting, begun.active),
        }),
    // From the words taken, or the lead ready where that came after, to the prompt going out.
    takenToPrompt: gap(Math.max(taken ?? 0, begun?.active ?? 0) || null, delivered),
    session: timings.session ?? null,
    ready: timings.ready ?? null,
    copies: timings.copies ?? null,
    modelToFirstWord: timings.first ?? null,
    work: timings.work ?? null,
    toolsTime: timings.tools ?? null,
    tools: turn.tools,
    enterToFirstWord: gap(enter, firstWord),
    enterToDone: gap(enter, at(turn.endedAt)),
    promptChars: turn.prompt,
    cacheWrite: usage.cachedWriteTokens ?? null,
    cacheRead: usage.cachedReadTokens ?? null,
    output: usage.outputTokens ?? null,
    checked: turn.checked,
    said: turn.said,
  }
}

test('a plain hi and a short code question, in the coordinator’s conversation and in an aside, timed by stage', async () => {
  const name = names[agent ?? ''] ?? agent ?? ''
  const home = mkdtempSync(join(tmpdir(), 'althar-timings-'))
  const repo = join(home, 'althar')
  const source = join(import.meta.dirname, '../../..')
  execFileSync('git', ['clone', '--quiet', '--shared', source, repo])
  execFileSync('git', [
    '-C',
    repo,
    'remote',
    'set-url',
    'origin',
    execFileSync('git', ['-C', source, 'remote', 'get-url', 'origin']).toString().trim(),
  ])
  const store = join(home, 'profile', 'althar.sqlite')
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => key !== 'ELECTRON_RUN_AS_NODE' && key !== 'ALTHAR_FAKE_AGENTS' && !key.startsWith('GIT_'),
    ),
  )
  const app = await electron.launch({
    args: [process.env.ALTHAR_TIMINGS_APP ?? join(import.meta.dirname, '..')],
    env: {
      ...inherited,
      ALTHAR_PROFILE: join(home, 'profile'),
      ALTHAR_WORKTREES: join(home, 'worktrees'),
      ALTHAR_CODE_HOME: home,
      ALTHAR_QUIT_WITHOUT_ASKING: '1',
    },
  })
  // When the person pressed Enter on each, by the window's clock: the store, which the app holds while it runs, is read after.
  const entered: Record<string, number> = {}
  try {
    const page = await mainWindow(app)
    await (await app.browserWindow(page)).evaluate((window) => window.setSize(1440, 960))
    await openFirstProject(app, page, repo)
    await expect(page.getByRole('heading', { name: 'althar', level: 1 })).toBeVisible()
    await pick(page, /^Coordinator:/, name)
    const working = page.getByRole('button', { name: /^Interrupt/ }).filter({ visible: true })
    /** The agent at work on it, and then no longer. */
    const answered = async () => {
      await expect(working).not.toHaveCount(0)
      await expect(working).toHaveCount(0)
    }

    const toCoordinator = async (key: string, words: string) => {
      entered[key] = Date.now()
      await say(page, words)
      await answered()
    }

    const coordinatorPill = page
      .getByRole('tablist', { name: 'Conversations' })
      .filter({ visible: true })
      .getByRole('tab', { name: 'Coordinator', exact: true })
    const plus = page.getByRole('button', { name: 'New aside' })
    /** Words in an aside opened with + (a new one, or the one left unsaid), as the person writes them, and its turn's end. */
    const inAside = async (key: string, words: string) => {
      await plus.click()
      const box = page.getByRole('textbox', { name: /^Ask on the side/ })
      await box.click()
      await box.fill(words)
      entered[key] = Date.now()
      await box.press('Enter')
      await expect(page.getByRole('tab', { name: words.slice(0, 40), selected: true })).toBeVisible()
      await answered()
      if (key === 'asideHiCold') await page.screenshot({ path: `test-results/real-timings-${label}.png`, scale: 'css' })
      await coordinatorPill.click()
    }

    // Its session started and its copies made once, as the person's coordinator has them: not timed.
    await toCoordinator('warm', 'Reply with the single word "ready".')
    // Asides started as the words go, Enter pressed straight after +: what an aside costs with no head start. Between them, the
    // coordinator's turns, as the person reads one answer before writing again.
    await inAside('asideHiCold', 'hi')
    await toCoordinator('coordinatorHi', 'hi')
    await inAside('asideQuestionCold', QUESTION)
    await toCoordinator('coordinatorQuestion', QUESTION)
    // An aside opened with + and left while the coordinator answers something: ready by the time the person writes in it.
    await plus.click()
    await coordinatorPill.click()
    await toCoordinator('pause', 'Thanks.')
    await inAside('asideHiReady', 'hi')
    await plus.click()
    await coordinatorPill.click()
    await toCoordinator('pause2', 'Thanks again.')
    await inAside('asideQuestionReady', QUESTION)
  } finally {
    await app.close()
  }

  const coordinator = one(store, `SELECT id FROM threads WHERE kind = 'coordinator'`)?.id ?? ''
  const toldCoordinator = (key: string) => {
    const enter = entered[key] ?? 0
    const [turn] = turnsOf(store, coordinator, enter)
    return turn === undefined ? null : stages(enter, takenAt(store, coordinator, enter), turn)
  }
  const askedAside = (key: string) => {
    const enter = entered[key] ?? 0
    const since = new Date(enter - 1_000).toISOString()
    // The aside its words went to: made as they went, or opened with + before and given them as its first message.
    const task = one(
      store,
      `SELECT k.id, t.id AS thread,
         min(coalesce(CASE WHEN k.created_at >= ?1 THEN k.created_at END, '9'),
           coalesce((SELECT min(u.accepted_at) FROM user_inputs u WHERE u.thread_id = t.id AND u.accepted_at >= ?1), '9')) AS first
       FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
       WHERE k.created_at >= ?1 OR EXISTS (SELECT 1 FROM user_inputs u WHERE u.thread_id = t.id AND u.accepted_at >= ?1)
       ORDER BY first LIMIT 1`,
      since,
    )
    const begun = startOf(store, task?.id ?? '')
    // What came after its first turn: a reminder to report, or nothing.
    const [turn, ...after] = turnsOf(store, task?.thread ?? '', enter)
    const taken = takenAt(store, task?.thread ?? '', enter)
    return turn === undefined
      ? null
      : {
          ...stages(enter, taken, turn, begun),
          // How long before Enter its lead was ready: started with + and waiting for the words; negative, after.
          readyBeforeEnter: begun.active === null ? null : enter - begun.active,
          turnsAfter: after.length,
        }
  }
  const results = {
    coordinatorHi: toldCoordinator('coordinatorHi'),
    coordinatorQuestion: toldCoordinator('coordinatorQuestion'),
    asideHiCold: askedAside('asideHiCold'),
    asideQuestionCold: askedAside('asideQuestionCold'),
    asideHiReady: askedAside('asideHiReady'),
    asideQuestionReady: askedAside('asideQuestionReady'),
    // Anything the asides set off in the coordinator's conversation, such as a turn of news.
    coordinatorTurns: turnsOf(store, coordinator, 0).length,
    entered,
  }
  mkdirSync('test-results', { recursive: true })
  writeFileSync(`test-results/real-timings-${label}.json`, `${JSON.stringify(results, null, 2)}\n`)
  expect(results.asideHiCold).not.toBeNull()
})
