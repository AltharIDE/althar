import {
  at,
  flag,
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
 * Code hosts and trackers (docs/architecture/06, ADR-011).
 *
 * A connection is a person's sign-in to a service on this device: which
 * product, which instance, which account, and how they signed in. Its token
 * is in the system keychain; the row keeps only the name it is kept under.
 * Removing a connection keeps its row, so what it did stays attributable.
 *
 * An external link ties a task to something outside: the issue it came from,
 * or the pull request it opened (whose repository change has its URL). It
 * keeps what Althar last saw of it, and, while the task listens to it, the
 * cursor its activity was last read from.
 *
 * Things heard from outside are observations; each comment, review or check
 * outcome is recorded once, so it reaches the thread and the lead once.
 *
 * A thread item can be an arrival: something heard from outside, written by
 * someone else.
 */
export const statements: ReadonlyArray<string> = [
  ...vocabulary('connection_product', ['github', 'gitlab', 'bitbucket_cloud', 'bitbucket_dc', 'linear', 'jira_cloud', 'jira_dc', 'trello']),
  ...vocabulary('connection_auth', ['device_flow', 'pkce', 'token']),
  ...vocabulary('connection_state', ['ready', 'reauth_required', 'removed']),
  ...vocabulary('external_kind', ['issue', 'change']),
  "INSERT INTO vocab_thread_item_kind (word) VALUES ('arrival')",
  "INSERT INTO vocab_aggregate_type (word) VALUES ('connection'), ('external_link')",
  table('connections', [
    id('conn'),
    ref('device_id', 'devices'),
    word('product', 'connection_product'),
    'web_url TEXT NOT NULL',
    'api_url TEXT NOT NULL',
    'account_id TEXT NOT NULL',
    'account_login TEXT NOT NULL',
    'account_name TEXT',
    word('auth', 'connection_auth'),
    'credential_ref TEXT NOT NULL',
    at('expires_at', { nullable: true }),
    word('state', 'connection_state'),
    at('created_at'),
    at('updated_at'),
    revision,
  ]),
  index('one_connection_per_account', 'connections (device_id, product, web_url, account_id)', {
    unique: true,
    where: "state <> 'removed'",
  }),
  table(
    'external_links',
    [
      id('xlink'),
      project(),
      scoped('task_id'),
      ref('connection_id', 'connections', { nullable: true }),
      word('product', 'connection_product'),
      word('kind', 'external_kind'),
      'external_id TEXT NOT NULL',
      'ref TEXT NOT NULL',
      'key TEXT NOT NULL',
      'url TEXT NOT NULL',
      json('snapshot', { empty: '{}' }),
      flag('listening', 0),
      'cursor TEXT',
      at('polled_at', { nullable: true }),
      at('created_at'),
      at('updated_at'),
      revision,
    ],
    ['UNIQUE (task_id, kind, product, external_id)', sameProject('task_id', 'tasks'), referencedInProject],
  ),
  index('external_links_by_task', 'external_links (task_id)'),
  index('external_links_listening', 'external_links (listening)', { where: 'listening = 1' }),
  index('observations_once', "observations (subject_type, subject_id, kind, json_extract(payload, '$.id'))", {
    unique: true,
    where: "json_extract(payload, '$.id') IS NOT NULL",
  }),
]
