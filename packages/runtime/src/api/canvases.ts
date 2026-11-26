import type { ApiHandlers } from '@althar/contracts'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Canvases } from '../Canvases'
import { CanvasSaves } from '../CanvasSaves'
import type { ApiKit } from './kit'

/**
 * A project's canvases and artifacts: listing, reading and drawing them.
 * Where they're saved to a repository, and saving or not.
 */
export const canvasesHandlers = ({ api }: ApiKit) =>
  Effect.gen(function* () {
    const canvases = yield* Canvases
    const canvasSaves = yield* CanvasSaves
    const sql = yield* SqlClient.SqlClient
    return {
      ListCanvases: ({ projectId, archived }) => api(canvases.list(projectId, archived === true)),
      // Artifacts whose own chat draws their first version (ADR-104, "Talking to an artifact"), newest first: each shows among
      // the project's artifacts from the moment it starts, until its first canvas.
      ListArtifactsDrawing: ({ projectId }) =>
        api(
          Effect.map(
            sql<{ taskId: string; threadId: string; projectId: string; title: string; startedAt: string }>`
              SELECT k.id AS task_id, t.id AS thread_id, k.project_id, k.title, k.created_at AS started_at
              FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
              WHERE k.project_id = ${projectId} AND k.artifact_chat = 1 AND k.artifact_canvas_id IS NULL
                AND k.state IN ('open', 'draft')
              ORDER BY k.created_at DESC, k.id DESC`,
            (rows) => rows.map((row) => ({ ...row })),
          ),
        ),
      GetCanvas: ({ canvasId }) => api(canvases.get(canvasId)),
      GetArtifactsPlace: ({ projectId }) => api(canvasSaves.place(projectId)),
      ListRepositoryFolders: ({ projectId, repositoryId }) => api(canvasSaves.folders(projectId, repositoryId)),
      ReadCanvasText: ({ canvasId, version }) => api(canvases.text(canvasId, version)),
      SetArtifactsHome: ({ projectId, home }) => api(canvasSaves.setHome(projectId, home)),
      SaveCanvas: ({ commandId: _commandId, ...asked }) => api(canvasSaves.save(asked)),
      StopSavingCanvas: ({ canvasId }) => api(canvasSaves.stop(canvasId)),
    } satisfies Partial<ApiHandlers>
  })
