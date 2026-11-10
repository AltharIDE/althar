import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  CANVAS_LIMITS,
  CANVASES_FOLDER,
  type CanvasAnchor,
  type CanvasCommentFacts,
  type CanvasDetail,
  type CanvasKind,
  canvasKindOf,
  CanvasManifest,
  type CanvasSummary,
  type CanvasText,
  type CanvasVersionFacts,
  isCanvasName,
  manifestBytes,
  type SentCanvasComment,
} from '@althar/contracts'
import { type ActorId, Ids, newId, type ProjectId } from '@althar/domain'
import { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Effect, Layer, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { Artifacts } from './Artifacts'
import { asideFor, canvasesIn, type CopyFile, holdsOnly, isCopyPath, manifestOf, readCopy, writeCopy } from './canvasFiles'
import { RuntimeConfig } from './Config'
import { NotFound } from './errors'
import { Instance } from './Instance'
import { timestamp } from './records'
import { agentFolderOf } from './sentFiles'
import { addItem } from './threads'
import { POOL, type Tool, type ToolAccess, ToolRefused, type ToolRole, ToolServer } from './ToolServer'

/*
 * A project's canvases (ADR-104): what its agents draw for the person to
 * look at and iterate on. A canvas is the project's, not the task's: the
 * coordinator and every lead in the project list, get, publish, read,
 * resolve and archive any of them, and reviewers read them. An agent writes
 * a canvas's files with its own tools in `.althar/canvases/<name>/` in its own
 * folder, then publishes them: each file goes into the artifact store by its
 * digest, with a manifest that lists them, and the version's row names the
 * manifest. A version never changes. A publish names the version it was
 * made on, from the copy's record, and one made on a version that is no
 * longer the latest is refused, with the latest set aside to bring the
 * change onto. Getting a canvas never overwrites a copy with edits in it.
 * The person's comments are kept with the message that sends them, in its
 * command (`keepComments`), never before.
 */

/** What a lead's and the coordinator's brief says of canvases: when to draw one, and to look before saying it's done. */
export const CANVAS_BRIEF =
  "The project keeps canvases: what you draw for the person to look at again, iterate on, compare or pass on, such as a mockup, a set of directions to choose between, a chart of results, a diagram to come back to or a page that explains a flow. Write its files in .althar/canvases/<name>/ in your folder with your own tools and publish them with canvas_publish; it opens beside the conversation as a new version every lead and the coordinator can get. What the person reads once belongs in your reply, and a diagram that only explains it in a mermaid block there. Before you change a canvas, canvas_list, then canvas_get it and canvas_read its comments; resolve those your version answers. An HTML canvas is a page of its own: link its files relatively, and look at what you drew before you say it's done."

type Input = Readonly<Record<string, unknown>>

const recordOf = (input: unknown): Input => (typeof input === 'object' && input !== null ? (input as Input) : {})

/** Why an input asks nothing, thrown while it is read and said whole to the agent. */
class Unclear {
  constructor(readonly message: string) {}
}

const textIn = (input: Input, key: string, longest: number): string | null => {
  const value = input[key]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Unclear(`${key} should be text.`)
  const trimmed = value.trim()
  if (trimmed.length > longest) throw new Unclear(`${key} is ${trimmed.length} characters long; it can be at most ${longest}.`)
  if (trimmed.includes('\u0000')) throw new Unclear(`${key} can’t hold a null character.`)
  return trimmed === '' ? null : trimmed
}

const wholeIn = (input: Input, key: string): number | null => {
  const value = input[key]
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
    throw new Unclear(`${key} should be a version’s number, such as 3.`)
  return value
}

const flagIn = (input: Input, key: string, otherwise: boolean): boolean => {
  const value = input[key]
  if (value === undefined || value === null) return otherwise
  if (typeof value !== 'boolean') throw new Unclear(`${key} should be true or false.`)
  return value
}

const nameIn = (input: Input, key = 'name'): string => {
  const name = textIn(input, key, 200)
  if (name === null) throw new Unclear(`Give the canvas’s ${key}, in lowercase words and hyphens, such as login-flow.`)
  if (!isCanvasName(name))
    throw new Unclear(
      `${name} isn’t a canvas’s name: lowercase letters, digits and single hyphens, at most ${CANVAS_LIMITS.name} characters, such as login-flow.`,
    )
  return name
}

/** A canvas's title from its name, where the agent gave none: `login-flow` is Login flow. */
export const titleFromName = (name: string) => {
  const words = name.replaceAll('-', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The entry a copy is drawn from where the agent names none: the latest version's, the one file, or an index or README. */
export const entryAmong = (files: ReadonlyArray<CopyFile>, latest: string | null): string | null => {
  const paths = files.map((file) => file.path)
  if (latest !== null && paths.includes(latest)) return latest
  if (paths.length === 1) return paths[0] ?? null
  for (const usual of ['index.html', 'index.htm', 'index.md', 'README.md', 'index.mmd', 'index.svg'])
    if (paths.includes(usual)) return usual
  return null
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

interface CanvasRow {
  readonly id: string
  readonly projectId: ProjectId
  readonly name: string
  readonly title: string
  readonly kind: CanvasKind
  readonly groupName: string | null
  readonly archivedAt: string | null
}

interface VersionRow {
  readonly canvasId: string
  readonly number: number
  readonly base: number | null
  readonly manifest: string
  readonly entry: string
  readonly kind: CanvasKind
  readonly title: string
  readonly note: string | null
  readonly files: number
  readonly bytes: number
  readonly taskId: string | null
  readonly taskTitle: string | null
  readonly createdAt: string
}

const factsOf = (row: VersionRow): CanvasVersionFacts => ({
  number: row.number,
  base: row.base,
  title: row.title,
  kind: row.kind,
  entry: row.entry,
  manifest: row.manifest,
  note: row.note,
  files: row.files,
  bytes: row.bytes,
  by:
    row.taskId === null
      ? { role: 'coordinator', taskId: null, taskTitle: null }
      : { role: 'lead', taskId: row.taskId, taskTitle: row.taskTitle },
  at: row.createdAt,
})

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(CanvasManifest))
const decodeAnchor = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))

/** The canvases of a project's tools: reading ones go to reviewers too. */
const READING: ReadonlyArray<string> = ['canvas_list', 'canvas_get', 'canvas_read']

export const CANVAS_TOOLS = [
  'canvas_list',
  'canvas_get',
  'canvas_publish',
  'canvas_read',
  'canvas_open',
  'canvas_resolve',
  'canvas_archive',
] as const

/** Selects a project's canvases with their latest versions. */
const VERSION_COLUMNS = `v.canvas_id, v.number, v.base, v.manifest, v.entry, v.kind, v.title, v.note, v.files, v.bytes, v.task_id, t.title AS task_title, v.created_at`

export class Canvases extends Context.Service<
  Canvases,
  {
    /** A project's canvases, newest first; archived ones only where asked. */
    list(projectId: string, archived: boolean): Effect.Effect<ReadonlyArray<CanvasSummary>, SqlError.SqlError | Schema.SchemaError>
    /** One canvas whole: its versions, oldest first, and the comments sent on it. */
    get(canvasId: string): Effect.Effect<CanvasDetail, NotFound | SqlError.SqlError | Schema.SchemaError>
    /** A version's entry, as the window draws a document, a diagram or an SVG. */
    text(canvasId: string, version: number): Effect.Effect<CanvasText, NotFound | SqlError.SqlError | Schema.SchemaError>
  }
>()('@althar/runtime/Canvases') {
  static readonly layer: Layer.Layer<
    Canvases,
    never,
    SqlClient.SqlClient | Ledger | Artifacts | RuntimeConfig | Instance | ToolServer | Crypto.Crypto
  > = Layer.effect(
    Canvases,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const ledger = yield* Ledger
      const artifacts = yield* Artifacts
      const instance = yield* Instance
      const toolServer = yield* ToolServer
      const context = yield* Effect.context<SqlClient.SqlClient | Ledger | RuntimeConfig | Instance | Crypto.Crypto>()

      const refuse = (message: string) => Effect.fail(new ToolRefused({ message }))
      const actorOf = (access: ToolAccess): ActorId => (access.role === 'coordinator' ? instance.coordinatorId : instance.systemId)

      const canvasNamed = (projectId: string, name: string) =>
        Effect.map(
          sql<CanvasRow>`SELECT id, project_id, name, title, kind, group_name, archived_at FROM canvases WHERE project_id = ${projectId} AND name = ${name}`,
          (rows) => rows[0] ?? null,
        )

      const versionsOf = (canvasId: string) =>
        sql<VersionRow>`SELECT ${sql.unsafe(VERSION_COLUMNS)} FROM canvas_versions v LEFT JOIN tasks t ON t.id = v.task_id
            WHERE v.canvas_id = ${canvasId} ORDER BY v.number`

      const latestOf = (canvasId: string) =>
        Effect.map(
          sql<VersionRow>`SELECT ${sql.unsafe(VERSION_COLUMNS)} FROM canvas_versions v LEFT JOIN tasks t ON t.id = v.task_id
              WHERE v.canvas_id = ${canvasId} ORDER BY v.number DESC LIMIT 1`,
          (rows) => rows[0] ?? null,
        )

      const versionOf = (canvasId: string, number: number) =>
        Effect.map(
          sql<VersionRow>`SELECT ${sql.unsafe(VERSION_COLUMNS)} FROM canvas_versions v LEFT JOIN tasks t ON t.id = v.task_id
              WHERE v.canvas_id = ${canvasId} AND v.number = ${number}`,
          (rows) => rows[0] ?? null,
        )

      /** A version's manifest and its files' bytes, from the artifact store. */
      const filesOf = (version: VersionRow) =>
        Effect.gen(function* () {
          const raw = yield* artifacts.read(version.manifest)
          if (raw === null) return null
          const manifest = yield* decodeManifest(new TextDecoder().decode(raw)).pipe(Effect.orElseSucceed(() => null))
          if (manifest === null) return null
          const files: Array<CopyFile> = []
          for (const file of manifest.files) {
            const bytes = yield* artifacts.read(file.sha256)
            if (bytes === null) return null
            files.push({ path: file.path, bytes })
          }
          return { manifest, files }
        })

      const copyOf = (folder: string, path: string) =>
        Effect.map(
          sql<{ canvasId: string; version: number; manifest: string }>`
              SELECT canvas_id, version, manifest FROM canvas_copies WHERE folder = ${folder} AND path = ${path}`,
          (rows) => rows[0] ?? null,
        )

      const manifestNamed = (digest: string) =>
        Effect.gen(function* () {
          const raw = yield* artifacts.read(digest)
          return raw === null ? null : yield* decodeManifest(new TextDecoder().decode(raw)).pipe(Effect.orElseSucceed(() => null))
        })

      const recordCopy = (input: { folder: string; path: string; canvasId: string; version: VersionRow; access: ToolAccess }) =>
        Effect.gen(function* () {
          const at = yield* timestamp
          yield* sql`INSERT INTO canvas_copies (folder, path, canvas_id, version, manifest, thread_id, task_id, updated_at)
              VALUES (${input.folder}, ${input.path}, ${input.canvasId}, ${input.version.number}, ${input.version.manifest}, ${input.access.threadId}, ${input.access.taskId}, ${at})
              ON CONFLICT (folder, path) DO UPDATE SET canvas_id = excluded.canvas_id, version = excluded.version, manifest = excluded.manifest,
                thread_id = excluded.thread_id, task_id = excluded.task_id, updated_at = excluded.updated_at`
        })

      /** Whether the copy at `path` is a version just as it was put there, by its record. */
      const untouched = (root: string, folder: string, path: string, canvasId: string, version?: number) =>
        Effect.gen(function* () {
          const record = yield* copyOf(folder, path)
          if (record === null || record.canvasId !== canvasId || (version !== undefined && record.version !== version)) return false
          const manifest = yield* manifestNamed(record.manifest)
          return manifest !== null && holdsOnly(join(root, path), manifest)
        })

      /** The folder the caller works in, where its copies are: refused where it isn't on this computer. */
      const folderFor = (access: ToolAccess) =>
        Effect.gen(function* () {
          const { folder } = yield* agentFolderOf(access.threadId).pipe(
            Effect.provideContext(context),
            Effect.orElseSucceed(() => ({ folder: null })),
          )
          if (folder === null)
            return yield* refuse('Your folder isn’t on this computer right now, so there is nowhere to put a canvas’s files.')
          return { folder, root: canvasesIn(folder) }
        })

      /**
       * Puts a version's files in the caller's folder, never over edits:
       * at `<name>/` where nothing is there or what is there is a version
       * untouched; else beside it, at `<name>@<n>/`. What it did, in words.
       */
      const place = (canvas: CanvasRow, version: VersionRow, access: ToolAccess) =>
        Effect.gen(function* () {
          const { folder, root } = yield* folderFor(access)
          const read = yield* filesOf(version)
          if (read === null) return yield* refuse(`v${version.number} of ${canvas.name}’s files aren’t in Althar’s store on this computer.`)
          const at = (path: string) => `${CANVASES_FOLDER}/${path}/`
          const main = join(root, canvas.name)
          const record = yield* copyOf(folder, canvas.name)
          const there = existsSync(main)
          const clean = there && (yield* untouched(root, folder, canvas.name, canvas.id))
          if (!there || clean) {
            if (clean && record?.version === version.number)
              return { path: canvas.name, said: `${at(canvas.name)} already holds v${version.number}, as it was put there.` }
            yield* writeCopy(main, read.files)
            yield* recordCopy({ folder, path: canvas.name, canvasId: canvas.id, version, access })
            return {
              path: canvas.name,
              said: clean
                ? `Put v${version.number} in ${at(canvas.name)}, in place of v${record?.version ?? '?'}, which had no edits.`
                : `Put v${version.number} in ${at(canvas.name)}.`,
            }
          }
          // Edits, or a folder Althar didn't put there: left alone, and the version goes beside it.
          const checks = new Map<string, boolean>()
          for (let n = 1; n < 1000; n += 1) {
            const path = n === 1 ? `${canvas.name}@${version.number}` : `${canvas.name}@${version.number}-${n}`
            if (!existsSync(join(root, path))) break
            checks.set(path, yield* untouched(root, folder, path, canvas.id, version.number))
          }
          const aside = asideFor(root, canvas.name, version.number, (path) => checks.get(path) === true)
          if (!aside.reuse) {
            yield* writeCopy(join(root, aside.path), read.files)
            yield* recordCopy({ folder, path: aside.path, canvasId: canvas.id, version, access })
          }
          const base =
            record === null || record.canvasId !== canvas.id ? 'with no record of which version it came from' : `made on v${record.version}`
          return {
            path: aside.path,
            said: `${at(canvas.name)} has edits (${base}), so it was left as it is, and v${version.number} is ${aside.reuse ? 'already' : 'now'} beside it in ${at(aside.path)}.`,
          }
        })

      const summaryOf = (canvas: CanvasRow) =>
        Effect.gen(function* () {
          const latest = yield* latestOf(canvas.id)
          const [counts] = yield* sql<{ versions: number; open: number }>`
              SELECT (SELECT count(*) FROM canvas_versions WHERE canvas_id = ${canvas.id}) AS versions,
                (SELECT count(*) FROM canvas_comments c WHERE c.canvas_id = ${canvas.id}
                  AND coalesce((SELECT r.resolved FROM canvas_resolutions r WHERE r.comment_id = c.id ORDER BY r.sequence DESC LIMIT 1), 0) = 0) AS open`
          const summary: CanvasSummary | null =
            latest === null
              ? null
              : {
                  id: canvas.id,
                  projectId: canvas.projectId,
                  name: canvas.name,
                  group: canvas.groupName,
                  latest: factsOf(latest),
                  versions: counts?.versions ?? 0,
                  openComments: counts?.open ?? 0,
                  archived: canvas.archivedAt !== null,
                }
          return summary
        })

      const list = (projectId: string, archived: boolean) =>
        Effect.gen(function* () {
          const rows = yield* sql<CanvasRow>`
              SELECT c.id, c.project_id, c.name, c.title, c.kind, c.group_name, c.archived_at FROM canvases c
              WHERE c.project_id = ${projectId} AND (c.archived_at IS NULL OR ${archived ? 1 : 0} = 1)
              ORDER BY (SELECT max(v.created_at) FROM canvas_versions v WHERE v.canvas_id = c.id) DESC, c.name`
          const all = yield* Effect.forEach(rows, summaryOf)
          return all.filter((one) => one !== null)
        })

      const commentsOf = (canvasId: string) =>
        Effect.gen(function* () {
          const rows = yield* sql<{ id: string; version: number; anchor: string; body: string; createdAt: string }>`
              SELECT id, version, anchor, body, created_at FROM canvas_comments WHERE canvas_id = ${canvasId} ORDER BY created_at, position`
          return yield* Effect.forEach(rows, (row) =>
            Effect.gen(function* () {
              const [last] = yield* sql<{ resolved: number; byVersion: number | null; note: string | null; createdAt: string }>`
                  SELECT resolved, by_version, note, created_at FROM canvas_resolutions WHERE comment_id = ${row.id} ORDER BY sequence DESC LIMIT 1`
              const anchor = (yield* decodeAnchor(row.anchor)) as CanvasAnchor
              return {
                id: row.id,
                version: row.version,
                anchor,
                body: row.body,
                at: row.createdAt,
                resolved:
                  last === undefined || last.resolved === 0 ? null : { byVersion: last.byVersion, note: last.note, at: last.createdAt },
              } satisfies CanvasCommentFacts
            }),
          )
        })

      const canvasById = (canvasId: string) =>
        Effect.gen(function* () {
          const [row] =
            yield* sql<CanvasRow>`SELECT id, project_id, name, title, kind, group_name, archived_at FROM canvases WHERE id = ${canvasId}`
          if (row === undefined) return yield* new NotFound({ kind: 'canvas', id: canvasId })
          return row
        })

      const get = (canvasId: string) =>
        Effect.gen(function* () {
          const canvas = yield* canvasById(canvasId)
          const summary = yield* summaryOf(canvas)
          if (summary === null) return yield* new NotFound({ kind: 'canvas', id: canvasId })
          return {
            summary,
            versions: (yield* versionsOf(canvasId)).map(factsOf),
            comments: yield* commentsOf(canvasId),
          } satisfies CanvasDetail
        })

      const text = (canvasId: string, number: number) =>
        Effect.gen(function* () {
          yield* canvasById(canvasId)
          const version = yield* versionOf(canvasId, number)
          if (version === null) return yield* new NotFound({ kind: 'canvas_version', id: `${canvasId}:${number}` })
          const manifest = yield* manifestNamed(version.manifest)
          const entry = manifest?.files.find((file) => file.path === version.entry)
          if (entry === undefined || entry.size > CANVAS_LIMITS.text)
            return yield* new NotFound({ kind: 'canvas_text', id: `${canvasId}:${number}` })
          const bytes = yield* artifacts.read(entry.sha256)
          if (bytes === null) return yield* new NotFound({ kind: 'canvas_text', id: `${canvasId}:${number}` })
          return { path: entry.path, text: new TextDecoder().decode(bytes), bytes: entry.size } satisfies CanvasText
        })

      const notify = (projectId: string, canvasId: string) =>
        ledger.notify({ projectId: projectId as ProjectId, aggregateType: 'canvas', aggregateId: canvasId, aggregateRevision: 1 })

      const postItem = (access: ToolAccess, canvas: CanvasRow, version: VersionRow, action: 'published' | 'opened', open: boolean) =>
        addItem({ projectId: access.projectId as ProjectId, threadId: access.threadId }, 'canvas', {
          canvasId: canvas.id,
          name: canvas.name,
          title: version.title,
          canvasKind: version.kind,
          version: version.number,
          note: version.note,
          action,
          open,
        })

      const byWords = (version: VersionRow) =>
        version.taskId === null ? 'the coordinator' : `the lead of ${version.taskTitle ?? 'a task'}`

      // canvas_list
      const listTool = (input: Input, access: ToolAccess) =>
        Effect.gen(function* () {
          const all = yield* list(access.projectId, flagIn(input, 'archived', false))
          if (all.length === 0)
            return 'This project has no canvases yet. Draw one: write its files in .althar/canvases/<name>/ in your folder, then canvas_publish.'
          const copies = yield* sql<{
            canvasId: string
            folder: string
            path: string
            version: number
            taskTitle: string | null
            threadKind: string
          }>`
              SELECT k.canvas_id, k.folder, k.path, k.version, t.title AS task_title, h.kind AS thread_kind
              FROM canvas_copies k JOIN threads h ON h.id = k.thread_id LEFT JOIN tasks t ON t.id = k.task_id
              JOIN canvases c ON c.id = k.canvas_id WHERE c.project_id = ${access.projectId}`
          const lines = all.map((one) => {
            const held = copies
              .filter((copy) => copy.canvasId === one.id && !copy.path.includes('@'))
              .filter((copy) => existsSync(join(copy.folder, ...CANVASES_FOLDER.split('/'), copy.path)))
              .map(
                (copy) =>
                  `${copy.threadKind === 'coordinator' ? 'the coordinator' : `the lead of ${copy.taskTitle ?? 'a task'}`} has a copy of v${copy.version}`,
              )
            const by = one.latest.by.role === 'coordinator' ? 'the coordinator' : `the lead of ${one.latest.by.taskTitle ?? 'a task'}`
            return [
              `- ${one.name}: ${one.latest.title} (${one.latest.kind}), v${one.latest.number} by ${by}, ${one.latest.at}`,
              one.group === null ? null : `  in the group ${one.group}`,
              one.openComments === 0 ? null : `  ${plural(one.openComments, 'open comment', 'open comments')}: canvas_read shows them`,
              held.length === 0 ? null : `  ${held.join('; ')}`,
              one.archived ? '  archived' : null,
            ]
              .filter((line) => line !== null)
              .join('\n')
          })
          return [`The project’s canvases, newest first:`, ...lines].join('\n')
        })

      const known = (access: ToolAccess, name: string) =>
        Effect.gen(function* () {
          const canvas = yield* canvasNamed(access.projectId, name)
          if (canvas === null) return yield* refuse(`No canvas is called ${name} in this project. canvas_list lists them.`)
          return canvas
        })

      const versionFor = (canvas: CanvasRow, number: number | null) =>
        Effect.gen(function* () {
          const version = number === null ? yield* latestOf(canvas.id) : yield* versionOf(canvas.id, number)
          if (version === null) {
            const latest = yield* latestOf(canvas.id)
            return yield* refuse(`${canvas.name} has no v${number ?? '?'}: its latest is v${latest?.number ?? 0}.`)
          }
          return version
        })

      // canvas_get
      const getTool = (input: Input, access: ToolAccess) =>
        Effect.gen(function* () {
          const canvas = yield* known(access, nameIn(input))
          const version = yield* versionFor(canvas, wholeIn(input, 'version'))
          const placed = yield* place(canvas, version, access)
          const comments = (yield* commentsOf(canvas.id)).filter((one) => one.resolved === null)
          return [
            `${placed.said} Its entry is ${version.entry} (${version.kind}).`,
            `Edit the files there with your own tools, then canvas_publish with name ${canvas.name}${placed.path === canvas.name ? '' : ` and from ${placed.path}`}; it is published on v${version.number}.`,
            comments.length === 0
              ? 'It has no open comments.'
              : `It has ${plural(comments.length, 'open comment', 'open comments')}; canvas_read shows them.`,
          ].join('\n')
        })

      // canvas_publish
      const publishTool = (input: Input, access: ToolAccess) =>
        Effect.gen(function* () {
          const name = nameIn(input)
          const from = textIn(input, 'from', 200) ?? name
          if (!isCopyPath(from) || !(from === name || from.startsWith(`${name}@`)))
            throw new Unclear(`from names a copy of ${name}: ${name} itself, or one set aside beside it, such as ${name}@4.`)
          const given = textIn(input, 'entry', 500)
          const title = textIn(input, 'title', CANVAS_LIMITS.title)
          const note = textIn(input, 'note', CANVAS_LIMITS.note)
          const groupName = textIn(input, 'group', 200)
          if (groupName !== null && !isCanvasName(groupName))
            throw new Unclear(`${groupName} isn’t a group’s name: lowercase words and hyphens, such as login-directions.`)
          const open = flagIn(input, 'open', true)
          const { folder, root } = yield* folderFor(access)
          const read = readCopy(join(root, from))
          if (!read.ok) return yield* refuse(`${CANVASES_FOLDER}/${from}/ can’t be published: ${read.why}`)
          const canvas = yield* canvasNamed(access.projectId, name)
          const latest = canvas === null ? null : yield* latestOf(canvas.id)
          const entry = given ?? entryAmong(read.files, latest?.entry ?? null)
          if (entry === null) return yield* refuse('Say which file is drawn first, with entry, such as index.html or README.md.')
          if (!read.files.some((file) => file.path === entry)) return yield* refuse(`${entry} isn’t in ${CANVASES_FOLDER}/${from}/.`)
          const kind = canvasKindOf(entry)
          if (kind === null)
            return yield* refuse(`${entry} can’t be drawn: a canvas starts from a .md, .mmd, .svg, .png, .jpg, .gif, .webp or .html file.`)
          // The version it was made on: the agent's word, else the copy's record.
          const record = yield* copyOf(folder, from)
          const base = wholeIn(input, 'base') ?? (canvas !== null && record?.canvasId === canvas.id ? record.version : null)
          if (canvas !== null && latest !== null) {
            if (base === null)
              return yield* refuse(
                `${name} is a canvas already, at v${latest.number}. canvas_get it first, change its files, and publish again; nothing was published.`,
              )
            if (base !== latest.number) {
              const placed = yield* place(canvas, latest, access)
              return yield* refuse(
                [
                  `Not published: your copy was made on v${base}, and ${byWords(latest)} has published v${latest.number} since${latest.note === null ? '' : ` (“${latest.note}”)`}.`,
                  `${placed.said}`,
                  `Bring your change onto it there, then publish again with from ${placed.path}.`,
                ].join(' '),
              )
            }
          }
          const manifest = manifestOf(entry, read.files)
          const manifestRaw = manifestBytes(manifest)
          if (latest !== null) {
            const before = yield* artifacts.read(latest.manifest)
            if (
              before !== null &&
              new TextDecoder().decode(before) === new TextDecoder().decode(manifestRaw) &&
              (title === null || title === latest.title) &&
              groupName === null
            )
              return `Nothing changed since v${latest.number}, so nothing was published.`
          }
          // The bytes go into the store before the transaction: no I/O inside it.
          for (const file of read.files)
            if ((yield* artifacts.put(file.bytes)) === null)
              return yield* refuse('Althar couldn’t keep the canvas’s files on this computer.')
          const putManifest = yield* artifacts.put(manifestRaw)
          if (putManifest === null) return yield* refuse('Althar couldn’t keep the canvas’s files on this computer.')
          const actorId = actorOf(access)
          const at = yield* timestamp
          const done = yield* sql.withTransaction(
            Effect.gen(function* () {
              let row = yield* canvasNamed(access.projectId, name)
              if (row === null) {
                const id = yield* newId(Ids.canvas)
                yield* sql`INSERT INTO canvases (id, project_id, name, title, kind, group_name, created_by_actor_id, created_at)
                    VALUES (${id}, ${access.projectId}, ${name}, ${title ?? titleFromName(name)}, ${kind}, ${groupName}, ${actorId}, ${at})`
                row = yield* canvasNamed(access.projectId, name)
              } else {
                const current = yield* latestOf(row.id)
                // Another publish came first, inside the moment between the check and this.
                if (current !== null && current.number !== base) return null
                yield* sql`UPDATE canvases SET title = ${title ?? current?.title ?? row.title}, kind = ${kind},
                    group_name = ${groupName ?? row.groupName}, archived_at = NULL, archived_by_actor_id = NULL WHERE id = ${row.id}`
              }
              if (row === null) return null
              const number = ((yield* latestOf(row.id))?.number ?? 0) + 1
              yield* sql`INSERT INTO canvas_versions (canvas_id, number, base, manifest, entry, kind, title, note, files, bytes, actor_id, thread_id, task_id, session_id, created_at)
                  VALUES (${row.id}, ${number}, ${base}, ${putManifest.sha256}, ${entry}, ${kind}, ${title ?? latest?.title ?? row.title}, ${note},
                    ${read.files.length}, ${read.files.reduce((sum, file) => sum + file.bytes.length, 0)}, ${actorId}, ${access.threadId}, ${access.taskId}, ${access.sessionId}, ${at})`
              const subject = { type: 'canvas_version' as const, id: `${row.id}:${number}`, role: 'file' as const }
              const kept = {
                projectId: access.projectId as ProjectId,
                kind: 'canvas' as const,
                sensitivity: 'may_contain_secrets' as const,
              }
              for (const file of manifest.files)
                yield* artifacts.record({ ...kept, sha256: file.sha256, size: file.size, mediaType: file.type, subject })
              yield* artifacts.record({
                ...kept,
                sha256: putManifest.sha256,
                size: putManifest.size,
                mediaType: 'application/json',
                subject: { ...subject, role: 'manifest' as const },
              })
              const version = yield* versionOf(row.id, number)
              if (version === null) return null
              yield* recordCopy({ folder, path: from, canvasId: row.id, version, access })
              yield* notify(access.projectId, row.id)
              return { canvas: row, version }
            }),
          )
          if (done === null)
            return yield* refuse(
              `Not published: another agent published ${name} at the same moment. canvas_get it again and bring your change onto it.`,
            )
          yield* postItem(access, done.canvas, done.version, 'published', open)
          return [
            `Published ${name} v${done.version.number}${done.version.number === 1 ? ', a new canvas of the project’s' : ` on v${base}`}: ${done.version.title}, ${plural(read.files.length, 'file', 'files')}, drawn from ${entry} (${kind}).`,
            open
              ? 'It opens beside your conversation; every lead and the coordinator can get it.'
              : 'Every lead and the coordinator can get it.',
            `Your copy in ${CANVASES_FOLDER}/${from}/ is now v${done.version.number}: change it and publish again to make v${done.version.number + 1}.`,
          ].join(' ')
        })

      // canvas_read
      const readTool = (input: Input, access: ToolAccess) =>
        Effect.gen(function* () {
          const canvas = yield* known(access, nameIn(input))
          const versions = yield* versionsOf(canvas.id)
          const comments = yield* commentsOf(canvas.id)
          const anchorWords = (anchor: CanvasAnchor) => {
            switch (anchor.kind) {
              case 'whole':
                return 'on the whole canvas'
              case 'passage':
                return `on “${anchor.text}”${anchor.heading === null ? '' : ` under ${anchor.heading}`}`
              case 'area':
                return `on an area ${Math.round(anchor.x * 100)}% across and ${Math.round(anchor.y * 100)}% down, ${Math.round(anchor.width * 100)}% by ${Math.round(anchor.height * 100)}% of it`
              case 'element':
                return `on ${anchor.label} (${anchor.selector})${anchor.text === '' ? '' : `: “${anchor.text}”`}`
            }
          }
          const open = comments.filter((one) => one.resolved === null)
          const done = comments.filter((one) => one.resolved !== null)
          const commentLine = (one: CanvasCommentFacts) =>
            [
              `- [${one.id}] on v${one.version}, ${anchorWords(one.anchor)}: ${one.body.replace(/\n/g, ' ')}`,
              one.resolved === null
                ? null
                : `  answered${one.resolved.byVersion === null ? '' : ` by v${one.resolved.byVersion}`}${one.resolved.note === null ? '' : `: ${one.resolved.note}`}`,
            ]
              .filter((line) => line !== null)
              .join('\n')
          return [
            `${canvas.name}: ${canvas.title}${canvas.archivedAt === null ? '' : ' (archived)'}${canvas.groupName === null ? '' : `, in the group ${canvas.groupName}`}.`,
            'Versions:',
            ...versions.map(
              (one) =>
                `- v${one.number}${one.base === null ? '' : ` on v${one.base}`} by ${byWords(one)}, ${one.createdAt}: ${one.entry} (${one.kind}), ${plural(one.files, 'file', 'files')}${one.note === null ? '' : ` — ${one.note}`}`,
            ),
            open.length === 0
              ? 'No open comments.'
              : `Open comments, which the person sent (canvas_resolve them once a version answers them):`,
            ...open.map(commentLine),
            ...(done.length === 0 ? [] : ['Answered:', ...done.map(commentLine)]),
          ].join('\n')
        })

      // canvas_open
      const openTool = (input: Input, access: ToolAccess) =>
        Effect.gen(function* () {
          const canvas = yield* known(access, nameIn(input))
          const version = yield* versionFor(canvas, wholeIn(input, 'version'))
          yield* postItem(access, canvas, version, 'opened', true)
          return `${canvas.name} v${version.number} opens beside your conversation, in each window that shows it.`
        })

      // canvas_resolve
      const resolveTool = (input: Input, access: ToolAccess) =>
        Effect.gen(function* () {
          const canvas = yield* known(access, nameIn(input))
          const given = recordOf(input).comments
          if (!Array.isArray(given) || given.length === 0 || given.length > 100)
            throw new Unclear('Give comments: the ids canvas_read shows, such as ccm_…, at most 100.')
          const ids = given.map((one: unknown) => {
            if (typeof one !== 'string' || !/^ccm_[0-9a-f]{32}$/.test(one.trim()))
              throw new Unclear('Each of comments is an id canvas_read shows, such as ccm_….')
            return one.trim()
          })
          const byVersion = wholeIn(input, 'version') ?? (yield* latestOf(canvas.id))?.number ?? null
          if (byVersion !== null && (yield* versionOf(canvas.id, byVersion)) === null)
            return yield* refuse(`${canvas.name} has no v${byVersion}.`)
          const note = textIn(input, 'note', CANVAS_LIMITS.note)
          const actorId = actorOf(access)
          const at = yield* timestamp
          const resolved = yield* sql.withTransaction(
            Effect.gen(function* () {
              let n = 0
              for (const id of ids) {
                const [comment] = yield* sql<{ id: string }>`SELECT id FROM canvas_comments WHERE id = ${id} AND canvas_id = ${canvas.id}`
                if (comment === undefined) return { missing: id }
                yield* sql`INSERT INTO canvas_resolutions (comment_id, sequence, resolved, by_version, note, actor_id, session_id, created_at)
                    VALUES (${id}, (SELECT coalesce(max(sequence), 0) + 1 FROM canvas_resolutions WHERE comment_id = ${id}), 1, ${byVersion}, ${note}, ${actorId}, ${access.sessionId}, ${at})`
                n += 1
              }
              yield* notify(access.projectId, canvas.id)
              return { count: n }
            }),
          )
          if ('missing' in resolved) return yield* refuse(`${resolved.missing} isn’t a comment on ${canvas.name}; nothing was marked.`)
          return `Marked ${plural(resolved.count, 'comment', 'comments')} on ${canvas.name} as answered${byVersion === null ? '' : ` by v${byVersion}`}.`
        })

      // canvas_archive
      const archiveTool = (input: Input, access: ToolAccess) =>
        Effect.gen(function* () {
          const canvas = yield* known(access, nameIn(input))
          if (canvas.archivedAt !== null) return `${canvas.name} is archived already.`
          const at = yield* timestamp
          yield* sql`UPDATE canvases SET archived_at = ${at}, archived_by_actor_id = ${actorOf(access)} WHERE id = ${canvas.id}`
          yield* notify(access.projectId, canvas.id)
          return `Archived ${canvas.name}: it is out of the project’s list, and its versions are kept. Publishing it again brings it back.`
        })

      /** A tool's body, with what it asked of the input said whole to the agent, and anything else Althar's own failure. */
      const wrap =
        (
          body: (
            input: Input,
            access: ToolAccess,
          ) => Effect.Effect<string, unknown, SqlClient.SqlClient | Ledger | RuntimeConfig | Instance | Crypto.Crypto>,
        ) =>
        (input: unknown, access: ToolAccess): Effect.Effect<string, ToolRefused> =>
          Effect.suspend(() => body(recordOf(input), access)).pipe(
            Effect.provideContext(context),
            Effect.catchCause((cause) => {
              for (const reason of cause.reasons) {
                if (reason._tag === 'Fail' && reason.error instanceof ToolRefused) return Effect.fail(reason.error)
                if (reason._tag === 'Die' && reason.defect instanceof Unclear) return refuse(reason.defect.message)
              }
              return Effect.die(cause)
            }),
          )

      const NAME = {
        type: 'string',
        description: 'The canvas’s name in the project: lowercase words and hyphens, such as login-flow.',
      } as const
      const VERSION = { type: 'integer', minimum: 1, description: 'A version’s number; the latest where you give none.' } as const

      const tools: ReadonlyArray<Tool & { readonly name: (typeof CANVAS_TOOLS)[number] }> = [
        {
          name: 'canvas_list',
          description:
            'Lists the project’s canvases, newest first: what its agents drew for the person to look at and iterate on (pages, mockups, diagrams, charts, documents, pictures), each with its latest version, who published it, its open comments and who holds a copy. A canvas is the project’s, not a task’s: you can get, change and publish any of them. archived lists those taken out of the list too.',
          input: { type: 'object', properties: { archived: { type: 'boolean' } } },
          call: wrap(listTool),
        },
        {
          name: 'canvas_get',
          description: `Puts a version of a canvas (the latest where you give none) in your folder at ${CANVASES_FOLDER}/<name>/, to read its files or change them with your own tools before canvas_publish. It never overwrites edits: a copy with edits is left as it is, and the version goes beside it, at <name>@<n>/; the answer says which.`,
          input: { type: 'object', properties: { name: NAME, version: VERSION }, required: ['name'] },
          call: wrap(getTool),
        },
        {
          name: 'canvas_publish',
          description: `Publishes a canvas from its files in your folder, ${CANVASES_FOLDER}/<name>/ (or from, a copy set aside), as a new version every lead, the coordinator and the person can see. Draw a canvas for what the person will look at again, iterate on, compare or pass on: a mockup, directions to choose between (the same group), a chart, a diagram to come back to, a page that explains a flow. What they read once belongs in your reply, and a diagram that only explains it in a mermaid block there. entry is the file drawn first: .md (Markdown, with mermaid blocks drawn), .mmd (Mermaid), .svg, a picture, or .html (a page of its own, which may load from the web or run against localhost; link its files relatively, style.css, never /style.css). A canvas that is already one is published on the version your copy came from, which Althar knows: if someone published since, nothing is published and their version is set aside beside yours to bring your change onto. Look at what you drew before you say it’s done.`,
          input: {
            type: 'object',
            properties: {
              name: NAME,
              entry: {
                type: 'string',
                description:
                  'The file drawn first, by its path in the canvas, such as index.html; the last version’s, the one file, or an index or README where you give none.',
              },
              title: {
                type: 'string',
                description: 'What it is, in a few words, as the person reads it; from its name for a new canvas where you give none.',
              },
              note: { type: 'string', description: 'What this version changed, in a line: “Tighter spacing, as asked.”' },
              base: VERSION,
              from: { type: 'string', description: 'A copy set aside to publish from, such as login-flow@4.' },
              group: {
                type: 'string',
                description: 'A set of directions the person chooses between: the same group name on each, such as login-directions.',
              },
              open: { type: 'boolean', description: 'Opens it beside your conversation; true unless you say.' },
            },
            required: ['name'],
          },
          call: wrap(publishTool),
        },
        {
          name: 'canvas_read',
          description:
            'A canvas’s versions with their notes, and the comments the person sent on it: each with its id, the version it was made on and where it points, open or answered. Read it before you change a canvas someone else drew, and resolve what your version answers with canvas_resolve.',
          input: { type: 'object', properties: { name: NAME }, required: ['name'] },
          call: wrap(readTool),
        },
        {
          name: 'canvas_open',
          description:
            'Opens a version of a canvas (the latest where you give none) beside your conversation, for the person to look at with you.',
          input: { type: 'object', properties: { name: NAME, version: VERSION }, required: ['name'] },
          call: wrap(openTool),
        },
        {
          name: 'canvas_resolve',
          description:
            'Marks the person’s comments on a canvas as answered, by the version that answers them (the latest where you give none), with a line for the person.',
          input: {
            type: 'object',
            properties: { name: NAME, comments: { type: 'array', items: { type: 'string' } }, version: VERSION, note: { type: 'string' } },
            required: ['name', 'comments'],
          },
          call: wrap(resolveTool),
        },
        {
          name: 'canvas_archive',
          description:
            'Takes a canvas out of the project’s list, keeping all its versions; publishing it again brings it back. Only the person deletes a canvas.',
          input: { type: 'object', properties: { name: NAME }, required: ['name'] },
          call: wrap(archiveTool),
        },
      ]
      yield* toolServer.serve(POOL, tools)
      yield* toolServer.serve(
        'reviewer' satisfies ToolRole,
        tools.filter((tool) => READING.includes(tool.name)),
      )
      return Canvases.of({ list, get, text })
    }),
  )
}

/**
 * Keeps the person's comments on canvases with the message that sends them,
 * inside its command's transaction: each on a canvas of the message's own
 * project, at a version it has. One that isn't refuses the message whole.
 */
export const keepComments = (input: {
  readonly projectId: string
  readonly threadId: string
  readonly inputId: string
  readonly actorId: string
  readonly comments: ReadonlyArray<SentCanvasComment>
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const at = yield* timestamp
    const touched = new Set<string>()
    for (const [index, comment] of input.comments.entries()) {
      const [found] = yield* sql<{ one: number }>`
        SELECT 1 AS one FROM canvases c JOIN canvas_versions v ON v.canvas_id = c.id
        WHERE c.id = ${comment.canvasId} AND c.project_id = ${input.projectId} AND v.number = ${comment.version}`
      if (found === undefined) return yield* new NotFound({ kind: 'canvas_version', id: `${comment.canvasId}:${comment.version}` })
      const id = yield* newId(Ids.canvasComment)
      yield* sql`INSERT INTO canvas_comments (id, canvas_id, version, anchor, body, author_actor_id, user_input_id, thread_id, position, created_at)
        VALUES (${id}, ${comment.canvasId}, ${comment.version}, ${JSON.stringify(comment.anchor)}, ${comment.body.slice(0, CANVAS_LIMITS.note)},
          ${input.actorId}, ${input.inputId}, ${input.threadId}, ${index + 1}, ${at})`
      touched.add(comment.canvasId)
    }
    const ledger = yield* Ledger
    for (const canvasId of touched)
      yield* ledger.notify({
        projectId: input.projectId as ProjectId,
        aggregateType: 'canvas',
        aggregateId: canvasId,
        aggregateRevision: 1,
      })
  })
