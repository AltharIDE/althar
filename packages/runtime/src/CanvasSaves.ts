import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'

import { ChangeRequest } from '@althar/connectors'
import { type ArtifactsHome, type ArtifactsPlace, CanvasSaved, type RepositoryFolders } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { Database, Ledger } from '@althar/persistence-sqlite'
import { Cause, Context, type Crypto, Effect, Exit, Layer, Option, Schema, Scope } from 'effect'
import { SqlClient } from 'effect/sql'

import { Artifacts } from './Artifacts'
import { readVersionFiles } from './canvasFiles'
import { commitCanvas, folderPath, problemIn, refuse, remoteForSave, safePath, stageCanvas, withCanvasWorktree } from './canvasGit'
import { RuntimeConfig } from './Config'
import { Connections } from './Connections'
import { coAuthorOn, creditedMessage } from './credit'
import { NotFound } from './errors'
import { askedRemoteTip, commitOf, fetchedInto, gitExactly, gitOutcome, pushTo } from './git'
import { Instance } from './Instance'
import { makeKeyedLock } from './keyedLock'
import { outward } from './outward'
import { Foreground } from './spawner'

type Home = Omit<ArtifactsHome, 'repository'>
type Save = Omit<Home, 'folder'> & { readonly canvasId: string; readonly path: string; readonly makeHome?: boolean | undefined }
type RepoRow = { id: string; name: string; checkout: string | null; base: string | null }
type CanvasRow = { id: string; projectId: ProjectId; name: string; latest: number }
type Version = { title: string; manifest: string }
type SaveRow = Omit<CanvasSaved, 'version' | 'commit' | 'pullRequest' | 'follow'> & {
  follow: number
  tracking: string
  request: string
  nextVersion: number
  throughVersion: number
  published: string | null
}

const Published = Schema.Struct({
  repositoryId: CanvasSaved.fields.repositoryId,
  path: CanvasSaved.fields.path,
  how: CanvasSaved.fields.how,
  version: Schema.Number,
  commit: Schema.String,
  pullRequest: CanvasSaved.fields.pullRequest,
})
const decodePublished = Schema.decodeUnknownEffect(Schema.fromJsonString(Published))
const decodeChange = Schema.decodeUnknownOption(ChangeRequest)
const decodeAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(ChangeRequest))
const decodeAsked = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ mark: Schema.String })))
/**
 * The line a pull request Althar asks to open for a save carries in its description, hidden where the host draws it: a
 * fresh one each time it asks, kept in that asking's receipt, so the one that asking opened is told from any other.
 */
const markOf = (mark: string) => `<!-- althar:artifact-save ${mark} -->`
const suggestions = ['design/', 'designs/', 'docs/design/']
const FOLDER_LIMIT = 5000

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const { deviceId } = yield* Instance
  const ledger = yield* Ledger
  const artifacts = yield* Artifacts
  const connections = yield* Connections
  const { worktreeRoot } = yield* RuntimeConfig
  const context = yield* Effect.context<SqlClient.SqlClient | Instance | Ledger | Crypto.Crypto>()
  const scope = yield* Scope.Scope
  const canvases = makeKeyedLock()
  const checkouts = makeKeyedLock()
  const trees = new Map<string, { commit: string; folders: RepositoryFolders; preferred: string | undefined }>()

  const repos = (projectId: string, repositoryId: string | null) =>
    sql<RepoRow>`SELECT b.id, b.display_name AS name, b.default_base_ref AS base, l.path AS checkout
      FROM repository_bindings b
      LEFT JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${deviceId} AND l.state = 'ready'
      WHERE b.project_id = ${projectId} AND b.detached_at IS NULL AND (${repositoryId} IS NULL OR b.id = ${repositoryId})
      ORDER BY b.created_at, b.rowid`

  const repoOf = (projectId: string, repositoryId: string) =>
    Effect.gen(function* () {
      const [repo] = yield* repos(projectId, repositoryId)
      return repo ?? (yield* new NotFound({ kind: 'repository', id: repositoryId }))
    })

  const projectOf = (projectId: string) =>
    Effect.gen(function* () {
      const [row] = yield* sql<{
        id: ProjectId
        revision: number
      }>`SELECT id, revision FROM projects WHERE id = ${projectId} AND archived_at IS NULL`
      return row ?? (yield* new NotFound({ kind: 'project', id: projectId }))
    })

  const canvasOf = (canvasId: string) =>
    Effect.gen(function* () {
      const [canvas] = yield* sql<CanvasRow>`SELECT id, project_id, name,
        (SELECT max(number) FROM canvas_versions WHERE canvas_id = c.id) AS latest FROM canvases c WHERE id = ${canvasId}`
      return canvas ?? (yield* new NotFound({ kind: 'canvas', id: canvasId }))
    })

  const rowOf = (canvasId: string) =>
    Effect.map(
      sql<SaveRow>`SELECT s.*, b.display_name AS repository FROM canvas_saves s
        JOIN repository_bindings b ON b.id = s.repository_id WHERE s.canvas_id = ${canvasId}`,
      ([row]) => row,
    )

  const publishedOf = (row: SaveRow) => (row.published === null ? Effect.succeed(null) : decodePublished(row.published))

  const saved = (canvasId: string) =>
    Effect.gen(function* () {
      const row = yield* rowOf(canvasId)
      if (row === undefined) return null
      const last = yield* publishedOf(row)
      const facts: CanvasSaved = {
        repositoryId: row.repositoryId,
        repository: row.repository,
        path: row.path,
        how: row.how,
        follow: row.follow !== 0,
        version: last?.version ?? null,
        commit: last?.commit ?? null,
        pullRequest: last?.repositoryId === row.repositoryId && row.how === 'pr' ? last.pullRequest : null,
        state: row.state,
        problem: row.problem,
      }
      return facts
    })

  const canvasChanged = (canvas: CanvasRow) =>
    ledger.notify({ projectId: canvas.projectId, aggregateType: 'canvas', aggregateId: canvas.id, aggregateRevision: 1 })

  const treeOf = (repo: RepoRow) =>
    Effect.gen(function* () {
      const empty = { folders: { folders: [], truncated: false }, preferred: undefined }
      const path = repo.checkout
      if (path === null) return empty
      const head = yield* gitOutcome(path, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD')
      const ref = head.code === 0 ? head.stdout : repo.base === null ? null : `refs/remotes/origin/${repo.base}`
      if (ref === null) return empty
      const commit = yield* commitOf(path, ref).pipe(Effect.orElseSucceed(() => null))
      if (commit === null) return empty
      const cached = trees.get(repo.id)
      if (cached?.commit === commit) return cached
      const raw = yield* gitExactly(path, 'ls-tree', '-d', '-r', '-z', '--name-only', commit)
      // Git walks tree entries in path order, comparing directory names with their slash.
      const paths = raw.split('\0', FOLDER_LIMIT + 1).filter((part) => part !== '')
      const result = {
        commit,
        folders: { folders: paths.slice(0, FOLDER_LIMIT).map((part) => `${part}/`), truncated: paths.length > FOLDER_LIMIT },
        preferred: suggestions.find((folder) => {
          const entry = `${folderPath(folder)}\0`
          return raw.startsWith(entry) || raw.includes(`\0${entry}`)
        }),
      }
      trees.set(repo.id, result)
      return result
    })

  const folders = (projectId: string, repositoryId: string) =>
    Effect.gen(function* () {
      const repo = yield* repoOf(projectId, repositoryId)
      return (yield* treeOf(repo)).folders
    })

  /** The project's place for artifacts, where its setting names one in a repository it still has. */
  const home = (projectId: string) =>
    Effect.gen(function* () {
      const [row] = yield* sql<Omit<ArtifactsHome, 'follow'> & { follow: number }>`
        SELECT h.repository_id, b.display_name AS repository, h.folder, h.how, h.follow FROM artifacts_homes h
        JOIN repository_bindings b ON b.id = h.repository_id AND b.detached_at IS NULL WHERE h.project_id = ${projectId}`
      return row === undefined ? null : ({ ...row, follow: row.follow !== 0 } satisfies ArtifactsHome)
    })

  const place = (projectId: string) =>
    Effect.gen(function* () {
      yield* projectOf(projectId)
      const kept = yield* home(projectId)
      if (kept !== null) return { home: kept, guess: null } satisfies ArtifactsPlace
      const [repo] = yield* repos(projectId, null)
      if (repo === undefined) return { home: null, guess: null } satisfies ArtifactsPlace
      const existing = yield* treeOf(repo).pipe(
        Effect.map((tree) => tree.preferred),
        Effect.orElseSucceed(() => undefined),
      )
      const answer: ArtifactsPlace = {
        home: null,
        guess: {
          repositoryId: repo.id,
          repository: repo.name,
          folder: existing ?? 'design/',
          how: 'pr',
          follow: true,
          why: existing === undefined ? `A new design folder in ${repo.name}` : `Where ${repo.name} keeps its designs`,
        },
      }
      return answer
    })

  const putHome = (projectId: string, home: Home | null, replace: boolean) =>
    Effect.gen(function* () {
      const project = yield* projectOf(projectId)
      if (home === null) yield* sql`DELETE FROM artifacts_homes WHERE project_id = ${projectId}`
      else {
        const path = folderPath(home.folder)
        if (home.folder !== '' && !safePath(path)) return yield* refuse('Pick a folder inside the repository.')
        yield* repoOf(projectId, home.repositoryId)
        const changed = yield* sql`INSERT INTO artifacts_homes (project_id, repository_id, folder, how, follow)
          VALUES (${projectId}, ${home.repositoryId}, ${path === '' ? '' : `${path}/`}, ${home.how}, ${Number(home.follow)})
          ON CONFLICT (project_id) DO UPDATE SET repository_id = excluded.repository_id, folder = excluded.folder,
            how = excluded.how, follow = excluded.follow WHERE ${Number(replace)} OR NOT EXISTS (
              SELECT 1 FROM repository_bindings WHERE id = artifacts_homes.repository_id AND detached_at IS NULL
            )
          RETURNING project_id`
        if (changed.length === 0) return
      }
      yield* ledger.notify({
        projectId: project.id,
        aggregateType: 'project',
        aggregateId: project.id,
        aggregateRevision: project.revision,
      })
    })

  const setHome = (projectId: string, home: Home | null) => sql.withTransaction(putHome(projectId, home, true))

  const stillWanted = (canvas: CanvasRow, row: SaveRow) =>
    Effect.gen(function* () {
      const current = yield* rowOf(canvas.id)
      if (current?.request !== row.request) return yield* refuse('This save was replaced.')
    })

  const keepPushed = (canvas: CanvasRow, row: SaveRow, commit: string, pullRequest: CanvasSaved['pullRequest']) =>
    sql`UPDATE canvas_saves SET published = ${JSON.stringify({
      repositoryId: row.repositoryId,
      path: row.path,
      how: row.how,
      version: row.nextVersion,
      commit,
      pullRequest,
    })} WHERE canvas_id = ${canvas.id} AND tracking = ${row.tracking}`.pipe(Effect.asVoid)

  /** The key of asking the host to open the pull request for a save's commit: the same commit asks the same. */
  const openKey = (canvas: CanvasRow, row: SaveRow, commit: string) => `open_change:canvas:${canvas.id}:${row.repositoryId}:${commit}`

  /**
   * Whether an open pull request no save recorded is the one Althar's latest asking to open from `commit` opened: where the
   * host answered, the one it answered with; where its answer was lost (or the app stopped while asking), so the host may
   * have opened it, one carrying that asking's mark. Where the host said no, nothing was asked, or it is any other, even
   * by the same account with the same title, it isn't.
   */
  const openedFor = (canvas: CanvasRow, row: SaveRow, commit: string, open: ChangeRequest) =>
    Effect.gen(function* () {
      const [asked] = yield* sql<{ state: string; request: string; response: string | null }>`
        SELECT state, request, response FROM mutation_receipts
        WHERE project_id = ${canvas.projectId} AND idempotency_key = ${openKey(canvas, row, commit)}
        ORDER BY created_at DESC, rowid DESC LIMIT 1`
      if (asked === undefined || asked.state === 'failed') return false
      // The host's own answer, kept before the save could record it (the app stopping in between): only one it opened for
      // this asking is ever kept, checked by its mark as it came back.
      if (asked.state === 'confirmed')
        return asked.response !== null && Option.getOrUndefined(decodeAnswer(asked.response))?.number === open.number
      const mark = Option.getOrUndefined(decodeAsked(asked.request))?.mark
      return mark !== undefined && open.body.includes(markOf(mark))
    })

  const write = (canvas: CanvasRow, row: SaveRow, checkout: string, version: Version) =>
    Effect.gen(function* () {
      yield* stillWanted(canvas, row)
      const files = yield* readVersionFiles(artifacts, version.manifest)
      if (files === null)
        return yield* refuse(`Althar couldn’t find the files for v${row.nextVersion} on this device. Try again where it was published.`)
      const prior = yield* publishedOf(row)
      const previous = prior?.repositoryId === row.repositoryId ? prior : null
      // What its last save wrote, and where: only those files are its own to replace, move or remove.
      const [last] =
        previous === null
          ? []
          : yield* sql<{
              manifest: string
            }>`SELECT manifest FROM canvas_versions WHERE canvas_id = ${canvas.id} AND number = ${previous.version}`
      const lastFiles = last === undefined ? null : yield* readVersionFiles(artifacts, last.manifest)
      if (previous !== null && lastFiles === null)
        return yield* refuse(
          `Althar couldn’t find the files of v${previous.version}, its last save, on this device, so it can’t tell its own files in git from others’. Try again where it was published.`,
        )
      const wrote = previous === null || lastFiles === null ? null : { path: folderPath(previous.path), files: lastFiles.files }
      const remote = yield* remoteForSave(connections, checkout, row.repository, row.how)
      const pr = remote.hosted
      // Its own branch, by its id as well as its name: another project's artifact of the same name never shares it.
      const branch = row.how === 'main' ? remote.branch : `althar/artifacts/${canvas.name}-${canvas.id.replace(/^cnv_/, '').slice(0, 12)}`
      const baseRef = `refs/remotes/origin/${remote.branch}`
      const notOurs = refuse(
        `${row.repository} has a pull request open from ${branch} that Althar didn’t open for this artifact. Close it or rename its branch, then try again.`,
      )
      const fault = (step: string) => Effect.mapError((error: unknown) => refuse(problemIn(row.repository, branch, step, error)))
      const base = yield* fetchedInto(checkout, remote.fetch, remote.branch, baseRef).pipe(fault('fetch'))
      const open =
        row.how === 'pr' && pr !== null ? yield* pr.host.findChange(pr.repository, branch).pipe(fault('read the pull request')) : null
      const remoteHead = row.how === 'pr' ? yield* askedRemoteTip(checkout, remote.target, branch).pipe(fault('read the branch')) : null
      const head =
        remoteHead === null
          ? null
          : yield* fetchedInto(checkout, remote.target, branch, `refs/althar/artifacts/${canvas.id}`).pipe(fault('fetch'))
      const knownBranch = head !== null && previous?.how === 'pr' && previous.commit === head
      // An open pull request is this artifact's only where it is the one its last save recorded, or, before one was
      // recorded, the one its last save's own asking opened from that save's commit (`openedFor`). Anything else is
      // someone else's, never continued, even from the commit Althar pushed.
      const ours =
        open === null ||
        (previous?.pullRequest != null
          ? previous.pullRequest.number === open.number
          : knownBranch && head !== null && (yield* openedFor(canvas, row, head, open)))
      if (!ours) return yield* notOurs
      // After a push that didn't open its pull request, continue from that push. Once a
      // pull request closes, start from the default branch again, even after a squash.
      const continueFrom = open !== null || (knownBranch && previous?.pullRequest === null)
      if (open !== null && head === null)
        return yield* refuse(
          `The branch for ${row.repository}’s open pull request is missing. Restore it or close the pull request, then try again.`,
        )
      const start = continueFrom ? (head ?? base) : base
      const lease = !continueFrom && knownBranch ? (head ?? undefined) : undefined
      const moved = previous !== null && previous.path !== row.path
      const message = moved
        ? `Move ${version.title} to ${row.path}`
        : prior === null
          ? `Save ${version.title} v${row.nextVersion} from Althar`
          : `Update ${version.title} to v${row.nextVersion}`
      const sameOpen = open === null ? null : { number: open.number, url: open.url }
      const commit = yield* withCanvasWorktree(checkout, worktreeRoot, start, (worktree) =>
        Effect.gen(function* () {
          yield* stageCanvas(worktree, folderPath(row.path), wrote, files.files)
          const same =
            previous?.version === row.nextVersion &&
            previous.commit === start &&
            previous.path === row.path &&
            (yield* gitOutcome(worktree, 'diff', '--cached', '--quiet')).code === 0
          const commit = same ? start : yield* commitCanvas(worktree, creditedMessage(message, { coAuthor: yield* coAuthorOn, agents: [] }))
          yield* stillWanted(canvas, row)
          yield* pushTo(worktree, remote.target, branch, commit, lease).pipe(fault('push'))
          yield* keepPushed(canvas, row, commit, sameOpen)
          if (row.how === 'main' && remote.fetch.url === remote.target.url)
            yield* Effect.ignore(gitOutcome(checkout, 'update-ref', baseRef, commit, base))
          return commit
        }),
      ).pipe(fault('save the files'))
      if (row.how === 'main' || pr === null || sameOpen !== null) return
      const firstPull = prior === null || (knownBranch && prior.how === 'pr' && prior.pullRequest === null)
      const title = firstPull ? `Add ${version.title}` : `Update ${version.title} to v${row.nextVersion}`
      const request = { title, source: branch, target: remote.branch, draft: false }
      const mark = randomUUID()
      const opened = yield* outward({
        projectId: canvas.projectId,
        subject: { type: 'canvas', id: canvas.id },
        target: `${pr.host.product}:${pr.repository.path.join('/')}`,
        operation: 'open_change',
        key: openKey(canvas, row, commit),
        request: { ...request, mark },
        retryable: true,
        stands: stillWanted(canvas, row),
        // A host adopts one already open from the branch rather than open another: one someone opened as Althar asked
        // isn't this artifact's, and isn't kept as the answer.
        perform: pr.host
          .openChange(pr.repository, {
            ...request,
            body: `This saves v${row.nextVersion} of ${version.title} from Althar.\n\n${markOf(mark)}`,
          })
          .pipe(
            Effect.filterOrFail(
              (answer) => answer.body.includes(markOf(mark)),
              () => notOurs,
            ),
          ),
        encode: (answer) => answer,
        decode: (answer) => Option.getOrUndefined(decodeChange(answer)),
      }).pipe(Effect.provideContext(context), fault('open a pull request'))
      yield* keepPushed(canvas, row, commit, { number: opened.number, url: opened.url })
    })

  const drain = (canvas: CanvasRow) =>
    canvases.withLock(
      canvas.id,
      Effect.gen(function* () {
        while (true) {
          const row = yield* rowOf(canvas.id)
          if (row?.state !== 'saving') return
          const run = Effect.gen(function* () {
            const repo = yield* repoOf(canvas.projectId, row.repositoryId)
            if (repo.checkout === null) return yield* refuse(`Open a checkout of ${repo.name} on this device, then try again.`)
            const [version] = yield* sql<Version>`SELECT title, manifest FROM canvas_versions
            WHERE canvas_id = ${canvas.id} AND number = ${row.nextVersion}`
            if (version === undefined)
              return yield* refuse(`Althar couldn’t find v${row.nextVersion} of this canvas. Try saving the latest version again.`)
            yield* checkouts.withLock(repo.checkout, write(canvas, row, repo.checkout, version))
          })
          const result = yield* Effect.exit(run)
          if (Exit.isFailure(result) && Cause.hasInterruptsOnly(result.cause))
            return yield* Effect.failCause(result.cause).pipe(Effect.orDie)
          const problem = Exit.isSuccess(result)
            ? null
            : problemIn(row.repository, '', 'save the canvas', Option.getOrUndefined(Cause.findErrorOption(result.cause)))
          if (Exit.isFailure(result)) yield* Effect.logDebug('Could not save canvas', result.cause)
          const updated = yield* sql.withTransaction(
            Effect.gen(function* () {
              const [changed] = yield* sql<{ state: CanvasSaved['state'] }>`UPDATE canvas_saves SET
            state = CASE WHEN ${problem} IS NOT NULL THEN 'failed' WHEN next_version < through_version THEN 'saving' ELSE 'saved' END,
            problem = ${problem}, next_version = next_version + ${problem === null ? 1 : 0}
            WHERE canvas_id = ${canvas.id} AND request = ${row.request}
            RETURNING state`
              if (changed !== undefined) yield* canvasChanged(canvas)
              return changed?.state
            }),
          )
          // A replacement has its own worker waiting. Stop takes the row away.
          if (updated !== 'saving') return
        }
      }),
    )

  const start = (canvas: CanvasRow) =>
    Effect.asVoid(
      Effect.forkIn(
        drain(canvas).pipe(
          Effect.interruptible,
          Effect.provideService(Foreground, false),
          Effect.provideService(Database.ReadPriority, 'background'),
          Effect.catchCause((cause) => Effect.logWarning('Canvas save could not settle', cause)),
        ),
        scope,
      ),
    )

  const save = (asked: Save) =>
    Effect.gen(function* () {
      const path = folderPath(asked.path)
      if (!safePath(path)) return yield* refuse('Pick a folder of its own inside the repository for this canvas.')
      const canvas = yield* sql.withTransaction(
        Effect.gen(function* () {
          const canvas = yield* canvasOf(asked.canvasId)
          yield* repoOf(canvas.projectId, asked.repositoryId)
          const request = randomUUID()
          yield* sql`INSERT INTO canvas_saves (canvas_id, repository_id, path, how, follow, tracking, request, next_version, through_version, state)
          VALUES (${canvas.id}, ${asked.repositoryId}, ${`${path}/`}, ${asked.how}, ${Number(asked.follow)}, ${request}, ${request}, ${canvas.latest}, ${canvas.latest}, 'saving')
          ON CONFLICT (canvas_id) DO UPDATE SET repository_id = excluded.repository_id, path = excluded.path, how = excluded.how,
            follow = excluded.follow, request = excluded.request, next_version = excluded.next_version,
            through_version = excluded.through_version, state = 'saving', problem = NULL`
          const parent = posix.dirname(path)
          yield* putHome(canvas.projectId, { ...asked, folder: parent === '.' ? '' : `${parent}/` }, asked.makeHome === true)
          yield* canvasChanged(canvas)
          return canvas
        }),
      )
      yield* start(canvas)
    }).pipe(Effect.uninterruptible)

  const stop = (canvasId: string) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const canvas = yield* canvasOf(canvasId)
        yield* sql`DELETE FROM canvas_saves WHERE canvas_id = ${canvasId}`
        yield* canvasChanged(canvas)
      }),
    )

  const follow = (canvasId: string) =>
    Effect.gen(function* () {
      const canvas = yield* sql.withTransaction(
        Effect.gen(function* () {
          const canvas = yield* canvasOf(canvasId)
          const bumped = yield* sql`UPDATE canvas_saves SET through_version = ${canvas.latest}, state = 'saving', problem = NULL
          WHERE canvas_id = ${canvasId} AND follow = 1 AND through_version < ${canvas.latest} RETURNING canvas_id`
          if (bumped.length === 0) return null
          yield* canvasChanged(canvas)
          return canvas
        }),
      )
      if (canvas !== null) yield* start(canvas)
    })

  const published = (canvasId: string) =>
    Effect.asVoid(
      Effect.forkIn(
        follow(canvasId).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not queue a canvas’s next version', cause))),
        scope,
      ),
    )

  // A publish and its background save may be interrupted by closing the app.
  // The stored range also lets several publishes in quick succession save in order.
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      const rows = yield* sql<{
        canvasId: string
        state: CanvasSaved['state']
      }>`SELECT canvas_id, state FROM canvas_saves WHERE state = 'saving' OR follow = 1`
      for (const row of rows) {
        yield* follow(row.canvasId)
        if (row.state === 'saving') yield* start(yield* canvasOf(row.canvasId))
      }
    }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not resume canvas saves', cause))),
  )

  return { saved, home, place, folders, setHome, save, stop, published }
})

export class CanvasSaves extends Context.Service<CanvasSaves, Effect.Success<typeof make>>()('@althar/runtime/CanvasSaves') {
  static readonly layer = Layer.effect(CanvasSaves, make)
}
