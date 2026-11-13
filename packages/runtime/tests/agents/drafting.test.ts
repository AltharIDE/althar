import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Stream } from 'effect'

import type { Draft } from '@althar/contracts'

import { Coordinator } from '../../src/Coordinator'
import { Instance } from '../../src/Instance'
import { Live } from '../../src/Live'
import { Projects } from '../../src/Projects'
import { Queries } from '../../src/Queries'
import * as Runtime from '../../src/Runtime'

/*
 * A task's card as the real coordinator drafts it: what the window is told of
 * the draft, and when, from the person's message to its plan, printed as it
 * comes. The person holds it as soon as it shows, so its plan must come held
 * and no lead runs. It costs one coordinator turn, and never runs in CI:
 * `bunx vp test run --config vite.agents.config.ts tests/agents/drafting.test.ts`.
 */

const ask = 'index.js has addDays. Add subtractDays beside it, with a test that runs with `node --test`. Plan it as a task.'
const say = (line: string) => process.stdout.write(`${line}\n`)

/** What of a draft is written, in a line. */
const line = (draft: Draft) =>
  [
    `title=${JSON.stringify(draft.title)}`,
    draft.brief ? 'brief' : '',
    draft.slug === null ? '' : `task=${draft.slug}`,
    draft.planning ? 'planning' : '',
    draft.lead === null ? '' : `lead=${draft.lead.agentId}/${draft.lead.model ?? '?'}/${draft.lead.effort ?? '-'}`,
    draft.review === null ? '' : `review=${draft.review.agentId}/${draft.review.model ?? '?'}`,
    draft.noReview ? 'no review' : '',
    draft.preset === null ? '' : `preset=${draft.preset}`,
    draft.planned ? 'planned' : '',
    draft.held ? 'held' : '',
  ]
    .filter((part) => part !== '')
    .join(' ')

describe('a task drafted by the real coordinator', () => {
  it.live(
    'shows from its first call, fills in as written, and, held as soon as it shows, comes as a held plan',
    () => {
      const home = mkdtempSync(join(tmpdir(), 'althar-drafting-'))
      const repository = join(home, 'meridian')
      mkdirSync(repository)
      const git = (...args: Array<string>) =>
        execFileSync('git', ['-c', 'user.name=Try', '-c', 'user.email=try@althar.test', ...args], { cwd: repository })
      git('init', '-q', '-b', 'main')
      writeFileSync(join(repository, 'README.md'), '# Meridian\n\nA small library for dates.\n')
      writeFileSync(join(repository, 'index.js'), 'export const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000)\n')
      git('add', '.')
      git('commit', '-q', '-m', 'Start')
      const layer = Queries.layer.pipe(
        Layer.provideMerge(
          Runtime.layer({
            database: join(home, 'althar.sqlite'),
            worktreeRoot: join(home, 'worktrees'),
            appVersion: '0.0.0-agents',
            deviceName: 'Agents',
          }),
        ),
      )
      return Effect.gen(function* () {
        const projects = yield* Projects
        const coordinator = yield* Coordinator
        const queries = yield* Queries
        const live = yield* Live
        const personId = (yield* Instance).personId
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository })
        const threadId = yield* coordinator.thread(project.projectId)
        say(`Coordinator starts on: ${JSON.stringify(yield* coordinator.suggested(project.projectId))}`)

        const sent = Date.now()
        const at = () => `${((Date.now() - sent) / 1000).toFixed(1)}s`
        const told: Array<{ readonly at: number; readonly drafts: ReadonlyArray<Draft> }> = []
        let held: string | null = null
        yield* Effect.forkScoped(
          Stream.runForEach(yield* live.subscribe, (event) =>
            Effect.gen(function* () {
              if (event._tag !== 'Drafting' || event.threadId !== threadId) return
              told.push({ at: Date.now() - sent, drafts: event.drafts })
              for (const draft of event.drafts) say(`${at()} draft ${draft.key}: ${line(draft)}`)
              // The person holds it the moment it shows.
              const first = event.drafts[0]
              if (held === null && first !== undefined) {
                held = first.key
                say(`${at()} the person holds it`)
                yield* coordinator.holdDraft(threadId, first.key, personId)
              }
            }),
          ),
        )
        say(`> ${ask}`)
        yield* coordinator.say({
          envelope: yield* Runtime.envelope('thread.send', { ask }),
          threadId,
          body: ask,
          disposition: 'after_current',
        })

        let card: { phase: string; slug: string } | undefined
        for (;;) {
          const snapshot = yield* queries.coordinator(project.projectId)
          card = snapshot.items.flatMap((item) => (item.kind === 'task' && item.content.plan !== null ? [item.content] : [])).at(-1)
          if (card !== undefined || Date.now() - sent > 5 * 60_000) break
          yield* Effect.sleep('500 millis')
        }
        // Long enough for a plan that wasn't held to start: a small change at once, any other after its countdown.
        yield* Effect.sleep('3 seconds')
        const snapshot = yield* queries.coordinator(project.projectId)
        card = snapshot.items.flatMap((item) => (item.kind === 'task' && item.content.plan !== null ? [item.content] : [])).at(-1)
        say(`${at()} its card: ${card?.slug} is ${card?.phase}`)
        const firstTold = told[0]
        const planned = told.find((one) => one.drafts.some((draft) => draft.lead !== null))
        say(
          `First told after ${((firstTold?.at ?? 0) / 1000).toFixed(1)}s; its lead after ${((planned?.at ?? 0) / 1000).toFixed(1)}s; ${told.length} updates.`,
        )
        assert.isDefined(firstTold, 'the window was told of no draft')
        // It filled in: told more than once, and of its title before its plan was in.
        assert.isAbove(told.length, 1)
        assert.isTrue(told.some((one) => one.drafts.some((draft) => draft.title !== null && !draft.planned)))
        assert.strictEqual(card?.phase, 'held')
      }).pipe(Effect.scoped, Effect.provide(layer))
    },
    10 * 60_000,
  )
})
