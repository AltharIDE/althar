import { at, id, index, json, oneOf, ref, revision, sha256, table } from './columns'

/** Devices and actors, projects and their rules, repositories, and artifacts. */
export const projects: ReadonlyArray<string> = [
  table('devices', [id('dev'), 'name TEXT NOT NULL', at('created_at')]),

  table('actors', [
    id('act'),
    oneOf('kind', ['person', 'agent', 'system']),
    'display_name TEXT NOT NULL',
    'agent_id TEXT',
    at('created_at'),
    "CHECK ((kind = 'agent') = (agent_id IS NOT NULL))",
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

  table('policies', [
    id('pol'),
    ref('project_id', 'projects'),
    'revision INTEGER NOT NULL CHECK (revision >= 1)',
    json('rules'),
    ref('created_by_actor_id', 'actors'),
    at('created_at'),
    'UNIQUE (project_id, revision)',
  ]),

  table('project_settings', [
    'project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects (id)',
    'worktree_root TEXT',
    'setup_command TEXT',
    'check_command TEXT',
    json('copy_files', { empty: '[]' }),
    at('updated_at'),
    revision,
  ]),

  table('repository_bindings', [
    id('repo'),
    ref('project_id', 'projects'),
    "slug TEXT NOT NULL CHECK (slug <> '' AND slug NOT GLOB '*[^a-z0-9-]*')",
    'role TEXT NOT NULL',
    'display_name TEXT NOT NULL',
    json('remote_fingerprints', { empty: '[]' }),
    'provider_repository_id TEXT',
    json('allowed_subpaths', { empty: '[]' }),
    'default_base_ref TEXT',
    at('created_at'),
    at('detached_at', { nullable: true }),
    'UNIQUE (project_id, slug)',
  ]),

  table('repository_locations', [
    id('loc'),
    ref('binding_id', 'repository_bindings'),
    ref('device_id', 'devices'),
    oneOf('kind', ['existing', 'managed']),
    'path TEXT NOT NULL',
    json('observed_remotes', { empty: '[]' }),
    oneOf('state', ['ready', 'needs_access', 'changed', 'unavailable']),
    at('verified_at', { nullable: true }),
    at('created_at'),
    'UNIQUE (binding_id, device_id)',
  ]),

  table('artifacts', [
    id('art'),
    sha256('sha256'),
    'size INTEGER NOT NULL CHECK (size >= 0)',
    'media_type TEXT NOT NULL',
    oneOf('kind', ['brief', 'message', 'transcript', 'patch', 'log', 'report', 'findings', 'summary', 'other']),
    oneOf('sensitivity', ['normal', 'may_contain_secrets'], { default: 'normal' }),
    at('created_at'),
  ]),

  table('artifact_links', [
    'artifact_id TEXT NOT NULL REFERENCES artifacts (id)',
    'subject_type TEXT NOT NULL',
    'subject_id TEXT NOT NULL',
    'role TEXT NOT NULL',
    at('created_at'),
    'PRIMARY KEY (artifact_id, subject_type, subject_id, role)',
  ]),

  index('repository_bindings_by_project', 'repository_bindings (project_id)'),
  index('artifacts_by_digest', 'artifacts (sha256)'),
  index('artifact_links_by_subject', 'artifact_links (subject_type, subject_id)'),
]
