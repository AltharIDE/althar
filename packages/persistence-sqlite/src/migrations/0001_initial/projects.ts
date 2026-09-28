import { at, id, index, json, project, ref, referencedInProject, revision, sameProject, scoped, sha256, table, word } from './columns'

/** Devices, actors and runtime launches; projects, their rules and settings; repositories; artifacts. */
export const projects: ReadonlyArray<string> = [
  table('devices', [id('dev'), 'name TEXT NOT NULL', at('created_at')]),

  table(
    'actors',
    [id('act'), word('kind', 'actor_kind'), 'display_name TEXT NOT NULL', 'agent_id TEXT', at('created_at')],
    ["CHECK ((kind = 'agent') = (agent_id IS NOT NULL))"],
  ),

  /* One row per launch of the runtime: who holds a controller generation, and who claimed a work item. */
  table('runtime_instances', [
    id('rt'),
    ref('device_id', 'devices'),
    'pid INTEGER NOT NULL CHECK (pid > 0)',
    'app_version TEXT NOT NULL',
    at('started_at'),
    at('ended_at', { nullable: true }),
  ]),

  table('projects', [
    id('proj'),
    'name TEXT NOT NULL',
    "slug TEXT NOT NULL UNIQUE CHECK (slug <> '' AND slug NOT GLOB '*[^a-z0-9-]*')",
    ref('created_by_actor_id', 'actors'),
    at('created_at'),
    at('archived_at', { nullable: true }),
    revision,
  ]),

  table(
    'policies',
    [
      id('pol'),
      project(),
      'revision INTEGER NOT NULL CHECK (revision >= 1)',
      json('rules'),
      ref('created_by_actor_id', 'actors'),
      at('created_at'),
    ],
    ['UNIQUE (project_id, revision)', referencedInProject],
  ),

  /* Settings every member shares. */
  table('project_settings', [
    'project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects (id)',
    'setup_command TEXT',
    'check_command TEXT',
    json('copy_files', { empty: '[]' }),
    at('updated_at'),
    revision,
  ]),

  /* Settings that belong to one device, such as where its worktrees go. They never leave the device. */
  table(
    'device_project_settings',
    ['project_id TEXT NOT NULL REFERENCES projects (id)', ref('device_id', 'devices'), 'worktree_root TEXT', at('updated_at')],
    ['PRIMARY KEY (project_id, device_id)'],
  ),

  table(
    'repository_bindings',
    [
      id('repo'),
      project(),
      "slug TEXT NOT NULL CHECK (slug <> '' AND slug NOT GLOB '*[^a-z0-9-]*')",
      'role TEXT NOT NULL',
      'display_name TEXT NOT NULL',
      json('remote_fingerprints', { empty: '[]' }),
      'provider_repository_id TEXT',
      json('allowed_subpaths', { empty: '[]' }),
      'default_base_ref TEXT',
      at('created_at'),
      at('detached_at', { nullable: true }),
    ],
    ['UNIQUE (project_id, slug)', referencedInProject],
  ),

  table(
    'repository_locations',
    [
      id('loc'),
      project(),
      scoped('binding_id'),
      ref('device_id', 'devices'),
      word('kind', 'location_kind'),
      'path TEXT NOT NULL',
      json('observed_remotes', { empty: '[]' }),
      word('state', 'location_state'),
      at('verified_at', { nullable: true }),
      at('created_at'),
    ],
    ['UNIQUE (binding_id, device_id)', sameProject('binding_id', 'repository_bindings')],
  ),

  /*
   * Artifact metadata; the bytes live in a content-addressed store by digest.
   * Every reference to an artifact, including one inside a JSON column, also
   * gets an artifact_links row, so cleanup can mark what is used without
   * parsing JSON.
   */
  table(
    'artifacts',
    [
      id('art'),
      project(),
      sha256('sha256'),
      'size INTEGER NOT NULL CHECK (size >= 0)',
      'media_type TEXT NOT NULL',
      word('kind', 'artifact_kind'),
      word('sensitivity', 'sensitivity', { default: 'normal' }),
      at('created_at'),
    ],
    [referencedInProject],
  ),

  table(
    'artifact_links',
    [project(), scoped('artifact_id'), 'subject_type TEXT NOT NULL', 'subject_id TEXT NOT NULL', 'role TEXT NOT NULL', at('created_at')],
    ['PRIMARY KEY (artifact_id, subject_type, subject_id, role)', sameProject('artifact_id', 'artifacts')],
  ),

  index('repository_bindings_by_project', 'repository_bindings (project_id)'),
  index('artifacts_by_digest', 'artifacts (sha256)'),
  index('artifact_links_by_subject', 'artifact_links (subject_type, subject_id)'),
]
