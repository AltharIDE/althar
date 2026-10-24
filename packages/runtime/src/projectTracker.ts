import type { Product } from '@althar/connectors'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/*
 * The tracker a project is bound to (ADR-059): one of the connections, and
 * where its issues are filed there, which the person chose in the project's
 * settings. Bound, it is where the project's drafts go unless another is
 * named, the one tracker its issues are listed from, and the first asked
 * for a bare key. Unbound, where its issues go is learned from those it has.
 */

/**
 * A project's tracker: its connection, and where issues are filed there, by
 * the tracker's id and name; null for its default. Gone, it is the connection
 * chosen, disconnected and not connected again, with the workspace it reached.
 */
export interface ProjectTracker {
  readonly connectionId: string
  readonly product: Product
  readonly container: { readonly id: string; readonly name: string } | null
  readonly gone: { readonly webUrl: string; readonly workspace: string | null } | null
}

/**
 * The tracker a project is bound to, through a connection that is still
 * there: the one chosen, or, where it was disconnected, the same workspace
 * (or the same account, where its product has no workspaces) connected
 * again. Neither there, it is still bound, to one gone: its issues aren't
 * listed, nor its drafts made, from another workspace in its place. Null for
 * a project bound to none.
 */
export const projectTracker = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [bound] = yield* sql<{
      connectionId: string | null
      containerId: string | null
      containerName: string | null
    }>`SELECT tracker_connection_id AS connection_id, tracker_container_id AS container_id, tracker_container_name AS container_name
       FROM projects WHERE id = ${projectId}`
    if (bound === undefined || bound.connectionId === null) return null
    const [connection] = yield* sql<{ id: string; product: Product }>`
      SELECT c.id, c.product FROM connections c JOIN connections was ON was.id = ${bound.connectionId}
      WHERE c.device_id = was.device_id AND c.product = was.product AND c.web_url = was.web_url AND c.state <> 'removed'
        AND (c.id = was.id OR (CASE WHEN was.workspace_key IS NULL THEN c.account_id = was.account_id ELSE c.workspace_key = was.workspace_key END))
      ORDER BY c.id = was.id DESC, c.state = 'ready' DESC, c.created_at DESC LIMIT 1`
    const container = bound.containerId === null ? null : { id: bound.containerId, name: bound.containerName ?? bound.containerId }
    if (connection !== undefined)
      return { connectionId: connection.id, product: connection.product, container, gone: null } satisfies ProjectTracker
    const [was] = yield* sql<{ product: Product; webUrl: string; workspaceName: string | null }>`
      SELECT product, web_url, workspace_name FROM connections WHERE id = ${bound.connectionId}`
    if (was === undefined) return null
    return {
      connectionId: bound.connectionId,
      product: was.product,
      container,
      gone: { webUrl: was.webUrl, workspace: was.workspaceName },
    } satisfies ProjectTracker
  })
