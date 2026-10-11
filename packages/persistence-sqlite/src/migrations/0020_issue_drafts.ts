import {
  at,
  id,
  index,
  json,
  project,
  ref,
  referencedInProject,
  revision,
  sameProject,
  scoped,
  table,
  vocabulary,
  word,
} from './0001_initial/columns'

/*
 * An issue the coordinator drafts on a connected tracker (docs/architecture/
 * 06, "Drafting issues"). Nothing reaches the tracker until the person files
 * it from its card in the coordinator's thread, or they discard it. A draft
 * keeps where it goes (the connection, and the container by the tracker's id
 * and by its name), what it says, and where it stands: waiting on the
 * person, being filed, filed (with the issue's ref, key and link), not filed
 * with the tracker's words why, or discarded. The card is a thread item that
 * holds only the draft's id.
 */
export const statements: ReadonlyArray<string> = [
  ...vocabulary('issue_draft_state', ['pending', 'filing', 'filed', 'failed', 'discarded']),
  "INSERT INTO vocab_thread_item_kind (word) VALUES ('issue_draft')",
  "INSERT INTO vocab_aggregate_type (word) VALUES ('issue_draft')",
  table(
    'issue_drafts',
    [
      id('idraft'),
      project(),
      scoped('thread_id'),
      ref('connection_id', 'connections'),
      word('product', 'connection_product'),
      'container TEXT NOT NULL',
      'container_name TEXT NOT NULL',
      'title TEXT NOT NULL',
      'body TEXT NOT NULL',
      json('labels', { empty: '[]' }),
      word('state', 'issue_draft_state'),
      'error TEXT',
      'issue_ref TEXT',
      'issue_key TEXT',
      'issue_url TEXT',
      ref('drafted_by_actor_id', 'actors'),
      at('created_at'),
      at('updated_at'),
      at('decided_at', { nullable: true }),
      revision,
    ],
    [
      sameProject('thread_id', 'threads'),
      referencedInProject,
      "CHECK ((state = 'filed') = (issue_url IS NOT NULL AND issue_ref IS NOT NULL AND issue_key IS NOT NULL))",
      "CHECK ((state = 'failed') = (error IS NOT NULL))",
    ],
  ),
  index('issue_drafts_by_project', 'issue_drafts (project_id)'),
]
