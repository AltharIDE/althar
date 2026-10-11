import { at, id, index, project, ref, revision, table } from './0001_initial/columns'

/*
 * A project's notes (ADR-027): short decisions the person made in
 * conversation with the coordinator that the code doesn't show, such as how
 * a kind of task goes or what not to change. The coordinator keeps them, and
 * every session of it starts with them; the person sees them in the
 * project's settings and drops what no longer holds. Dropping one keeps its
 * row, so what it said stays on the record.
 */
export const statements: ReadonlyArray<string> = [
  "INSERT INTO vocab_aggregate_type (word) VALUES ('project_note')",
  table('project_notes', [
    id('note'),
    project(),
    'body TEXT NOT NULL CHECK (length(trim(body)) > 0)',
    ref('created_by_actor_id', 'actors'),
    at('created_at'),
    ref('dropped_by_actor_id', 'actors', { nullable: true }),
    at('dropped_at', { nullable: true }),
    revision,
  ]),
  index('project_notes_kept', 'project_notes (project_id)', { where: 'dropped_at IS NULL' }),
]
