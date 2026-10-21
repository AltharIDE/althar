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
 * Changes to issues on the person's trackers (docs/architecture/06,
 * "Changing issues"), proposed by the coordinator, a task's lead, or Althar
 * as a task's pull request opens or merges. One card holds a change to each
 * of one or more issues: by the connection, the issue's ref, key, link and
 * title as it was read, the change by the tracker's own ids and names, and
 * how applying each went. Status, priority, assignee, labels and closing
 * wait on the person to apply them, unless the project's rules let them
 * through; a comment and a link apply at once, and their card is a line.
 * Where it stands: waiting on the person, being applied, applied, not all
 * applied (with why), or discarded. A draft's priority is kept with it.
 */
export const statements: ReadonlyArray<string> = [
  ...vocabulary('issue_change_state', ['pending', 'applying', 'applied', 'failed', 'discarded']),
  "INSERT INTO vocab_thread_item_kind (word) VALUES ('issue_changes')",
  "INSERT INTO vocab_aggregate_type (word) VALUES ('issue_change')",
  table(
    'issue_changes',
    [
      id('ich'),
      project(),
      scoped('thread_id'),
      json('changes', { empty: '[]' }),
      'note TEXT',
      word('state', 'issue_change_state'),
      'error TEXT',
      // Applied without asking, as the project's rules let it.
      flag('direct', 0),
      // Who proposed it: the coordinator, a task's lead (told what became of it), or Althar, as a task's pull request opened or merged.
      "proposed_by TEXT NOT NULL CHECK (proposed_by IN ('coordinator', 'lead', 'althar'))",
      ref('proposed_by_actor_id', 'actors'),
      at('created_at'),
      at('updated_at'),
      at('decided_at', { nullable: true }),
      revision,
    ],
    [sameProject('thread_id', 'threads'), referencedInProject, "CHECK ((state = 'failed') = (error IS NOT NULL))"],
  ),
  index('issue_changes_by_project', 'issue_changes (project_id)'),
  index('issue_changes_by_thread', 'issue_changes (thread_id, state)'),
  "ALTER TABLE issue_drafts ADD COLUMN priority TEXT CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none'))",
  // A draft's card, as its thread keeps it, says its priority too: none, for one drafted before priorities.
  "UPDATE thread_items SET content = json_set(content, '$.priority', json('null')) WHERE kind = 'issue_draft' AND json_type(content, '$.priority') IS NULL",
]
