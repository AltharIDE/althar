import { type AgentFacts, reportedAgents, type RuntimeFacts, type TurnFacts } from './facts'

/*
 * A report, put together (DEV-61): what the person wrote and chose, the
 * facts the app attaches without asking, and, when they keep it on, the
 * last errors and the tail of each log, every bit of it masked. It makes
 * the report the Worker takes (version 1 of its contract, apps/report),
 * the logs file beside it, and the preview the window lists under "See
 * what's sent". Nothing here reads a file or the network; the caller
 * gathers, this arranges.
 */

/** Where in the window it was asked from, as the window says. */
export interface ReportContext {
  readonly screen: string
  readonly projectId: string | null
  readonly taskId: string | null
  readonly threadId: string | null
  /** What it is about, in a few words, when asked from something that went wrong: "Stuck: Implement". */
  readonly about: string | null
}

/** A report opened for the window: its id, the preview of its screenshot, the email last given, and how it goes. */
export interface Opened {
  readonly reportId: string
  /** A picture of the window, for the preview, as a data URL; null where it couldn't be taken. */
  readonly screenshot: string | null
  /** The email the person gave last time. */
  readonly email: string | null
  /** Whether it is sent, or saved for the person's mail app. */
  readonly via: 'send' | 'mail'
}

/** How sending went: sent, saved for the mail app with the zip's name, or not, and why. */
export type Sent =
  | { readonly kind: 'sent' }
  | { readonly kind: 'saved'; readonly file: string }
  | { readonly kind: 'failed'; readonly reason: string }

/** What the person wrote and chose. */
export interface ReportChoices {
  readonly text: string
  readonly email: string | null
  readonly screenshot: boolean
  readonly logs: boolean
}

export interface AppFacts {
  readonly version: string
  readonly electron: string
  /** The system and its version, as people name it: macOS 26.5. */
  readonly os: string
  readonly arch: string
}

/** The tail of one log, as read. */
export interface LogTail {
  readonly name: string
  readonly text: string
}

/** A picture of the window, as it goes: a PNG, or a JPEG where a PNG would be more than the Worker takes. */
export interface Picture {
  readonly bytes: Uint8Array
  readonly type: 'image/png' | 'image/jpeg'
}

/** Everything gathered for a report, before the person sends it. */
export interface Gathered {
  readonly installId: string
  readonly app: AppFacts
  readonly context: ReportContext
  /** What the runtime said; null where it didn't answer. */
  readonly runtime: RuntimeFacts | null
  readonly logs: ReadonlyArray<LogTail>
  readonly screenshot: Picture | null
  /** Hides paths under the home folder, names, who the person is, and keys (mask.ts). */
  readonly mask: (text: string) => string
}

/** The report the Worker takes: version 1 of its contract. */
export interface ReportJson {
  readonly version: 1
  readonly installId: string
  readonly text: string
  readonly email: string | null
  readonly app: AppFacts
  readonly context: ReportContext
  readonly agents: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly version: string | null
    readonly adapter: string | null
    readonly signIn: AgentFacts['signIn']
  }>
  readonly migrations: { readonly count: number; readonly last: string | null }
  readonly errors: ReadonlyArray<string>
}

/** What "See what's sent" lists: the facts, and what goes with each switch. */
export interface ReportPreview {
  readonly app: AppFacts
  readonly installId: string
  readonly context: ReportContext
  /** Null where the runtime didn't answer. */
  readonly agents: ReadonlyArray<AgentFacts> | null
  readonly migrations: { readonly count: number; readonly last: string | null } | null
  readonly screenshot: boolean
  /** How many of the last errors go with the logs. */
  readonly errors: number
  /** Each log's tail that goes, by name and size in bytes. */
  readonly logs: ReadonlyArray<{ readonly name: string; readonly bytes: number }>
}

/** At most this many of the last errors go, each at most this long, as the Worker takes them. */
export const ERRORS = { count: 40, length: 500 }

/** The longest what a report is about may be, on one line, as the Worker takes it. */
const ABOUT = 200

/** Text on one line, cut to `max` characters. */
const oneLine = (text: string, max: number) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** A log line that says something went wrong: an error or warning the app or runtime logged, the runtime's stderr, or an agent's line that says error. */
const isError = (log: string, line: string) =>
  /\blevel=(ERROR|WARN|FATAL)\b/.test(line) || (log === 'runtime' && / stderr /.test(line)) || (log === 'agents' && /\berror\b/i.test(line))

/** The latest lines that say something went wrong across the logs, oldest first, each line's time leading so they sort. */
export const lastErrors = (logs: ReadonlyArray<LogTail>, turns: ReadonlyArray<TurnFacts>): ReadonlyArray<string> => {
  const lines = logs.flatMap((log) =>
    log.text
      .split('\n')
      .filter((line) => line !== '' && isError(log.name, line))
      .map((line) => `${line.slice(0, 24)} ${log.name}: ${line.slice(25)}`),
  )
  const ended = turns
    .filter((turn) => turn.errorClass !== null || turn.state === 'failed')
    .map(
      (turn) =>
        `${turn.endedAt ?? ''} turn: ${turn.id} on ${turn.threadId}${turn.taskId === null ? '' : ` (${turn.taskId})`} ${turn.agent} ${turn.state}${
          turn.errorClass === null ? '' : ` ${turn.errorClass}`
        }`,
    )
  return [...lines, ...ended]
    .toSorted()
    .slice(-ERRORS.count)
    .map((line) => (line.length > ERRORS.length ? `${line.slice(0, ERRORS.length - 1)}…` : line))
}

/**
 * The context, with the task and project the runtime found for its thread
 * where the window didn't say them, and what it is about masked: an update's
 * reason can name a path.
 */
export const contextOf = (gathered: Pick<Gathered, 'context' | 'runtime' | 'mask'>): ReportContext => {
  const thread = gathered.runtime?.thread ?? null
  return {
    ...gathered.context,
    taskId: gathered.context.taskId ?? thread?.taskId ?? null,
    projectId: gathered.context.projectId ?? thread?.projectId ?? null,
    about: gathered.context.about === null ? null : oneLine(gathered.mask(gathered.context.about), ABOUT),
  }
}

const masked = (gathered: Gathered) => gathered.logs.map((log) => ({ name: log.name, text: gathered.mask(log.text) }))

/** The logs as one file: each log's tail under its name. */
export const logsFile = (logs: ReadonlyArray<LogTail>): string =>
  logs
    .map((log) => `===== ${log.name}.log, the last ${log.text.length} characters =====\n${log.text}${log.text.endsWith('\n') ? '' : '\n'}`)
    .join('\n')

/** A migration as its file is named: 0018_questions. */
const migrationKey = (migration: { readonly id: number; readonly name: string }) =>
  `${String(migration.id).padStart(4, '0')}_${migration.name}`

const migrationsOf = (runtime: RuntimeFacts | null) => {
  if (runtime === null) return null
  const last = runtime.migrations.at(-1)
  return { count: runtime.migrations.length, last: last === undefined ? null : migrationKey(last) }
}

export const preview = (gathered: Gathered): ReportPreview => {
  const logs = masked(gathered)
  return {
    app: gathered.app,
    installId: gathered.installId,
    context: contextOf(gathered),
    agents: gathered.runtime?.agents ?? null,
    migrations: migrationsOf(gathered.runtime),
    screenshot: gathered.screenshot !== null,
    errors: lastErrors(logs, gathered.runtime?.turns ?? []).length,
    logs: logs.map((log) => ({ name: log.name, bytes: Buffer.byteLength(log.text) })),
  }
}

/** The report as it goes: the Worker's JSON, the logs file, and the screenshot, each only as the person chose. */
export const assemble = (gathered: Gathered, choices: ReportChoices) => {
  const logs = masked(gathered)
  const migrations = migrationsOf(gathered.runtime)
  const json: ReportJson = {
    version: 1,
    installId: gathered.installId,
    text: choices.text,
    email: choices.email,
    app: gathered.app,
    context: contextOf(gathered),
    agents: reportedAgents(gathered.runtime?.agents ?? []),
    migrations: migrations ?? { count: 0, last: null },
    errors: choices.logs ? lastErrors(logs, gathered.runtime?.turns ?? []) : [],
  }
  return {
    json,
    logs: choices.logs && logs.length > 0 ? logsFile(logs) : null,
    screenshot: choices.screenshot ? gathered.screenshot : null,
  }
}

export type Assembled = ReturnType<typeof assemble>

/** The report as a person reads it, for the file saved to send by mail. */
/** Whether an agent is signed in, as the file saved for mail says it. */
const SIGN_IN_WORDS: Readonly<Record<AgentFacts['signIn'], string>> = {
  signed_in: 'signed in',
  signed_out: 'signed out',
  unknown: 'sign-in not known',
  not_installed: 'not installed',
}

export const readable = (report: Assembled): string => {
  const { json } = report
  const lines = [
    'What happened',
    '',
    json.text,
    '',
    ...(json.email === null ? [] : [`Reply to: ${json.email}`, '']),
    `Althar ${json.app.version}, Electron ${json.app.electron}, ${json.app.os} (${json.app.arch})`,
    `Screen: ${[json.context.screen, json.context.about, json.context.projectId, json.context.taskId, json.context.threadId].filter((part) => part !== null).join(', ')}`,
    `Install: ${json.installId}`,
    ...json.agents.map(
      (agent) =>
        `${agent.name}: ${agent.version ?? 'version unknown'}${agent.adapter === null ? '' : `, adapter ${agent.adapter}`}, ${SIGN_IN_WORDS[agent.signIn]}`,
    ),
    `Migrations: ${json.migrations.count}${json.migrations.last === null ? '' : `, the last ${json.migrations.last}`}`,
    ...(json.errors.length === 0 ? [] : ['', 'Last errors', '', ...json.errors]),
  ]
  return `${lines.join('\n')}\n`
}
