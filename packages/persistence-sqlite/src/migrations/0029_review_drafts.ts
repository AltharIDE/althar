import {
  at,
  gitObject,
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
 * A review the lead of a review task drafted of someone else's pull request
 * (docs/architecture/06, "Reviewing someone else's pull request"). Nothing
 * reaches the code host until the person posts it from its card in the
 * task's thread, or their own setting posts their team's; or they discard
 * it. A draft keeps the pull request as it was read (its repository, number,
 * link, title, author, whether it came from outside, and the commit the lead
 * read), the lead's suggested verdict and the one chosen (none yet, for an
 * outside pull request the lead would approve), the summary, its comments on
 * lines with their severity and whether each is kept, and where it stands:
 * waiting on the person, being posted, posted (with the review's id and
 * link), not posted with the host's words why, perhaps posted (its answer
 * lost), or discarded. The card is a thread item that holds the draft's id.
 *
 * The pull request a task reviews is the task's external link of kind
 * `review`: the task's own change is kind `change`, which Althar listens to,
 * and someone else's pull request isn't.
 */
export const statements: ReadonlyArray<string> = [
  ...vocabulary('review_draft_state', ['pending', 'posting', 'posted', 'failed', 'uncertain', 'discarded']),
  ...vocabulary('review_verdict', ['approve', 'changes', 'comment']),
  "INSERT INTO vocab_thread_item_kind (word) VALUES ('review_draft')",
  "INSERT INTO vocab_aggregate_type (word) VALUES ('review_draft')",
  "INSERT INTO vocab_external_kind (word) VALUES ('review')",
  table(
    'review_drafts',
    [
      id('rdr'),
      project(),
      scoped('task_id'),
      scoped('thread_id'),
      ref('connection_id', 'connections'),
      word('product', 'connection_product'),
      'repository TEXT NOT NULL',
      'number INTEGER NOT NULL CHECK (number >= 1)',
      'url TEXT NOT NULL',
      'title TEXT NOT NULL',
      'author TEXT NOT NULL',
      'outside INTEGER NOT NULL CHECK (outside IN (0, 1))',
      gitObject('head_commit'),
      'drafter TEXT',
      'account TEXT',
      word('suggested', 'review_verdict'),
      word('verdict', 'review_verdict', { nullable: true }),
      'summary TEXT NOT NULL',
      json('comments', { empty: '[]' }),
      word('state', 'review_draft_state'),
      'error TEXT',
      'review_ref TEXT',
      'review_url TEXT',
      ref('drafted_by_actor_id', 'actors'),
      at('created_at'),
      at('updated_at'),
      at('decided_at', { nullable: true }),
      revision,
    ],
    [
      sameProject('task_id', 'tasks'),
      sameProject('thread_id', 'threads'),
      referencedInProject,
      "CHECK ((state = 'posted') = (review_ref IS NOT NULL AND decided_at IS NOT NULL))",
      "CHECK ((state IN ('failed', 'uncertain')) = (error IS NOT NULL))",
      // Posted, it went with a verdict.
      "CHECK (state <> 'posted' OR verdict IS NOT NULL)",
    ],
  ),
  index('review_drafts_by_task', 'review_drafts (task_id)'),
  index('review_drafts_by_project', 'review_drafts (project_id)'),
]
