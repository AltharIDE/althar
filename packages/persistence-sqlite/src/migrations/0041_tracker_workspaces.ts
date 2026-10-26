import { index } from './0001_initial/columns'

/*
 * Several workspaces of a tracker, and a project bound to one (ADR-059).
 *
 * A Linear token reaches one workspace, so a connection keeps which: the key
 * its links carry (linear.app/<key>/issue/…) and its name. One account is
 * connected once per workspace: connecting it again renews that one, and
 * another workspace is a connection beside it. A connection made before it
 * kept none, and learns its workspace when next signed in or checked.
 *
 * A project may be bound to one of the trackers connected, and to where its
 * issues are filed there (a Linear team): by its id, and its name as the
 * tracker said it, to show without asking. Unbound, where a project's issues
 * go is learned from those it has, as before.
 */
export const statements: ReadonlyArray<string> = [
  'ALTER TABLE connections ADD COLUMN workspace_key TEXT',
  'ALTER TABLE connections ADD COLUMN workspace_name TEXT',
  'DROP INDEX one_connection_per_account',
  index('one_connection_per_account', "connections (device_id, product, web_url, account_id, coalesce(workspace_key, ''))", {
    unique: true,
    where: "state <> 'removed'",
  }),
  'ALTER TABLE projects ADD COLUMN tracker_connection_id TEXT REFERENCES connections (id)',
  'ALTER TABLE projects ADD COLUMN tracker_container_id TEXT CHECK (tracker_container_id IS NULL OR tracker_connection_id IS NOT NULL)',
  'ALTER TABLE projects ADD COLUMN tracker_container_name TEXT CHECK ((tracker_container_name IS NULL) = (tracker_container_id IS NULL))',
]
