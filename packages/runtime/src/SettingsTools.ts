import {
  AtOnceCount,
  CommandRule,
  FolderWait,
  NewProjectDefaults,
  PlansAndReviews,
  PROJECT_SETTINGS_SECTIONS,
  ProjectInk,
  ProjectTracker,
  RepositoryFilesSetting,
  RepositoryRole,
  RepositorySetup,
  RuleKind,
  SealStyle,
  SETTINGS_SECTIONS,
  type SettingChangeCard,
  type SettingChanged,
  type SettingChanger,
  UsageLimit,
  WorksIn,
} from '@althar/contracts'
import { type ActorId, Ids, newId, type ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { setActive } from '@althar/skills'
import { Context, type Crypto, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Automations } from './Automations'
import { Busy } from './Busy'
import { Changes } from './Changes'
import { Agents, RuntimeConfig } from './Config'
import { Connections } from './Connections'
import { BranchNotFound } from './errors'
import { coAuthorOn, setCoAuthor } from './credit'
import { FolderCleanup } from './FolderCleanup'
import { Instance } from './Instance'
import { Models } from './Models'
import { notesOf } from './notes'
import { Permissions } from './Permissions'
import { newProjectDefaultsOf, plansAndReviewsOf, setNewProjectDefaults, setPlansAndReviews } from './plansAndReviews'
import {
  accountsOf,
  allowsEverything,
  modeOf,
  movesIssues,
  Policies,
  postsScreenshots,
  pushesCommits,
  repositoryFilesOf,
  resolvesConflicts,
  ruleSetOf,
  usageLimitOf,
  worksInOf,
} from './Policies'
import { Projects } from './Projects'
import { projectTracker } from './projectTracker'
import { PullRequestScreenshots } from './PullRequestScreenshots'
import { reviewSeal, setReviewSeal, setReviewSealStyle } from './pullRequestReview'
import { fact, timestamp } from './records'
import { postTeamReviews, setPostTeamReviews } from './Reviews'
import { applyRules, type RulesSent } from './rulesChange'
import { workedOutReach } from './sandboxReach'
import { listSkills } from './Skills'
import { addItem, updateItem } from './threads'
import { POOL, ToolRefused, ToolServer, type Tool, type ToolAccess } from './ToolServer'

/*
 * Settings, as the person changes them on the Settings screens, for the
 * coordinator and leads alike (ADR-097, docs/plans/capable-by-default.md
 * phase 2): `read_settings` reads a section, or every one, and
 * `change_settings` changes one through the call its screen makes, so the
 * screen shows it at once.
 *
 * Althar, not the agent, reads whether a change loosens what asks: each
 * setting says how it loosens (a mode's order, a list's taking out or adding,
 * a switch turned on), and a change that loosens anything is loosening as a
 * whole. That goes only on the person's own message in the turn (`byPerson`,
 * as ADR-081's asked-for tools); in any other turn it is a card they press.
 * Everything else goes at once. Each change is a line in the agent's thread,
 * before and after, with Undo; Settings says who changed a setting last while
 * it stays as they left it.
 */

type Values = Readonly<Record<string, unknown>>

/** One setting of a section: its words as the screen shows them, what it takes, and how a change to it loosens what asks. */
interface Field {
  readonly label: string
  readonly takes: string
  readonly schema: Schema.Codec<unknown, unknown>
  /** Whether going from one value to the other loosens what asks; plain where left out. */
  readonly loosens?: (before: unknown, after: unknown) => boolean
  /** When it loosens, in words, for read_settings. */
  readonly loosening?: string
}

/** A section of the Settings screens, by its address, with what it holds and how a change to it is made. */
interface Section {
  readonly id: string
  readonly title: string
  readonly scope: 'project' | 'althar'
  /** What else the screen holds that isn't changed here, and why. */
  readonly note?: string
  readonly fields: Readonly<Record<string, Field>>
  readonly read: (projectId: string) => Effect.Effect<Values, unknown, Needs>
  /** Makes a change: only the fields given, each read already. */
  readonly write?: (projectId: string, change: Values, actorId: ActorId) => Effect.Effect<void, unknown, Needs>
  /** What of a change loosens what asks, read across its fields together, where a field alone can't say (a rule moved between lists). */
  readonly loosens?: (before: Values, after: Values) => ReadonlyArray<string>
}

type Needs =
  | SqlClient.SqlClient
  | Ledger
  | Crypto.Crypto
  | Instance
  | Policies
  | Permissions
  | Changes
  | PullRequestScreenshots
  | Projects
  | Busy
  | FolderCleanup
  | Automations
  | Models
  | Connections
  | Agents
  | RuntimeConfig

const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  ) ?? 'null'

const same = (a: unknown, b: unknown) => stable(a) === stable(b)

/** A value as a line says it: on or off, none, a list, or as it is. */
export const inWords = (value: unknown): string => {
  if (value === true) return 'on'
  if (value === false) return 'off'
  if (value === null || value === undefined) return 'none'
  if (Array.isArray(value))
    return value.length === 0 ? 'none' : value.map((one) => (typeof one === 'string' ? one : stable(one))).join(', ')
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return stable(value)
}

/* ---- How a setting loosens what asks ---- */

/** A switch that loosens turned on. */
const turnedOn = (before: unknown, after: unknown) => before !== true && after === true

/** A mode, from the most asks to the fewest: a move along it loosens. */
const toward = (order: ReadonlyArray<string>) => (before: unknown, after: unknown) =>
  order.indexOf(String(after)) > order.indexOf(String(before))

/** A list that lets more through as it grows: anything added loosens. */
const added = (before: unknown, after: unknown) => {
  const was = new Set((before as ReadonlyArray<string> | null) ?? [])
  return ((after as ReadonlyArray<string> | null) ?? []).some((one) => !was.has(one))
}

/** The mode under the switch, from the most asks to the fewest. */
const MODES = ['ask', 'coordinator', 'rules'] as const

/** How strictly a kind of the rules, or a command, is held: never, then asked about, then the mode's, then allowed. */
const strictness = (never: ReadonlyArray<string>, ask: ReadonlyArray<string>, allow: ReadonlyArray<string>, one: string) =>
  never.includes(one) ? 3 : ask.includes(one) ? 2 : allow.includes(one) ? 0 : 1

/** The kinds and commands a change to the rules holds less strictly than before, by their names. */
const rulesLoosened = (before: Values, after: Values): ReadonlyArray<string> => {
  const list = (values: Values, key: string) => (values[key] as ReadonlyArray<string> | undefined) ?? []
  const kinds = new Set([
    ...list(before, 'never'),
    ...list(before, 'alwaysAsk'),
    ...list(before, 'alwaysAllow'),
    ...list(after, 'alwaysAllow'),
  ])
  const looser = [...kinds].filter(
    (kind) =>
      strictness(list(after, 'never'), list(after, 'alwaysAsk'), list(after, 'alwaysAllow'), kind) <
      strictness(list(before, 'never'), list(before, 'alwaysAsk'), list(before, 'alwaysAllow'), kind),
  )
  const commands = (values: Values) => {
    const rules = (values['commands'] as ReadonlyArray<typeof CommandRule.Type> | undefined) ?? []
    const named = (decision: string) =>
      rules.filter((rule) => rule.decision === decision).map((rule) => `${rule.match === 'exact' ? '=' : ''}${rule.pattern}`)
    return { never: named('never'), ask: named('ask'), allow: named('allow') }
  }
  const was = commands(before)
  const now = commands(after)
  const patterns = new Set([...was.never, ...was.ask, ...was.allow, ...now.allow])
  const looserCommands = [...patterns].filter(
    (pattern) => strictness(now.never, now.ask, now.allow, pattern) < strictness(was.never, was.ask, was.allow, pattern),
  )
  return [...looser.map((kind) => `the rule ${kind}`), ...looserCommands.map((pattern) => `the command ${pattern.replace(/^=/, '')}`)]
}

/* ---- Reading the input ---- */

const read = <A>(schema: Schema.Codec<A, unknown>, input: unknown, what: string) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read ${what}: ${error.message}` })),
  )

const Reading = Schema.Struct({ section: Schema.optional(Schema.String) })
const Changing = Schema.Struct({
  section: Schema.optional(Schema.String),
  change: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  undo: Schema.optional(Schema.String),
  why: Schema.optional(Schema.String),
  message_id: Schema.optional(Schema.String),
})

const field = (label: string, takes: string, schema: Schema.Top, more: Pick<Field, 'loosens' | 'loosening'> = {}): Field => ({
  label,
  takes,
  schema: schema as unknown as Schema.Codec<unknown, unknown>,
  ...more,
})

const SWITCH = 'true or false'
const kinds = `a list of the rules' kinds: ${RuleKind.literals.join(', ')}`

/** What a row of setting_changes keeps. */
interface ChangeRow {
  readonly id: string
  readonly projectId: string | null
  readonly section: string
  readonly change: string
  readonly before: string
  readonly after: string
  readonly byKind: 'coordinator' | 'lead'
  readonly byTaskId: string | null
  readonly threadId: string
  readonly itemId: string | null
  readonly words: string | null
  readonly loosens: number
  readonly state: SettingChangeCard['state']
  readonly createdAt: string
  readonly updatedAt: string
}

export class SettingsTools extends Context.Service<
  SettingsTools,
  {
    /** The person answers an agent's card asking to change a setting that loosens what asks: yes makes it, as their press. */
    answer(itemId: string, yes: boolean): Effect.Effect<void, unknown>
    /** The person's Undo on an agent's line: what it changed goes back, at once, as their own change. */
    undo(itemId: string): Effect.Effect<void, unknown>
    /** The settings an agent changed that stay as it left them: a project's, or Althar's own with no project. */
    changed(projectId: string | null): Effect.Effect<ReadonlyArray<SettingChanged>, unknown>
  }
>()('@althar/runtime/SettingsTools') {
  static readonly layer: Layer.Layer<SettingsTools, never, Needs | ToolServer> = Layer.effect(
    SettingsTools,
    Effect.gen(function* () {
      const context = yield* Effect.context<Needs>()
      const instance = yield* Instance
      const provide = <A, E>(effect: Effect.Effect<A, E, Needs>) => Effect.provideContext(effect, context)

      /** The rules as the screen shows them, and a change to them through the call the screen makes. */
      const rulesOf = (projectId: string) =>
        Effect.gen(function* () {
          const policies = yield* Policies
          const { rules } = yield* policies.current(projectId as ProjectId)
          const set = ruleSetOf(rules)
          const accounts = accountsOf(rules)
          const reach = yield* workedOutReach(projectId, null)
          const edits = { commands: rules.sandbox?.commands, hosts: rules.sandbox?.hosts }
          const withEdits = (
            worked: ReadonlyArray<string>,
            edit: { added: ReadonlyArray<string>; removed: ReadonlyArray<string> } | undefined,
          ) => {
            const removed = new Set(edit?.removed ?? [])
            return [...new Set([...worked, ...(edit?.added ?? [])])].filter((one) => !removed.has(one))
          }
          return {
            rules,
            reach,
            view: {
              permissions: modeOf(rules),
              allowEverything: allowsEverything(rules),
              alwaysAsk: set.ask,
              never: set.never,
              alwaysAllow: set.allow,
              commands: set.commands,
              sandboxCommands: withEdits(reach.commands, edits.commands),
              sandboxHosts: withEdits(reach.hosts, edits.hosts),
              leadsReachWeb: rules.leadsReachWeb ?? true,
              usageLimit: usageLimitOf(rules),
              rotateAccounts: accounts.rotate,
              onlyAccounts: accounts.only ?? null,
              end: rules.end ?? null,
              repositoryFiles: repositoryFilesOf(rules),
              worksIn: worksInOf(rules),
              resolveConflicts: resolvesConflicts(rules),
              pushCommits: pushesCommits(rules),
              postScreenshots: postsScreenshots(rules),
              moveIssues: movesIssues(rules),
              branchPattern: rules.branchPattern ?? null,
              titlePattern: rules.titlePattern ?? null,
            } as Values,
          }
        })
      const RULE_KEYS = new Set([
        'permissions',
        'allowEverything',
        'alwaysAsk',
        'never',
        'alwaysAllow',
        'commands',
        'leadsReachWeb',
        'usageLimit',
        'rotateAccounts',
        'onlyAccounts',
        'end',
        'repositoryFiles',
        'worksIn',
        'resolveConflicts',
        'pushCommits',
        'postScreenshots',
        'moveIssues',
        'branchPattern',
        'titlePattern',
      ])
      /** A change to the rules' fields, the sandbox's lists as the edits the screen sends. */
      const writeRules = (projectId: string, change: Values, actorId: ActorId) =>
        Effect.gen(function* () {
          const { reach } = yield* rulesOf(projectId)
          const edit = (worked: ReadonlyArray<string>, wanted: ReadonlyArray<string>) => ({
            added: wanted.filter((one) => !worked.includes(one)),
            removed: worked.filter((one) => !wanted.includes(one)),
          })
          const sandbox = {
            ...(change['sandboxCommands'] === undefined
              ? {}
              : { commands: edit(reach.commands, change['sandboxCommands'] as ReadonlyArray<string>) }),
            ...(change['sandboxHosts'] === undefined ? {} : { hosts: edit(reach.hosts, change['sandboxHosts'] as ReadonlyArray<string>) }),
          }
          const sent = Object.fromEntries(Object.entries(change).filter(([key]) => RULE_KEYS.has(key))) as RulesSent
          yield* applyRules(projectId, { ...sent, ...(Object.keys(sandbox).length === 0 ? {} : { sandbox }) }, actorId)
        })
      const pick = (values: Values, keys: ReadonlyArray<string>) => Object.fromEntries(keys.map((key) => [key, values[key]]))

      /** The project's repositories by name. */
      const repositoriesOf = (projectId: string) =>
        Effect.gen(function* () {
          return yield* (yield* Projects).repositories(projectId)
        })
      /** Each repository named in a change, by its name, or refused with the names it has. */
      const byName = (projectId: string, named: Values) =>
        Effect.gen(function* () {
          const all = yield* repositoriesOf(projectId)
          return yield* Effect.forEach(Object.entries(named), ([name, value]) => {
            const found = all.find((one) => one.name === name)
            return found === undefined
              ? Effect.fail(
                  new ToolRefused({
                    message: `The project has no repository called ${name}. Its repositories: ${all.map((one) => one.name).join(', ')}.`,
                  }),
                )
              : Effect.succeed({ repository: found, value })
          })
        })

      const SECTIONS: ReadonlyArray<Section> = [
        /* ---- A project's ---- */
        {
          id: 'project/general',
          title: 'General',
          scope: 'project',
          fields: {
            name: field('Name', 'a few words', Schema.String),
            ink: field('Colour', `the ink of the project's mark: ${ProjectInk.literals.join(', ')}`, ProjectInk),
            worksIn: field('New tasks start', 'worktree (a folder of their own) or checkout (Local, in the person’s checkout)', WorksIn),
            workToward: field(
              'Work toward',
              'by repository name, the branch new tasks work toward there, or null for its default branch: { "app": "release/0.8.0" }',
              Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
            ),
            resolveConflicts: field('Resolve conflicts automatically', SWITCH, Schema.Boolean),
            pushCommits: field('Push the lead’s commits automatically', SWITCH, Schema.Boolean),
            postScreenshots: field('Post screenshots automatically', SWITCH, Schema.Boolean),
            moveIssues: field('Move issues automatically', SWITCH, Schema.Boolean),
          },
          read: (projectId) =>
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const [project] = yield* sql<{ name: string; ink: string | null }>`SELECT name, ink FROM projects WHERE id = ${projectId}`
              const { view } = yield* rulesOf(projectId)
              const repositories = yield* repositoriesOf(projectId)
              return {
                name: project?.name ?? '',
                ink: project?.ink ?? null,
                ...pick(view, ['worksIn', 'resolveConflicts', 'pushCommits', 'postScreenshots', 'moveIssues']),
                workToward: Object.fromEntries(repositories.map((one) => [one.name, one.workToward])),
              }
            }),
          write: (projectId, change, actorId) =>
            Effect.gen(function* () {
              const projects = yield* Projects
              if (typeof change['name'] === 'string') yield* projects.rename(projectId, change['name'])
              if (typeof change['ink'] === 'string') yield* projects.setInk(projectId, change['ink'] as ProjectInk)
              if (change['workToward'] !== undefined)
                for (const { repository, value } of yield* byName(projectId, change['workToward'] as Values))
                  yield* projects.setRepository({ projectId, repositoryId: repository.id, workToward: value as string | null }).pipe(
                    // As the screen says it: a branch new tasks work toward is one the repository has.
                    Effect.catchIf(
                      (error) => error instanceof BranchNotFound,
                      () =>
                        Effect.fail(
                          new ToolRefused({
                            message: `${repository.name} has no branch ${String(value)}: new tasks work toward one it has.`,
                          }),
                        ),
                    ),
                  )
              const rules = pick(change, ['worksIn', 'resolveConflicts', 'pushCommits', 'postScreenshots', 'moveIssues'])
              const given = Object.fromEntries(Object.entries(rules).filter(([, value]) => value !== undefined))
              if (Object.keys(given).length > 0) yield* writeRules(projectId, given, actorId)
            }),
        },
        {
          id: 'project/code',
          title: 'Code and issues',
          scope: 'project',
          note: "Adding a repository, connecting a code host or a tracker, and leaving a repository out are the person's: say so, and they do it here.",
          fields: {
            repositories: field(
              'Repositories',
              `by name, each one's role (${RepositoryRole.literals.join(', ')}) and, for a fork, where its work goes (upstream or fork): { "app": { "role": "frontend" } }`,
              Schema.Record(
                Schema.String,
                Schema.Struct({
                  role: Schema.optional(RepositoryRole),
                  changeTarget: Schema.optional(Schema.NullOr(Schema.Literals(['upstream', 'fork', 'upstream_branch']))),
                }),
              ),
            ),
            tracker: field(
              'Tracker',
              'the connection its issues are on, by its id as althar/code-hosts lists it, and where on it ({ id, name }), or null to learn it from its issues',
              Schema.NullOr(ProjectTracker),
            ),
          },
          read: (projectId) =>
            Effect.gen(function* () {
              const repositories = yield* repositoriesOf(projectId)
              const bound = yield* projectTracker(projectId)
              return {
                repositories: Object.fromEntries(
                  repositories.map((one) => [one.name, { role: one.role, changeTarget: one.fork?.target ?? null }]),
                ),
                tracker: bound === null ? null : { connectionId: bound.connectionId, container: bound.container },
              }
            }),
          write: (projectId, change) =>
            Effect.gen(function* () {
              const projects = yield* Projects
              if (change['repositories'] !== undefined)
                for (const { repository, value } of yield* byName(projectId, change['repositories'] as Values)) {
                  const asked = value as { role?: string; changeTarget?: string | null }
                  // Pushing branches upstream needs the host to say the person can push there: chosen on the screen, which asks it.
                  if (asked.changeTarget === 'upstream_branch')
                    return yield* new ToolRefused({
                      message: `Branches upstream are the person's to choose for ${repository.name}, on the screen, where Althar checks they can push there.`,
                    })
                  yield* projects.setRepository({
                    projectId,
                    repositoryId: repository.id,
                    ...(asked.role === undefined ? {} : { role: asked.role }),
                    ...(asked.changeTarget == null || repository.fork === null ? {} : { changeTarget: asked.changeTarget }),
                  })
                }
              if (change['tracker'] !== undefined)
                yield* projects.setTracker(
                  projectId,
                  change['tracker'] as { connectionId: string; container: { id: string; name: string } | null } | null,
                )
            }),
        },
        {
          id: 'project/rules',
          title: 'Rules',
          scope: 'project',
          fields: {
            permissions: field('What no rule keeps', 'ask, coordinator (it decides) or rules (allowed)', Schema.Literals(MODES), {
              loosens: toward(MODES),
              loosening: 'toward fewer asks: ask, then coordinator, then rules',
            }),
            allowEverything: field('Allow everything', SWITCH, Schema.Boolean, { loosens: turnedOn, loosening: 'turned on' }),
            alwaysAsk: field('Ask me', kinds, Schema.Array(RuleKind), { loosening: 'a kind taken out, unless it moves to Never' }),
            never: field('Never', kinds, Schema.Array(RuleKind), { loosening: 'a kind taken out' }),
            alwaysAllow: field('Always allow', kinds, Schema.Array(RuleKind), { loosening: 'a kind added' }),
            commands: field(
              'Commands',
              'the whole list of commands named: { "pattern": "npm publish", "decision": "ask" | "never" | "allow", "match"?: "prefix" | "exact" }',
              Schema.Array(CommandRule),
              { loosening: 'a command taken out of never or ask, moved toward allow, or allowed' },
            ),
            sandboxCommands: field(
              'Commands that run outside the sandbox',
              'the whole list, by how each starts',
              Schema.Array(Schema.String),
              {
                loosens: added,
                loosening: 'a command added',
              },
            ),
            sandboxHosts: field('Hosts the sandbox reaches', 'the whole list, by name', Schema.Array(Schema.String), {
              loosens: added,
              loosening: 'a host added',
            }),
            leadsReachWeb: field('Leads can reach the web', SWITCH, Schema.Boolean, { loosens: turnedOn, loosening: 'turned on' }),
            usageLimit: field('At an agent’s usage limit', 'move (to another), wait, or ask', UsageLimit),
            rotateAccounts: field('Move to an agent’s next account', SWITCH, Schema.Boolean),
            onlyAccounts: field(
              'Accounts its work runs on',
              'by agent id, the account ids it may use, or null for every account',
              Schema.NullOr(Schema.Record(Schema.String, Schema.Array(Schema.String))),
            ),
            end: field(
              'How a task ends',
              'draft, ready (a pull request), none (its branch), or null for a draft where Althar is connected',
              Schema.NullOr(Schema.Literals(['draft', 'ready', 'none'])),
            ),
            repositoryFiles: field(
              'Skill and OpenSpec files',
              '{ "writeSkills", "writeOpenSpec", "pushProtected" }, each true or false',
              RepositoryFilesSetting,
              {
                loosens: (before, after) => {
                  const was = before as Record<string, boolean>
                  const now = after as Record<string, boolean>
                  return Object.keys(now).some((key) => now[key] === true && was[key] !== true)
                },
                loosening: 'any of them turned on',
              },
            ),
          },
          read: (projectId) =>
            Effect.map(rulesOf(projectId), ({ view }) =>
              pick(view, [
                'permissions',
                'allowEverything',
                'alwaysAsk',
                'never',
                'alwaysAllow',
                'commands',
                'sandboxCommands',
                'sandboxHosts',
                'leadsReachWeb',
                'usageLimit',
                'rotateAccounts',
                'onlyAccounts',
                'end',
                'repositoryFiles',
              ]),
            ),
          write: writeRules,
          loosens: rulesLoosened,
        },
        {
          id: 'project/running',
          title: 'Running',
          scope: 'project',
          note: 'What the project runs is set_run_command and keep_run.',
          fields: {
            setup: field(
              'Setup before each task',
              'by repository name, { "copy": [files from its checkout], "commands": [lines run in each new worktree] }, or null for what Althar works out',
              Schema.Record(Schema.String, Schema.NullOr(RepositorySetup)),
            ),
            branchPattern: field('Branch names', 'a pattern, or null for what each repository says', Schema.NullOr(Schema.String)),
            titlePattern: field('Pull request titles', 'a pattern, or null for what each repository says', Schema.NullOr(Schema.String)),
          },
          read: (projectId) =>
            Effect.gen(function* () {
              const { view } = yield* rulesOf(projectId)
              const repositories = yield* repositoriesOf(projectId)
              return {
                setup: Object.fromEntries(repositories.map((one) => [one.name, one.setup])),
                ...pick(view, ['branchPattern', 'titlePattern']),
              }
            }),
          write: (projectId, change, actorId) =>
            Effect.gen(function* () {
              const projects = yield* Projects
              if (change['setup'] !== undefined)
                for (const { repository, value } of yield* byName(projectId, change['setup'] as Values))
                  yield* projects.setRepository({
                    projectId,
                    repositoryId: repository.id,
                    setup: (value as { copy: ReadonlyArray<string>; commands: ReadonlyArray<string> } | null) ?? { copy: [], commands: [] },
                  })
              const patterns = Object.fromEntries(
                Object.entries(pick(change, ['branchPattern', 'titlePattern'])).filter(([, value]) => value !== undefined),
              )
              if (Object.keys(patterns).length > 0) yield* writeRules(projectId, patterns, actorId)
            }),
        },
        {
          id: 'project/notes',
          title: 'Notes',
          scope: 'project',
          note: 'Keep one with keep_note, drop one with drop_note.',
          fields: {},
          read: (projectId) => Effect.map(notesOf(projectId), (notes) => ({ notes: notes.map((note) => note.body) })),
        },

        /* ---- Althar's own ---- */
        {
          id: 'althar/agents',
          title: 'Agents',
          scope: 'althar',
          note: "Signing an agent's accounts in or out is the person's.",
          fields: {
            efforts: field(
              'Default efforts',
              'by "agent/model" (as list_models names them), the effort a session on it starts at: { "claude-code/opus": "high" }',
              Schema.Record(Schema.String, Schema.String),
            ),
            turnedOff: field(
              'Models turned off',
              'by agent id, the whole list of its models turned off: { "codex": ["gpt-6.1-luna"] }',
              Schema.Record(Schema.String, Schema.Array(Schema.String)),
            ),
          },
          read: () =>
            Effect.gen(function* () {
              const catalog = yield* (yield* Models).catalog
              return {
                efforts: Object.fromEntries(
                  catalog.flatMap((agent) => agent.defaults.map((one) => [`${agent.agentId}/${one.model}`, one.effort])),
                ),
                turnedOff: Object.fromEntries(catalog.map((agent) => [agent.agentId, agent.blocked])),
              }
            }),
          write: (_projectId, change) =>
            Effect.gen(function* () {
              const models = yield* Models
              for (const [key, effort] of Object.entries((change['efforts'] as Record<string, string> | undefined) ?? {})) {
                const at = key.indexOf('/')
                if (at <= 0) return yield* new ToolRefused({ message: `Name each as "agent/model": ${key} isn't.` })
                yield* models.setDefaultEffort({ agentId: key.slice(0, at), model: key.slice(at + 1), effort })
              }
              const catalog = yield* models.catalog
              for (const [agentId, off] of Object.entries(
                (change['turnedOff'] as Record<string, ReadonlyArray<string>> | undefined) ?? {},
              )) {
                const was = catalog.find((agent) => agent.agentId === agentId)?.blocked ?? []
                for (const model of off.filter((one) => !was.includes(one)))
                  yield* models.setModelBlocked({ agentId, model, blocked: true })
                for (const model of was.filter((one) => !off.includes(one)))
                  yield* models.setModelBlocked({ agentId, model, blocked: false })
              }
            }),
        },
        {
          id: 'althar/skills',
          title: 'Skills',
          scope: 'althar',
          note: "Installing and removing a skill is the person's.",
          fields: {
            skills: field(
              'Skills on',
              'by skill id, true for on, false for off: { "frontend-design": false }',
              Schema.Record(Schema.String, Schema.Boolean),
            ),
          },
          read: () =>
            Effect.gen(function* () {
              const store = (yield* RuntimeConfig).skills
              if (store === undefined) return { skills: {} }
              const listed = yield* listSkills(store)
              return { skills: Object.fromEntries(listed.skills.map((skill) => [skill.id, skill.active === true])) }
            }),
          write: (_projectId, change, actorId) =>
            Effect.gen(function* () {
              const store = (yield* RuntimeConfig).skills
              if (store === undefined) return yield* new ToolRefused({ message: 'Skills are off in this Althar.' })
              const sql = yield* SqlClient.SqlClient
              for (const [id, active] of Object.entries((change['skills'] as Record<string, boolean> | undefined) ?? {})) {
                const install = yield* setActive(store.root, id, active)
                // Recorded as the person's own acts on skills are, under the agent's name.
                const [last] = yield* sql<{ revision: number | null }>`
                  SELECT max(aggregate_revision) AS revision FROM record_events WHERE aggregate_type = 'skill' AND aggregate_id = ${id}`
                yield* fact({
                  aggregateType: 'skill',
                  aggregateId: id,
                  revision: (last?.revision ?? 0) + 1,
                  type: active ? 'skill.turned_on' : 'skill.turned_off',
                  payload: { id, treeHash: install.treeHash },
                  actorId,
                })
              }
            }),
        },
        {
          id: 'althar/code-hosts',
          title: 'Code hosts and trackers',
          scope: 'althar',
          note: "Connecting, signing in and removing a connection are the person's.",
          fields: {},
          read: () =>
            Effect.gen(function* () {
              const list = yield* (yield* Connections).list
              return {
                connections: list.map(
                  (one) => `${one.name} as ${one.account.login} (${one.id})${one.state === 'ready' ? '' : ', signed out'}`,
                ),
              }
            }),
        },
        {
          id: 'althar/this-mac',
          title: 'Work on this computer',
          scope: 'althar',
          note: 'Keeping awake, CPU and memory in the bar and opening at login are kept in the window; the person sets them there.',
          fields: {
            agentsAtOnce: field('Agents at once', 'a number from 1 to 16, or null for what Althar works out', Schema.NullOr(AtOnceCount)),
            folderWait: field('When finished tasks’ folders go', FolderWait.literals.join(', '), FolderWait),
            automationsPaused: field('Pause all automations', SWITCH, Schema.Boolean, {
              loosens: (before, after) => before === true && after === false,
              loosening: 'un-paused',
            }),
          },
          read: () =>
            Effect.gen(function* () {
              const atOnce = yield* (yield* Busy).atOnce
              return {
                agentsAtOnce: atOnce.own ? atOnce.count : null,
                folderWait: yield* (yield* FolderCleanup).wait,
                automationsPaused: yield* (yield* Automations).allPaused,
              }
            }),
          write: (_projectId, change) =>
            Effect.gen(function* () {
              if (change['agentsAtOnce'] !== undefined) yield* (yield* Busy).set(change['agentsAtOnce'] as number | null)
              if (change['folderWait'] !== undefined) yield* (yield* FolderCleanup).setWait(change['folderWait'] as typeof FolderWait.Type)
              if (change['automationsPaused'] !== undefined)
                yield* (yield* Automations).setAllPaused(change['automationsPaused'] as boolean)
            }),
        },
        {
          id: 'althar/plans-and-reviews',
          title: 'Plans and reviews',
          scope: 'althar',
          fields: {
            countdown: field('Plan countdown', 'seconds: 0, 10, 25 or 60', PlansAndReviews.fields.countdown),
            rounds: field('Review rounds', '1, 2, 3 or 5', PlansAndReviews.fields.rounds),
            roundsOut: field('When rounds run out', 'settled (go on once findings are settled) or ask', PlansAndReviews.fields.roundsOut),
          },
          read: () => Effect.map(plansAndReviewsOf, (kept) => ({ ...kept })),
          write: (_projectId, change) => setPlansAndReviews(change as Partial<typeof PlansAndReviews.Type>),
        },
        {
          id: 'althar/new-projects',
          title: 'New projects',
          scope: 'althar',
          fields: {
            permissions: field('What no rule keeps', 'ask, coordinator or rules', NewProjectDefaults.fields.permissions, {
              loosens: toward(MODES),
              loosening: 'toward fewer asks: ask, then coordinator, then rules',
            }),
            usageLimit: field('At an agent’s usage limit', 'move, wait or ask', NewProjectDefaults.fields.usageLimit),
            rotateAccounts: field('Move to an agent’s next account', SWITCH, NewProjectDefaults.fields.rotateAccounts),
            end: field('How a task ends', 'draft, ready or none', NewProjectDefaults.fields.end),
          },
          read: () => Effect.map(newProjectDefaultsOf, (kept) => ({ ...kept })),
          write: (_projectId, change) => setNewProjectDefaults(change as Partial<typeof NewProjectDefaults.Type>),
        },
        {
          id: 'althar/reviews',
          title: 'Reviews and pull requests',
          scope: 'althar',
          fields: {
            postTeamReviews: field('Post reviews of the team’s pull requests without asking', SWITCH, Schema.Boolean, {
              loosens: turnedOn,
              loosening: 'turned on',
            }),
            coAuthor: field('Althar as co-author', SWITCH, Schema.Boolean),
            reviewSeal: field('The review seal', SWITCH, Schema.Boolean),
            reviewSealStyle: field('The seal’s look', SealStyle.literals.join(', '), SealStyle),
          },
          read: () =>
            Effect.gen(function* () {
              const seal = yield* reviewSeal
              return {
                postTeamReviews: yield* postTeamReviews,
                coAuthor: yield* coAuthorOn,
                reviewSeal: seal.on,
                reviewSealStyle: seal.style,
              }
            }),
          write: (_projectId, change) =>
            Effect.gen(function* () {
              if (change['postTeamReviews'] !== undefined) yield* setPostTeamReviews(change['postTeamReviews'] as boolean)
              if (change['coAuthor'] !== undefined) yield* setCoAuthor(change['coAuthor'] as boolean)
              if (change['reviewSeal'] !== undefined) yield* setReviewSeal(change['reviewSeal'] as boolean)
              if (change['reviewSealStyle'] !== undefined) yield* setReviewSealStyle(change['reviewSealStyle'] as typeof SealStyle.Type)
            }),
        },
        ...(['notifications', 'appearance', 'editor', 'browser'] as const).map((id): Section => ({
          id: `althar/${id}`,
          title: { notifications: 'Notifications', appearance: 'Appearance', editor: 'Editor', browser: 'Browser' }[id],
          scope: 'althar',
          note: 'Kept in the window on this computer: the person sets these there.',
          fields: {},
          read: () => Effect.succeed({}),
        })),
        {
          id: 'althar/about',
          title: 'About Althar',
          scope: 'althar',
          note: 'Usage data and crash reports are kept in the window on this computer: the person sets them there.',
          fields: {},
          read: () => Effect.succeed({}),
        },
      ]

      const sectionOf = (id: string | undefined) => {
        const wanted = (id ?? '').trim().toLowerCase().replace(/^\//, '')
        return SECTIONS.find((one) => one.id === wanted || one.id.endsWith(`/${wanted}`))
      }
      const unknownSection = (id: string) =>
        new ToolRefused({ message: `There is no section ${id}. The sections: ${SECTIONS.map((one) => one.id).join(', ')}.` })

      /** A section in words: each setting with its key, its words, its value, what it takes and how it loosens. */
      const described = (section: Section, values: Values) => {
        const keys = Object.keys(section.fields)
        const lines = [`${section.id} — ${section.title}${section.note === undefined ? '' : `. ${section.note}`}`]
        for (const key of keys) {
          const one = section.fields[key]!
          lines.push(
            `- ${key} (${one.label}): ${stable(values[key])}. Takes ${one.takes}.${one.loosening === undefined ? '' : ` Loosens what asks when ${one.loosening}: that needs the person's own message in the turn.`}`,
          )
        }
        for (const [key, value] of Object.entries(values))
          if (!(key in section.fields)) lines.push(`- ${key}: ${stable(value)} (read only here)`)
        if (keys.length === 0 && Object.keys(values).length === 0 && section.note === undefined) lines.push('- Nothing to set.')
        return lines.join('\n')
      }

      const readSettings = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const asked = yield* read(Reading, input, 'that')
          if (asked.section !== undefined) {
            const section = sectionOf(asked.section)
            if (section === undefined) return yield* unknownSection(asked.section)
            return described(section, yield* section.read(access.projectId))
          }
          const all = yield* Effect.forEach(SECTIONS, (section) =>
            Effect.map(
              Effect.orElseSucceed(section.read(access.projectId), () => null),
              (values) => (values === null ? `${section.id} — ${section.title}: Althar couldn't read it now.` : described(section, values)),
            ),
          )
          return [
            'Settings, as the Settings screens show them: project/… are this project’s, althar/… Althar’s own. change_settings changes one section at a time, in the shape each takes.',
            ...all,
          ].join('\n\n')
        })

      /** Who an agent is, as a line names it. */
      const changerOf = (access: ToolAccess) =>
        Effect.gen(function* () {
          if (access.role === 'coordinator') return { kind: 'coordinator' as const, taskId: null, title: null }
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ title: string }>`SELECT title FROM tasks WHERE id = ${access.taskId ?? ''}`
          return { kind: 'lead' as const, taskId: access.taskId, title: task?.title ?? null }
        })
      const actorOf = (by: SettingChanger) => (by.kind === 'coordinator' ? instance.coordinatorId : instance.systemId)
      const projectNameOf = (projectId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ name: string }>`SELECT name FROM projects WHERE id = ${projectId}`
          return row?.name ?? null
        })

      /** The person's own message in this turn that a loosening acts on: the one named, or their latest. Undefined where there is none. */
      const wordsOf = (access: ToolAccess, messageId: string | undefined) =>
        Effect.gen(function* () {
          if (access.role === 'reviewer' || access.byPerson !== true || access.turnId == null) return undefined
          const ids = access.messages ?? []
          if (ids.length === 0) return undefined
          if (messageId !== undefined && !ids.includes(messageId)) return undefined
          const sql = yield* SqlClient.SqlClient
          const [message] = yield* sql<{ body: string }>`
            SELECT body FROM user_inputs WHERE id IN ${sql.in(messageId === undefined ? ids : [messageId])} ORDER BY sequence DESC LIMIT 1`
          return message?.body
        })

      const movesOf = (section: Section, before: Values, after: Values) =>
        Object.keys(after).map((key) => ({
          key,
          label: section.fields[key]?.label ?? key,
          before: inWords(before[key]),
          after: inWords(after[key]),
        }))

      /** What of a change loosens what asks, in words; empty where nothing does. */
      const looseningOf = (section: Section, before: Values, after: Values, current: Values) => {
        const fields = Object.entries(after).flatMap(([key, value]) => {
          const loosens = section.fields[key]?.loosens
          return loosens !== undefined && loosens(before[key], value) ? [section.fields[key]!.label] : []
        })
        return [...fields, ...(section.loosens?.({ ...current, ...before }, { ...current, ...after }) ?? [])]
      }

      /** Makes a change, keeps it, and says it in the agent's thread with Undo. Its row's id. */
      const make = (input: {
        readonly access: ToolAccess
        readonly section: Section
        readonly change: Values
        readonly before: Values
        readonly after: Values
        readonly by: SettingChanger
        readonly loosens: boolean
        readonly words: string | null
        readonly actorId: ActorId
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { access, section } = input
          yield* section.write!(access.projectId, input.change, input.actorId)
          const id = yield* newId(Ids.threadItem)
          const at = yield* timestamp
          const card: SettingChangeCard = {
            changeId: id,
            section: section.id,
            title: section.title,
            project: section.scope === 'project' ? yield* projectNameOf(access.projectId) : null,
            moves: movesOf(section, input.before, input.after),
            by: input.by,
            loosens: input.loosens,
            words: input.words,
            why: null,
            state: 'done',
            said: null,
          }
          const itemId = yield* addItem({ projectId: access.projectId as ProjectId, threadId: access.threadId }, 'setting', card)
          yield* sql`INSERT INTO setting_changes ${sql.insert({
            id,
            projectId: section.scope === 'project' ? access.projectId : null,
            section: section.id,
            change: stable(input.change),
            before: stable(input.before),
            after: stable(input.after),
            byKind: input.by.kind === 'person' ? 'coordinator' : input.by.kind,
            byTaskId: input.by.taskId,
            threadId: access.threadId,
            itemId,
            words: input.words,
            loosens: input.loosens ? 1 : 0,
            state: 'done',
            createdAt: at,
            updatedAt: at,
          })}`
          yield* fact({
            ...(section.scope === 'project' ? { projectId: access.projectId as ProjectId } : {}),
            aggregateType: 'setting',
            aggregateId: id,
            revision: 1,
            type: 'setting.changed',
            payload: { section: section.id, before: input.before, after: input.after, by: input.by, words: input.words },
            actorId: input.actorId,
          })
          return id
        })

      /** Sets a row's state, and its line's. */
      const settle = (row: ChangeRow, state: SettingChangeCard['state'], said: string | null, changeId?: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const at = yield* timestamp
          yield* sql`UPDATE setting_changes SET state = ${state}, updated_at = ${at}, revision = revision + 1 WHERE id = ${row.id}`
          if (row.itemId === null) return
          const [item] = yield* sql<{
            content: string
            projectId: ProjectId
          }>`SELECT content, project_id FROM thread_items WHERE id = ${row.itemId}`
          if (item === undefined) return
          const content = JSON.parse(item.content) as SettingChangeCard
          yield* updateItem(item.projectId, row.itemId, { ...content, state, said, ...(changeId === undefined ? {} : { changeId }) })
          yield* fact({
            ...(row.projectId === null ? {} : { projectId: row.projectId as ProjectId }),
            aggregateType: 'setting',
            aggregateId: row.id,
            revision: 2,
            type: `setting.${state}`,
            payload: { said },
            actorId: instance.systemId,
          })
        })

      const change = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const asked = yield* read(Changing, input, 'that change')
          if (access.role === 'reviewer') return yield* new ToolRefused({ message: 'A reviewer only reads.' })
          let section: Section | undefined
          let given: Values
          let undoing: ChangeRow | undefined
          if (asked.undo !== undefined) {
            ;[undoing] = yield* sql<ChangeRow>`SELECT * FROM setting_changes WHERE (id = ${asked.undo} OR item_id = ${asked.undo})
              AND (project_id = ${access.projectId} OR project_id IS NULL)`
            if (undoing === undefined) return yield* new ToolRefused({ message: `There is no change ${asked.undo} to undo.` })
            if (undoing.state !== 'done')
              return yield* new ToolRefused({ message: `That change is ${undoing.state} already: there is nothing to undo.` })
            section = sectionOf(undoing.section)
            given = JSON.parse(undoing.before) as Values
          } else {
            if (asked.section === undefined || asked.change === undefined)
              return yield* new ToolRefused({
                message: 'Name the section and give what of it changes, as read_settings shows it; or undo a change by its id.',
              })
            section = sectionOf(asked.section)
            if (section === undefined) return yield* unknownSection(asked.section)
            given = asked.change
          }
          if (section === undefined) return yield* unknownSection(undoing?.section ?? '')
          if (section.write === undefined || Object.keys(section.fields).length === 0)
            return yield* new ToolRefused({
              message: `${section.title} has nothing to change here.${section.note === undefined ? '' : ` ${section.note}`}`,
            })
          // Each setting given, read as its screen takes it.
          const change: Record<string, unknown> = {}
          for (const [key, value] of Object.entries(given)) {
            const one = section.fields[key]
            if (one === undefined)
              return yield* new ToolRefused({
                message: `${section.id} has no setting ${key}. Its settings: ${Object.keys(section.fields).join(', ')}.`,
              })
            change[key] = yield* read(one.schema, value, `${key}`)
          }
          const current = yield* section.read(access.projectId)
          const before = pick(current, Object.keys(change))
          const after = Object.fromEntries(Object.entries(change).filter(([key, value]) => !same(before[key], value)))
          if (Object.keys(after).length === 0) return `Nothing changed: ${section.title} is so already.`
          const moved = pick(before, Object.keys(after))
          const by = yield* changerOf(access)
          const loosened = looseningOf(section, moved, after, current)
          const words = loosened.length === 0 ? undefined : yield* wordsOf(access, asked.message_id)
          if (loosened.length > 0 && words === undefined) {
            // A card the person presses: Althar keeps what it would change, and makes it as they press.
            const id = yield* newId(Ids.threadItem)
            const at = yield* timestamp
            const card: SettingChangeCard = {
              changeId: null,
              section: section.id,
              title: section.title,
              project: section.scope === 'project' ? yield* projectNameOf(access.projectId) : null,
              moves: movesOf(section, moved, after),
              by,
              loosens: true,
              words: null,
              why: asked.why?.trim() || null,
              state: 'asked',
              said: null,
            }
            const itemId = yield* addItem({ projectId: access.projectId as ProjectId, threadId: access.threadId }, 'setting', card)
            yield* sql`INSERT INTO setting_changes ${sql.insert({
              id,
              projectId: section.scope === 'project' ? access.projectId : null,
              section: section.id,
              change: stable(after),
              before: stable(moved),
              after: stable(after),
              byKind: by.kind,
              byTaskId: by.taskId,
              threadId: access.threadId,
              itemId,
              words: null,
              loosens: 1,
              state: 'asked',
              createdAt: at,
              updatedAt: at,
            })}`
            return `That loosens what asks (${loosened.join(', ')}), and no message of the person's in this turn asked for it, so it waits for them on a card in your thread: it is made once they press it. Say so in a sentence.`
          }
          const id = yield* make({
            access,
            section,
            change: after,
            before: moved,
            after,
            by,
            loosens: loosened.length > 0,
            words: words ?? null,
            actorId: actorOf(by),
          })
          if (undoing !== undefined) yield* settle(undoing, 'undone', null)
          const said = Object.entries(after)
            .map(([key, value]) => `${section.fields[key]?.label ?? key}: ${inWords(moved[key])} → ${inWords(value)}`)
            .join('; ')
          return `${undoing === undefined ? 'Changed' : 'Undid'} ${section.title}: ${said}. A line in your thread says so, with Undo; Settings shows it at once. To put it back yourself, change_settings with undo: ${id}.`
        })

      /** The settings in a section now, for a row's keys, and whether they are still as one side of it left them. */
      const still = (row: ChangeRow, side: 'before' | 'after') =>
        Effect.gen(function* () {
          const section = sectionOf(row.section)
          if (section === undefined) return { section, matches: false }
          const values = JSON.parse(side === 'before' ? row.before : row.after) as Values
          const projectId = row.projectId ?? (yield* projectOfThread(row.threadId))
          const current = yield* section.read(projectId)
          return { section, projectId, matches: Object.keys(values).every((key) => same(current[key], values[key])) }
        })
      const projectOfThread = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ projectId: string }>`SELECT project_id FROM threads WHERE id = ${threadId}`
          return row?.projectId ?? ''
        })
      const rowOfItem = (itemId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<ChangeRow>`SELECT * FROM setting_changes WHERE item_id = ${itemId}`
          return row
        })
      const changerOfRow = (row: ChangeRow) =>
        Effect.gen(function* () {
          if (row.byKind === 'coordinator') return { kind: 'coordinator' as const, taskId: null, title: null }
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ title: string }>`SELECT title FROM tasks WHERE id = ${row.byTaskId ?? ''}`
          return { kind: 'lead' as const, taskId: row.byTaskId, title: task?.title ?? null }
        })

      const answer = (itemId: string, yes: boolean) =>
        Effect.gen(function* () {
          const row = yield* rowOfItem(itemId)
          if (row === undefined || row.state !== 'asked') return
          if (!yes) return yield* settle(row, 'declined', null)
          const { section, projectId, matches } = yield* still(row, 'before')
          if (section === undefined || projectId === undefined || !matches)
            return yield* settle(row, 'moot', 'It changed since it was asked, so nothing was done.')
          const sql = yield* SqlClient.SqlClient
          const after = JSON.parse(row.after) as Values
          // The person's press is their word: made as their own change, its line the card's. They wrote nothing, so no words
          // are kept: the card, pressed, is the record (`pressed` on the fact).
          yield* section.write!(projectId, JSON.parse(row.change) as Values, instance.personId)
          const at = yield* timestamp
          yield* sql`UPDATE setting_changes SET state = 'done', updated_at = ${at}, revision = revision + 1 WHERE id = ${row.id}`
          const [item] = yield* sql<{
            content: string
            projectId: ProjectId
          }>`SELECT content, project_id FROM thread_items WHERE id = ${itemId}`
          if (item !== undefined) {
            const content = JSON.parse(item.content) as SettingChangeCard
            yield* updateItem(item.projectId, itemId, { ...content, state: 'done', changeId: row.id, said: null })
          }
          yield* fact({
            ...(row.projectId === null ? {} : { projectId: row.projectId as ProjectId }),
            aggregateType: 'setting',
            aggregateId: row.id,
            revision: 2,
            type: 'setting.changed',
            payload: { section: row.section, before: JSON.parse(row.before), after, pressed: true },
            actorId: instance.personId,
          })
        })

      const undo = (itemId: string) =>
        Effect.gen(function* () {
          const row = yield* rowOfItem(itemId)
          if (row === undefined || row.state !== 'done') return
          const { section, projectId, matches } = yield* still(row, 'after')
          if (section === undefined || projectId === undefined || !matches)
            return yield* settle(row, 'moot', 'It changed again since, so Undo left it as it is.')
          // The person's press: what was there goes back at once, whatever it loosens.
          yield* section.write!(projectId, JSON.parse(row.before) as Values, instance.personId)
          yield* settle(row, 'undone', null)
        })

      const changed = (projectId: string | null) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<ChangeRow>`
            SELECT * FROM setting_changes WHERE state = 'done' AND project_id IS ${projectId} ORDER BY updated_at DESC, rowid DESC`
          const seen = new Set<string>()
          const found: Array<SettingChanged> = []
          const currents = new Map<string, Values>()
          for (const row of rows) {
            const section = sectionOf(row.section)
            if (section === undefined) continue
            const after = JSON.parse(row.after) as Values
            for (const key of Object.keys(after)) {
              const at = `${row.section}#${key}`
              if (seen.has(at)) continue
              seen.add(at)
              if (!currents.has(row.section))
                currents.set(
                  row.section,
                  yield* section.read(projectId ?? (yield* projectOfThread(row.threadId))).pipe(Effect.orElseSucceed(() => ({}))),
                )
              // Shown only while it stays as the agent left it: changed since, by anyone, it is theirs now.
              if (!same(currents.get(row.section)?.[key], after[key])) continue
              found.push({
                section: row.section,
                key,
                label: section.fields[key]?.label ?? key,
                by: yield* changerOfRow(row),
                at: row.updatedAt,
                threadId: row.threadId,
              })
            }
          }
          return found
        })

      const tool = (
        name: string,
        description: string,
        input: Readonly<Record<string, unknown>>,
        call: (access: ToolAccess, input: unknown) => Effect.Effect<string, unknown, Needs>,
      ): Tool => ({
        name,
        description,
        input,
        call: (value, access) =>
          provide(call(access, value)).pipe(
            Effect.catch((error) =>
              error instanceof ToolRefused
                ? Effect.fail(error)
                : Effect.andThen(
                    Effect.logWarning('A settings tool did not succeed', error),
                    Effect.fail(new ToolRefused({ message: 'Althar could not do that. Try again, or tell the person.' })),
                  ),
            ),
          ),
      })

      yield* (yield* ToolServer).serve(POOL, [
        tool(
          'read_settings',
          `The settings the Settings screens show, as the person sees them: this project's (project/general, project/code, project/rules, project/running, project/notes) and Althar's own (althar/agents, althar/skills, althar/this-mac, althar/plans-and-reviews, althar/new-projects, althar/reviews and the rest). One section by its name, or every one: each setting with its key, its words on the screen, its value, what it takes, and whether a change to it loosens what asks. Read a section before you change it.`,
          {
            type: 'object',
            properties: {
              section: { type: 'string', description: 'A section, as project/rules or althar/plans-and-reviews; every one without it.' },
            },
          },
          readSettings,
        ),
        tool(
          'change_settings',
          "Changes settings in one section, as the person can on its screen, through the same call, so the screen shows it at once: give the section and, in change, each setting by its key in the shape read_settings says it takes (a list whole). Each change is a line in your thread, before and after, with Undo, and Settings says who changed it. Tightening (asking more, pausing, turning something off) and plain changes go at once. A change that loosens what asks (fewer asks, a rule taken out of Never or Ask me, Allow everything on, a host or command let through, the team's reviews posted unasked, automations un-paused) goes only where the person's own message in this turn asked for it, and the line quotes them (name it with message_id, as read_turn gives it, where they sent several); otherwise it waits for them on a card. Undo a change with undo and its id: undoing a tightening is a loosening. Secrets, sign-ins, connections and removing a repository or the project stay the person's.",
          {
            type: 'object',
            properties: {
              section: { type: 'string', description: 'The section, as read_settings names it: project/rules, althar/plans-and-reviews.' },
              change: { type: 'object', description: 'Each setting that changes, by its key, in the shape read_settings says it takes.' },
              undo: { type: 'string', description: 'A change to put back, by the id its answer gave, instead of section and change.' },
              why: { type: 'string', description: 'Why, in a line, shown on the card where it waits for the person.' },
              message_id: {
                type: 'string',
                description: "The person's message in this turn the change acts on, where it loosens what asks.",
              },
            },
          },
          change,
        ),
      ])

      return SettingsTools.of({
        answer: (itemId, yes) => provide(answer(itemId, yes)),
        undo: (itemId) => provide(undo(itemId)),
        changed: (projectId) => provide(changed(projectId)),
      })
    }),
  )
}

/** The sections read_settings covers, by their addresses: every one the Settings screens list. */
export const SETTINGS_ADDRESSES: ReadonlyArray<string> = [
  ...PROJECT_SETTINGS_SECTIONS.map((id) => `project/${id}`),
  ...SETTINGS_SECTIONS.map((id) => `althar/${id}`),
]

/**
 * Every change a Settings screen makes, by the API call or the window's preference it makes it with, and how the
 * coordinator or a lead makes it too: a section's setting (`section.key`, through change_settings), another tool
 * (`tool:` its name), or the person's own (`person:` why) or the window's (`window:` why), which no agent makes. A test
 * walks the screens' calls against it, so a setting added to a screen without a way here fails it (ADR-097).
 */
export const SCREEN_CHANGES: Readonly<Record<string, string>> = {
  // project/general
  renameProject: 'project/general.name',
  setProjectInk: 'project/general.ink',
  createBranch: 'person: makes a branch on the code host, for Work toward; workToward names one that is there',
  removeProject: "person: removing the project can't be undone",
  // project/code
  setProjectTracker: 'project/code.tracker',
  setRepository: 'project/code.repositories',
  addRepositories: 'person: adding a repository is the person’s (project/code says so)',
  leaveOutRepository: 'person: leaving a repository out is the person’s (project/code says so)',
  addParentRemote: 'person: adds a remote to the person’s clone, for the repository a fork came from; never done for them',
  // project/rules
  setProjectRules: 'project/rules.never',
  // project/notes
  editProjectNote: 'tool:keep_note',
  dropProjectNote: 'tool:drop_note',
  // althar/agents
  setDefaultEffort: 'althar/agents.efforts',
  setModelBlocked: 'althar/agents.turnedOff',
  installAgent: 'person: installing an agent on this computer',
  addAccount: 'person: an agent’s accounts and their sign-ins',
  startAccountSignIn: 'person: an agent’s accounts and their sign-ins',
  signInAccount: 'person: an agent’s accounts and their sign-ins',
  pasteAccountSignInCode: 'person: an agent’s accounts and their sign-ins',
  cancelAccountSignIn: 'person: an agent’s accounts and their sign-ins',
  renameAccount: 'person: an agent’s accounts and their sign-ins',
  orderAccounts: 'person: an agent’s accounts and their sign-ins',
  removeAccount: 'person: an agent’s accounts and their sign-ins',
  // althar/skills
  setSkillActive: 'althar/skills.skills',
  stageSkill: 'person: installing a skill is the person’s',
  approveSkill: 'person: installing a skill is the person’s',
  rollBackSkill: 'person: installing a skill is the person’s',
  uninstallSkill: 'person: removing a skill is the person’s',
  // althar/code-hosts
  disconnect: 'person: connections and their sign-ins',
  // althar/this-mac
  setAgentsAtOnce: 'althar/this-mac.agentsAtOnce',
  setFolderWait: 'althar/this-mac.folderWait',
  setAutomationsPaused: 'althar/this-mac.automationsPaused',
  removeTaskFolder: "person: deleting a finished task's folder can't be undone",
  cleanUpFolders: "person: deleting finished tasks' folders can't be undone",
  keepAwake: 'window: kept in the window on this computer',
  awakeOnBattery: 'window: kept in the window on this computer',
  openAtLogin: 'window: kept in the window on this computer',
  showLoad: 'window: kept in the window on this computer',
  // althar/plans-and-reviews, althar/new-projects, althar/reviews
  setPlansAndReviews: 'althar/plans-and-reviews.countdown',
  setNewProjectDefaults: 'althar/new-projects.permissions',
  setPostTeamReviews: 'althar/reviews.postTeamReviews',
  setCoAuthor: 'althar/reviews.coAuthor',
  setReviewSeal: 'althar/reviews.reviewSeal',
  setReviewSealStyle: 'althar/reviews.reviewSealStyle',
  // althar/notifications, althar/appearance, althar/editor, althar/browser, althar/about
  notifyCalls: 'window: kept in the window on this computer',
  notifyReady: 'window: kept in the window on this computer',
  notifyStopped: 'window: kept in the window on this computer',
  badge: 'window: kept in the window on this computer',
  sound: 'window: kept in the window on this computer',
  lastSound: 'window: kept in the window on this computer',
  appearance: 'window: kept in the window on this computer',
  accent: 'window: kept in the window on this computer',
  editor: 'window: kept in the window on this computer',
  browserLinks: 'window: kept in the window on this computer',
  browserCookies: 'window: kept in the window on this computer',
  usageData: 'window: kept in the window on this computer',
  crashReports: 'window: kept in the window on this computer',
  openInEditor: 'window: opens a file in the person’s editor; no setting',
}
