import { flag, json } from './0001_initial/columns'

/*
 * Issues filed with every field their tracker has, and at once where the
 * person prefers it (DEV-182). A draft keeps what else it is filed with, by
 * the tracker's own ids (`fields`: its project, milestone, assignees and the
 * like), whether it was filed at once rather than from its card (`direct`),
 * and what its tracker left off once filed (`left_off`: labels it hasn't, a
 * field it refused). A task's issue may be one the task does part of
 * (`part_of`): its merge comments on it rather than closing it.
 *
 * "Change issues without asking" goes: whether an issue is filed or changed
 * at once is the agents' call, by what the person said, kept as a project
 * note. A project that had it on keeps it as such a note, the person's own.
 */
export const statements: ReadonlyArray<string> = [
  `ALTER TABLE issue_drafts ADD COLUMN ${json('fields', { empty: '{}' })}`,
  `ALTER TABLE issue_drafts ADD COLUMN ${flag('direct', 0)}`,
  `ALTER TABLE issue_drafts ADD COLUMN ${json('left_off', { empty: '[]' })}`,
  `ALTER TABLE external_links ADD COLUMN ${flag('part_of', 0)}`,
  `INSERT INTO project_notes (id, project_id, body, created_by_actor_id, created_at)
    SELECT 'note_' || lower(hex(randomblob(16))), p.project_id,
      'Change issues at once, without a card to apply first.',
      (SELECT id FROM actors WHERE kind = 'person' ORDER BY rowid LIMIT 1),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM policies p
    WHERE p.revision = (SELECT max(q.revision) FROM policies q WHERE q.project_id = p.project_id)
      AND json_extract(p.rules, '$.changeIssues') = 1
      AND EXISTS (SELECT 1 FROM actors WHERE kind = 'person')`,
]
