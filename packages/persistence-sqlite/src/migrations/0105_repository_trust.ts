import { at, id, index, json, project, ref, revision, sameProject, scoped, sha256, table } from './0001_initial/columns'

/*
 * What the person decided about a repository's own agent settings that run something (DEV-280, "Trusting a
 * repository's agent settings" in docs/decisions/what-agents-may-do.md): one row for each of a repository's
 * settings files, by the hash of what in it runs, trusted or not. A lead's session loads the file only while its
 * worktree's copy has a trusted hash; one changed since is news again. `runs` is what the person was shown, so
 * Project settings says what was trusted. Taking trust back keeps the row, as not trusted.
 */
export const statements: ReadonlyArray<string> = [
  "INSERT INTO vocab_aggregate_type (word) VALUES ('repository_trust')",
  table(
    'repository_trust',
    [
      id('rtr'),
      project(),
      scoped('binding_id'),
      "agent TEXT NOT NULL CHECK (agent IN ('claude-code', 'codex', 'opencode'))",
      'file TEXT NOT NULL CHECK (length(file) BETWEEN 1 AND 300)',
      sha256('hash'),
      'trusted INTEGER NOT NULL CHECK (trusted IN (0, 1))',
      json('runs', { empty: '[]' }),
      ref('decided_by_actor_id', 'actors'),
      at('decided_at'),
      revision,
    ],
    [sameProject('binding_id', 'repository_bindings')],
  ),
  index('repository_trust_file', 'repository_trust (binding_id, file)', { unique: true }),
]
