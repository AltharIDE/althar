import { lstatSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, type posix, relative, resolve, sep } from 'node:path'

import { type ApiHandlers, ApiError } from '@althar/contracts'
import { Effect, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { taskWorker } from '../workerExecution'
import { codeRootOf } from '../code'
import { NotFound } from '../errors'
import { RuntimeConfig } from '../Config'
import { Instance } from '../Instance'
import { Fetches } from '../Fetches'
import { Launches } from '../Launches'
import { Terminals } from '../Terminals'
import { Queries } from '../Queries'
import { Sessions } from '../Sessions'
import type { ApiKit } from './kit'

/** Whether something is at a path, a link to nothing included. */
const isThere = (path: string) => {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * Where a path really is, links followed: for one not there yet, its nearest
 * folder that is, and the rest after it. A link to nothing is nowhere: the
 * empty path, which is inside no folder.
 */
const realOf = (path: string): string => {
  let at = path
  const rest: string[] = []
  while (!isThere(at) && dirname(at) !== at) {
    rest.unshift(basename(at))
    at = dirname(at)
  }
  try {
    return join(realpathSync(at), ...rest)
  } catch {
    return ''
  }
}

/** Whether a file is in a folder, as this system writes paths (`C:\\…` on Windows): not the folder itself, nor out of it by `..`. */
export const isInside = (
  folder: string,
  file: string,
  paths: Pick<typeof posix, 'relative' | 'isAbsolute' | 'sep'> = { relative, isAbsolute, sep },
) => {
  const within = paths.relative(folder, file)
  return within !== '' && within !== '..' && !within.startsWith(`..${paths.sep}`) && !paths.isAbsolute(within)
}

/**
 * What Althar runs or opens on this computer for a project: runnables, scripts, launches and their output, terminals.
 * What a session left running in the background, and opening a task's files in an editor.
 */
export const launchesHandlers = ({ actorId, api, holdingFolder }: ApiKit) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const launches = yield* Launches
    const terminals = yield* Terminals
    const fetches = yield* Fetches
    const queries = yield* Queries
    const instance = yield* Instance
    const sql = yield* SqlClient.SqlClient
    const openingFolder = (taskId: string) => holdingFolder(taskId, Effect.void)
    const config = yield* RuntimeConfig
    return {
      ListEditors: () => Effect.succeed(config.editors?.list() ?? []),
      OpenInEditor: ({ taskId, editor, path, line }) =>
        api(
          Effect.gen(function* () {
            const open = config.editors?.open
            if (open === undefined || (yield* taskWorker(taskId)) !== null) return false
            yield* openingFolder(taskId)
            // The task's folder: its worktree, or with several the folder that holds them, which its changes' paths start from.
            const worktrees = yield* sql<{ path: string }>`
              SELECT path FROM workspaces WHERE task_id = ${taskId} AND device_id = ${instance.deviceId} ORDER BY created_at, rowid`
            const [first] = worktrees
            if (first === undefined) return yield* new NotFound({ kind: 'task worktree', id: taskId })
            const folder = yield* Effect.sync(() => realOf(worktrees.length > 1 ? dirname(first.path) : first.path))
            // A path from the task's changes, never one that leaves its folder, by `..` or by a link.
            const file = path === undefined ? null : yield* Effect.sync(() => realOf(resolve(folder, path)))
            if (file !== null && !isInside(folder, file)) return false
            return yield* open(editor, folder, file, line ?? null)
          }),
        ),
      // A file an agent named: a task's in its folder, as OpenInEditor opens it; the coordinator's in the person's own checkout.
      OpenCode: ({ threadId, editor, path, line }) =>
        api(
          Effect.gen(function* () {
            const open = config.editors?.open
            if (open === undefined) return false
            const [thread] = yield* sql<{ taskId: string | null }>`SELECT task_id FROM threads WHERE id = ${threadId}`
            if (thread?.taskId != null) {
              if ((yield* taskWorker(thread.taskId)) !== null) return false
              yield* openingFolder(thread.taskId)
            }
            const place = yield* queries.codeRoots(threadId)
            const found = codeRootOf(place, path)
            if (found === null) return false
            // A task's folder as OpenInEditor opens it, with several worktrees the one that holds them; else the repository's.
            const whole = place.kind === 'task' && place.roots.length > 1
            const folder = yield* Effect.sync(() => realOf(whole ? dirname(found.root.editor) : found.root.editor))
            // Never a path that leaves the folder, by `..` or by a link; the folder alone where the file isn't there, as on another branch.
            const file = yield* Effect.sync(() => realOf(resolve(folder, whole ? path : found.path)))
            if (!isInside(folder, file)) return false
            return yield* open(editor, folder, isThere(file) ? file : null, isThere(file) ? (line ?? null) : null)
          }),
        ),
      StopBackground: ({ threadId, id }) => api(sessions.stopBackground(threadId, id)),
      ReadBackgroundOutput: ({ threadId, id }) => api(sessions.backgroundOutput(threadId, id)),
      ClearBackground: ({ threadId, id }) => api(sessions.clearBackground(threadId, id)),
      RunProject: ({ projectId, taskId, threadId, runnableId, branch, pullRequest, repository }) =>
        api(
          launches.start({
            projectId,
            taskId,
            threadId,
            ...(runnableId === undefined ? {} : { runnableId }),
            ...(repository === undefined ? {} : { repository }),
            ...(branch !== undefined
              ? { ref: { kind: 'branch' as const, name: branch } }
              : pullRequest !== undefined
                ? { ref: { kind: 'pull_request' as const, which: pullRequest } }
                : {}),
          }),
        ),
      GetRunnableRefs: ({ projectId, text }) => api(fetches.offered(projectId, text)),
      KeepRunnable: ({ projectId, id, name, command, repository }) =>
        api(
          Effect.map(
            launches.keepRunnable({
              projectId,
              ...(id === undefined ? {} : { id }),
              name,
              command,
              ...(repository === undefined ? {} : { repository }),
              actorId: actorId,
            }),
            (kept) => ({ id: kept.id }),
          ),
        ),
      DropRunnable: ({ projectId, id }) => api(launches.dropRunnable({ projectId, id, actorId: actorId })),
      OrderRunnables: ({ projectId, ids }) => api(launches.orderRunnables({ projectId, ids, actorId: actorId })),
      GetRepositoryScripts: ({ projectId }) => api(launches.scripts(projectId)),
      StopLaunch: ({ id }) => api(launches.stop(id)),
      ClearLaunch: ({ id }) => api(launches.clear(id)),
      ReadLaunchOutput: ({ id }) => api(launches.output(id)),
      OpenTerminal: ({ commandId: _commandId, ...input }) =>
        api(
          terminals.open({
            id: input.id,
            projectId: input.projectId,
            taskId: input.taskId,
            cols: input.cols,
            rows: input.rows,
            ...(input.launchId === undefined ? {} : { launchId: input.launchId }),
          }),
        ),
      // A terminal is the person's own shell, on the computer whose window or paired window opens it: a home runs it where its files are.
      ListTerminals: ({ projectId }) => api(terminals.ofProject(projectId)),
      ListLaunches: ({ projectId }) => api(launches.ofProject(projectId)),
      AttachTerminal: ({ id }) =>
        Stream.mapError(terminals.attach(id), (error) => new ApiError({ reason: 'NotFound', message: `No terminal ${error.id}.` })),
      // Each key as it is pressed: straight to the shell, not through the call log a command keeps.
      WriteTerminal: ({ id, data }) => api(terminals.write(id, data)),
      ResizeTerminal: ({ id, cols, rows }) => api(terminals.resize(id, cols, rows)),
      CloseTerminal: ({ id }) => api(terminals.close(id)),
    } satisfies Partial<ApiHandlers>
  })
