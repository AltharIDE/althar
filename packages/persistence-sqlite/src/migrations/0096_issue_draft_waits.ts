import { at } from './0001_initial/columns'

/*
 * An issue draft the person filed may wait before Althar asks its tracker:
 * behind another filing on the same account, or until the tracker's limit
 * on calls resets, where it said when (`waiting`). Nothing of a waiting
 * draft has reached the tracker on that try, unlike one being filed; so a
 * draft left waiting when Althar closes was not filed, and one left being
 * filed may have been. `waiting_until` is when it will be asked again,
 * where the tracker said; null while it waits its turn.
 */
export const statements: ReadonlyArray<string> = [
  "INSERT INTO vocab_issue_draft_state (word) VALUES ('waiting')",
  `ALTER TABLE issue_drafts ADD COLUMN ${at('waiting_until', { nullable: true })}`,
]
