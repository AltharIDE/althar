/*
 * The review after a merge, in the same task (a task is a conversation plus
 * parts, "After merge, in the same task"): one for each pull request of a
 * task that merged with something of it no review had read, where the task
 * has a reviewer, by the pull request's address. The task's own reviewer
 * reads a copy at the merged commit, from `base`, in a thread of the task's
 * own, and reports in the task's thread; nothing is posted on the merged
 * pull request.
 *
 * `state`: `owed` until it starts (a stop before it starts loses nothing, and
 * a restart mid-review starts it again), `running`, then `clear` where it
 * found nothing, or `found` with its findings waiting on the person, who
 * says `fixing` (Fix it: a round, its fix a new change after this one) or
 * `left` (Leave it); `stopped` where the person removed Checked by or it
 * could never start. `findings` is the reviewer's, as JSON; `summary` and
 * `verdict` its report's. `attempts` and `message` say why it hasn't started.
 *
 * It takes the place of the review task a small change's merge started
 * (`reviews_after_merge`, which a build before this one still reads):
 * each review still owed there is owed here, where its pull request is known.
 */
export const statements: ReadonlyArray<string> = [
  `CREATE TABLE merge_reviews (
    url TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    number INTEGER,
    base TEXT CHECK (base IS NULL OR (length(base) IN (40, 64) AND base NOT GLOB '*[^0-9a-f]*')),
    head TEXT,
    state TEXT NOT NULL CHECK (state IN ('owed', 'running', 'clear', 'found', 'fixing', 'left', 'stopped')),
    reviewer TEXT CHECK (json_valid(reviewer)),
    verdict TEXT CHECK (verdict IN ('pass', 'changes_requested')),
    summary TEXT,
    findings TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(findings)),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT`,
  'CREATE INDEX merge_reviews_by_task ON merge_reviews (task_id)',
  `INSERT INTO merge_reviews (url, task_id, project_id, state, attempts, message, created_at, updated_at)
    SELECT x.url, r.task_id, r.project_id, 'owed', r.attempts, r.message, r.created_at, r.updated_at
    FROM reviews_after_merge r
    JOIN external_links x ON x.id = (
      SELECT l.id FROM external_links l WHERE l.task_id = r.task_id AND l.kind = 'change'
        AND json_extract(l.snapshot, '$.state') = 'merged'
      ORDER BY l.created_at DESC, l.rowid DESC LIMIT 1)
    WHERE NOT EXISTS (SELECT 1 FROM external_links rv WHERE rv.kind = 'review' AND rv.url = x.url)`,
]
