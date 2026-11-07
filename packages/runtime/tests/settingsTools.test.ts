import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { Ids, newId, type ProjectId } from '@althar/domain'
import { PROJECT_SETTINGS_SECTIONS, SETTINGS_SECTIONS, type SettingChangeCard } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { plansAndReviewsOf } from '../src/plansAndReviews'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { timestamp } from '../src/records'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { SCREEN_CHANGES, SettingsTools } from '../src/SettingsTools'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, listTools, repository, runtime } from './support'

/*
 * The coordinator and leads read and change settings as the person can on
 * the Settings screens (ADR-097): tightening and plain changes at once, with
 * a line and Undo; a change that loosens what asks only on the person's own
 * message in the turn, else as a card they press.
 */

/** A project, its coordinator's session and a task's lead's, each with a way to start a live turn as the person or as news. */
const opened = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const projectId = project.projectId as ProjectId
  const coordinatorThread = yield* (yield* Coordinator).thread(project.projectId)
  const task = yield* projects.createTask({
    envelope: yield* Runtime.envelope('task.create', { title: 'Settings page' }),
    projectId,
    title: 'Settings page',
  })
  const sessionOf = (threadId: string) =>
    Effect.gen(function* () {
      const id = yield* newId(Ids.providerSession)
      yield* sql`INSERT INTO provider_sessions ${sql.insert({ id, projectId, threadId, agentId: 'codex', state: 'active', startedAt: yield* timestamp })}`
      return id
    })
  const coordinator: ToolAccess = {
    role: 'coordinator',
    projectId,
    threadId: coordinatorThread,
    taskId: null,
    sessionId: yield* sessionOf(coordinatorThread),
  }
  const lead: ToolAccess = {
    role: 'lead',
    projectId,
    threadId: task.threadId,
    taskId: task.taskId,
    sessionId: yield* sessionOf(task.threadId),
  }
  /** A live turn on a session, with one message: the person's from the window, or news. */
  const turn = (access: ToolAccess, body: string, person: boolean) =>
    Effect.gen(function* () {
      yield* sql`UPDATE turn_deliveries SET state = 'completed', ended_at = ${yield* timestamp} WHERE thread_id = ${access.threadId} AND state = 'delivered'`
      const accepted = yield* (yield* Sessions).send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: access.threadId,
        body,
        sender: person ? { kind: 'window' } : { kind: 'socket' },
        origin: person ? 'system' : 'news',
      })
      const turnId = yield* newId(Ids.turnDelivery)
      yield* sql`INSERT INTO turn_deliveries ${sql.insert({ id: turnId, projectId, threadId: access.threadId, providerSessionId: access.sessionId, controllerGeneration: 1, state: 'delivered', origin: person ? 'person' : 'news', requestedAt: yield* timestamp, deliveredAt: yield* timestamp })}`
      yield* sql`INSERT INTO turn_delivery_inputs ${sql.insert({ projectId, deliveryId: turnId, userInputId: accepted.inputId, position: 1 })}`
    })
  return { projectId, coordinator, lead, turn }
})

/** The setting lines and cards in a thread, oldest first, as the window reads each (Queries.item), with their items' ids. */
const shown = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const queries = yield* Queries
    const ids = yield* sql<{ id: string }>`SELECT id FROM thread_items WHERE thread_id = ${threadId} AND kind = 'setting' ORDER BY sequence`
    return yield* Effect.forEach(ids, ({ id }) =>
      Effect.map(queries.item(threadId, id), (item) => {
        assert.strictEqual(item.kind, 'setting', 'the window reads a setting line as one')
        return { id, card: item.content as SettingChangeCard }
      }),
    )
  })
const lines = (threadId: string) => Effect.map(shown(threadId), (all): ReadonlyArray<SettingChangeCard> => all.map((one) => one.card))
const lineIds = (threadId: string) => Effect.map(shown(threadId), (all) => all.map((one) => one.id))
const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))
const rulesNow = (projectId: ProjectId) =>
  Effect.gen(function* () {
    return (yield* (yield* Policies).current(projectId)).rules
  })

/**
 * Every change the Settings screens make, by the API call or the window's preference that makes it: read from the
 * screens' own files and the hooks and models they import, as the screens call them.
 */
const screensChanges = () => {
  const renderer = join(__dirname, '../../../apps/desktop/src/renderer')
  const own = ['features/settings', 'features/projectSettings'].flatMap((folder) =>
    readdirSync(join(renderer, folder))
      .filter((name) => /\.tsx?$/.test(name))
      .map((name) => join(renderer, folder, name)),
  )
  const files = new Set(own)
  for (const file of own)
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(/from '(\.[^']+)'/g)) {
      const base = resolve(dirname(file), spec ?? '')
      const found = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((one) => existsSync(one))
      if (found !== undefined) files.add(found)
    }
  const made = new Map<string, string>()
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const where = relative(renderer, file)
    // What the screens call: anything that isn't only a read.
    for (const [, call] of source.matchAll(/client\.([a-zA-Z]+)\(/g))
      if (call !== undefined && !/^(get|list|read|find|search|watch|status|check|look)/.test(call)) made.set(call, where)
    // The window's own preferences, set by name, and those a map names.
    for (const [, key] of source.matchAll(/\bset\('([a-zA-Z]+)'/g)) if (key !== undefined) made.set(key, where)
    for (const [, keys] of source.matchAll(/const [A-Z_]+_KEYS = \{([^}]*)\}/g))
      for (const [, key] of (keys ?? '').matchAll(/:\s*'([a-zA-Z]+)'/g)) if (key !== undefined) made.set(key, where)
  }
  return made
}

describe('settings, for the coordinator and leads', () => {
  it.live('are read and changed with the same pair of tools in both roles', () =>
    Effect.gen(function* () {
      const { coordinator, lead } = yield* opened
      for (const access of [coordinator, lead]) assert.includeMembers(yield* listTools(access), ['read_settings', 'change_settings'])
      assert.notInclude(yield* listTools({ ...lead, role: 'reviewer' }), 'change_settings')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('read_settings covers every section the Settings screens list', () =>
    Effect.gen(function* () {
      const { coordinator } = yield* opened
      const all = yield* callTool(coordinator, 'read_settings', {})
      // The screens' own lists, as the desktop app keeps them, and as contracts names them.
      const desktop = join(__dirname, '../../../apps/desktop/src/renderer/features')
      const listed = (file: string, name: string) => {
        const source = readFileSync(join(desktop, file), 'utf8')
        const found = new RegExp(`export const ${name}[^=]*=\\s*([A-Z_]+|\\[[^\\]]*\\])`).exec(source)?.[1] ?? ''
        return found
      }
      assert.strictEqual(listed('settings/sections.ts', 'SECTIONS'), 'SETTINGS_SECTIONS')
      assert.strictEqual(listed('projectSettings/sections.ts', 'PROJECT_SECTIONS'), 'PROJECT_SETTINGS_SECTIONS')
      for (const id of SETTINGS_SECTIONS) assert.include(all, `\nalthar/${id} — `, `read_settings doesn't cover althar/${id}`)
      for (const id of PROJECT_SETTINGS_SECTIONS) assert.include(all, `project/${id} — `, `read_settings doesn't cover project/${id}`)
      const rules = yield* callTool(coordinator, 'read_settings', { section: 'project/rules' })
      assert.match(rules, /never \(Never\): \[/)
      assert.match(rules, /Loosens what asks when a kind taken out/)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('every change a Settings screen makes has a way for agents, or a reason it is the person’s', () =>
    Effect.gen(function* () {
      const { coordinator, lead } = yield* opened
      const made = screensChanges()
      // The walk finds what it should: a screen's API call, and a preference the window keeps.
      assert.isTrue(made.has('setPostTeamReviews') && made.has('usageData'), 'the walk of the screens found nothing')
      for (const [change, where] of made)
        assert.property(SCREEN_CHANGES, change, `${where} makes ${change}, which SCREEN_CHANGES (SettingsTools.ts) doesn't name`)
      // And nothing it names is gone from the screens.
      for (const change of Object.keys(SCREEN_CHANGES)) assert.isTrue(made.has(change), `no Settings screen makes ${change} any more`)
      const tools = { coordinator: yield* listTools(coordinator), lead: yield* listTools(lead) }
      for (const [change, how] of Object.entries(SCREEN_CHANGES)) {
        const setting = /^((?:project|althar)\/[a-z-]+)\.([a-zA-Z]+)$/.exec(how)
        if (setting !== null) {
          const shown = yield* callTool(coordinator, 'read_settings', { section: setting[1] })
          assert.include(shown, `- ${setting[2]} (`, `${change}: read_settings ${setting[1]} has no ${setting[2]}`)
        } else if (how.startsWith('tool:')) {
          const name = how.slice('tool:'.length)
          assert.include(tools.coordinator, name, `${change}: the coordinator has no ${name}`)
          assert.include(tools.lead, name, `${change}: a lead has no ${name}`)
        } else assert.match(how, /^(person|window): \S/, `${change}: say how it is made, or why no agent makes it`)
      }
      // The project's colour, which the screen had and the tools didn't, goes as the screen's does.
      assert.match(
        yield* callTool(coordinator, 'change_settings', { section: 'project/general', change: { ink: 'moss' } }),
        /^Changed General/,
      )
      assert.include(yield* callTool(coordinator, 'read_settings', { section: 'project/general' }), '- ink (Colour): "moss"')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('a tightening and a plain change go at once, each with its line', () =>
    Effect.gen(function* () {
      const { projectId, coordinator, lead, turn } = yield* opened
      yield* turn(lead, 'carry on', false)
      const before = yield* rulesNow(projectId)
      const kinds = ['force-push', 'delete-branch']
      const tightened = yield* callTool(lead, 'change_settings', { section: 'project/rules', change: { never: kinds } })
      assert.match(tightened, /^Changed Rules: Never: /)
      assert.includeMembers([...((yield* rulesNow(projectId)).never ?? [])], kinds)
      assert.notDeepEqual(before, yield* rulesNow(projectId))

      yield* turn(coordinator, 'news', false)
      const plain = yield* callTool(coordinator, 'change_settings', { section: 'althar/plans-and-reviews', change: { rounds: 5 } })
      assert.match(plain, /Review rounds: 3 → 5/)
      assert.strictEqual((yield* plansAndReviewsOf).rounds, 5)

      const said = yield* lines(lead.threadId)
      assert.strictEqual(said.length, 1)
      assert.strictEqual(said[0]?.state, 'done')
      assert.strictEqual(said[0]?.by.kind, 'lead')
      assert.strictEqual(said[0]?.by.title, 'Settings page')
      assert.strictEqual((yield* lines(coordinator.threadId))[0]?.moves[0]?.after, '5')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('a loosening without the person’s words is a card, which their press makes; with them it goes, quoting them', () =>
    Effect.gen(function* () {
      const { projectId, coordinator, lead, turn } = yield* opened
      yield* turn(lead, 'carry on', false)
      const asked = yield* callTool(lead, 'change_settings', {
        section: 'project/rules',
        change: { allowEverything: true },
        why: 'It keeps asking about the build.',
      })
      assert.match(asked, /waits for them on a card/)
      assert.isFalse((yield* rulesNow(projectId)).allowEverything === true)
      const [card] = yield* lines(lead.threadId)
      assert.strictEqual(card?.state, 'asked')
      assert.strictEqual(card?.why, 'It keeps asking about the build.')
      const [cardId] = yield* lineIds(lead.threadId)
      yield* (yield* SettingsTools).answer(cardId ?? '', true)
      assert.isTrue((yield* rulesNow(projectId)).allowEverything === true)
      assert.strictEqual((yield* lines(lead.threadId))[0]?.state, 'done')
      // A press is no words of theirs: the line doesn't quote any, and neither does the record.
      assert.isNull((yield* lines(lead.threadId))[0]?.words)
      const sql = yield* SqlClient.SqlClient
      assert.deepStrictEqual(
        yield* sql<{ words: string | null }>`SELECT words FROM setting_changes WHERE state = 'done' ORDER BY created_at DESC LIMIT 1`,
        [{ words: null }],
      )

      // With the person's own message in the turn, it goes, and the line quotes them.
      yield* turn(coordinator, 'Turn on posting the team’s reviews without asking', true)
      const went = yield* callTool(coordinator, 'change_settings', { section: 'althar/reviews', change: { postTeamReviews: true } })
      assert.match(went, /^Changed Reviews and pull requests/)
      const [line] = yield* lines(coordinator.threadId)
      assert.strictEqual(line?.state, 'done')
      assert.isTrue(line?.loosens)
      assert.strictEqual(line?.words, 'Turn on posting the team’s reviews without asking')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('a change that tightens one rule and loosens another is a loosening', () =>
    Effect.gen(function* () {
      const { projectId, coordinator, turn } = yield* opened
      yield* turn(coordinator, 'news', false)
      const now = yield* rulesNow(projectId)
      const asked = now.alwaysAsk ?? []
      assert.isAbove(asked.length, 0)
      // One kind moves up to Never, which tightens it; another is taken out of Ask me altogether, which loosens it.
      const [up, out] = asked
      const said = yield* callTool(coordinator, 'change_settings', {
        section: 'project/rules',
        change: { never: [...(now.never ?? []), up], alwaysAsk: asked.filter((kind) => kind !== up && kind !== out) },
      })
      assert.match(said, /loosens what asks \(the rule /)
      assert.match(said, new RegExp(`the rule ${out}`))
      assert.notMatch(said, new RegExp(`the rule ${up}\\b`))
      assert.deepStrictEqual(yield* rulesNow(projectId), now)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('undoing a tightening waits for the person; their Undo puts it back at once', () =>
    Effect.gen(function* () {
      const { projectId, lead, turn } = yield* opened
      yield* turn(lead, 'carry on', false)
      const done = yield* callTool(lead, 'change_settings', { section: 'althar/reviews', change: { coAuthor: false } })
      const id = /undo: (\S+)\./.exec(done)?.[1] ?? ''
      // A plain change: the agent's own undo goes at once.
      assert.match(yield* callTool(lead, 'change_settings', { undo: id }), /^Undid Reviews and pull requests/)
      // Its line says it was undone; the undo is a change of its own, with a line of its own.
      assert.deepStrictEqual(
        (yield* lines(lead.threadId)).map((line) => line.state),
        ['undone', 'done'],
      )

      // A tightening: turning the leads' web off. Its undo turns it on again, a loosening, so it waits.
      const off = yield* callTool(lead, 'change_settings', { section: 'project/rules', change: { leadsReachWeb: false } })
      const offId = /undo: (\S+)\./.exec(off)?.[1] ?? ''
      assert.isFalse((yield* rulesNow(projectId)).leadsReachWeb)
      assert.match(yield* callTool(lead, 'change_settings', { undo: offId }), /waits for them on a card/)
      assert.isFalse((yield* rulesNow(projectId)).leadsReachWeb)

      assert.strictEqual((yield* lines(lead.threadId)).at(-1)?.state, 'asked')

      // The person's own Undo on the line goes at once.
      const ids = yield* lineIds(lead.threadId)
      yield* (yield* SettingsTools).undo(ids[2] ?? '')
      assert.isTrue((yield* rulesNow(projectId)).leadsReachWeb ?? true)
      assert.strictEqual((yield* lines(lead.threadId))[2]?.state, 'undone')
      // The card asking the same is overtaken: pressed now, it does nothing.
      yield* (yield* SettingsTools).answer(ids[3] ?? '', true)
      assert.strictEqual((yield* lines(lead.threadId))[3]?.state, 'moot')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('a lead’s change shows in Settings at once, with who made it, until someone changes it again', () =>
    Effect.gen(function* () {
      const { projectId, lead, turn } = yield* opened
      yield* turn(lead, 'carry on', false)
      yield* callTool(lead, 'change_settings', { section: 'project/general', change: { moveIssues: false, name: 'Renamed' } })
      const settings = yield* SettingsTools
      const changed = yield* settings.changed(projectId)
      assert.sameMembers(
        changed.map((one) => `${one.section}#${one.key}`),
        ['project/general#moveIssues', 'project/general#name'],
      )
      assert.strictEqual(changed[0]?.by.title, 'Settings page')
      const sql = yield* SqlClient.SqlClient
      const [project] = yield* sql<{ name: string }>`SELECT name FROM projects WHERE id = ${projectId}`
      assert.strictEqual(project?.name, 'Renamed')
      // The person renames it on the screen: it is theirs now, and Settings no longer names the lead for it.
      yield* (yield* Projects).rename(projectId, 'Mine')
      assert.deepStrictEqual(
        (yield* settings.changed(projectId)).map((one) => one.key),
        ['moveIssues'],
      )
      // Each change is in the record, as the agents' own.
      const [recorded] = yield* sql<{ count: number }>`SELECT count(*) AS count FROM record_events WHERE aggregate_type = 'setting'`
      assert.isAbove(recorded?.count ?? 0, 0)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('what stays the person’s is refused, with why', () =>
    Effect.gen(function* () {
      const { lead, turn } = yield* opened
      yield* turn(lead, 'carry on', false)
      assert.match(
        yield* callTool(lead, 'change_settings', { section: 'althar/code-hosts', change: { connections: [] } }),
        /nothing to change here\. Connecting, signing in and removing a connection are the person's/,
      )
      assert.match(
        yield* callTool(lead, 'change_settings', { section: 'project/rules', change: { secrets: true } }),
        /has no setting secrets/,
      )
      assert.match(yield* callTool(lead, 'change_settings', { section: 'project/nowhere', change: {} }), /There is no section/)
    }).pipe(Effect.provide(withQueries())),
  )
})
