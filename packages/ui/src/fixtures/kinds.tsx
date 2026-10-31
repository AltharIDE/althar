import type { BoardCardProps } from '../board/BoardCard/BoardCard'
import { BranchChip, CommandChip, Fact, FileChips, Findings, PullChip, Thumbs } from '../board/BoardCard/Chips'
import { TaskKind, TaskStatus } from '../foundations/vocabulary'
import { trackOf } from '../primitives/StepTrack/StepTrack'
import { GITHUB } from './outputs'
import { SHOT_AFTER, SHOT_BEFORE, SHOT_RUN } from './shots'

/*
 * Meridian's board, a card for each kind in each lane it reaches: a change
 * running and needing you, a review of someone else's pull request, and
 * plain tasks, which say only where they stand and what they handed back.
 * Every card has nothing to press: the whole of it opens its task.
 */

/* What a card is given, without what the board wires to it. */
type Card = Omit<BoardCardProps, 'onOpen' | 'current' | 'text'>

const picture = (shot: { readonly id: string; readonly src?: string; readonly name: string }) => ({
  id: shot.id,
  src: shot.src ?? '',
  name: shot.name,
})

export const CHANGE_RUNNING: Card = {
  status: TaskStatus.Running,
  word: 'Implement',
  kind: TaskKind.Change,
  at: '9m',
  title: 'Return 409 when a refund idempotency key is reused',
  track: trackOf(['Implement', 'Review'], 0),
  object: <BranchChip name="meridian/return-409-on-reused-idempotency-key" add={84} del={6} />,
}

/** A follow-up on a change whose pull request is open: the pull request, and its checks so far. */
export const CHANGE_RUNNING_PR: Card = {
  status: TaskStatus.Running,
  word: 'Follow-up',
  kind: TaskKind.Change,
  at: '14m',
  title: 'Sign webhook v2 payloads with rotating keys',
  track: trackOf(['Follow-up', 'Review'], 0),
  object: <PullChip host={GITHUB} repo="meridian-api" number={1194} add={395} del={83} />,
  foot: <Fact>6 of 8 checks passed</Fact>,
}

export const CHANGE_READY: Card = {
  status: TaskStatus.Yours,
  word: 'Ready to accept',
  kind: TaskKind.Change,
  at: '31m',
  title: 'Repair token refresh on privilege change',
  object: <PullChip host={GITHUB} repo="meridian-api" number={1187} add={412} del={37} />,
  foot: (
    <Fact icon="check" tone="ok">
      All 8 checks passed
    </Fact>
  ),
}

/** Its pull request in its branch's merge queue: every step done, none on, and its host merges it once the queue's checks pass. */
export const CHANGE_IN_MERGE_QUEUE: Card = {
  status: TaskStatus.Running,
  word: 'In the merge queue',
  kind: TaskKind.Change,
  at: '1h 6m',
  title: 'Question cards: a one-line question, not a paragraph',
  track: trackOf(['Implement', 'Review'], 1, 1, true),
  object: <PullChip host={GITHUB} repo="althar" number={482} add={151} del={17} />,
  foot: <Fact>24 of 32 checks passed</Fact>,
}

/** Its lead couldn't resolve a conflict with the default branch: warm, not red, since nothing is lost. */
export const CHANGE_CONFLICT: Card = {
  status: TaskStatus.Yours,
  word: 'Merge conflict',
  kind: TaskKind.Change,
  at: '12m',
  title: 'Migrate billing webhooks to the v2 endpoint',
  why: 'The lead couldn’t resolve the conflict with main in README.md and sign.ts.',
  object: <PullChip host={GITHUB} repo="meridian-api" number={1189} add={998} del={77} />,
  foot: (
    <Fact icon="branch" tone="warm">
      Conflicts with main in 2 files
    </Fact>
  ),
}

export const CHANGE_PERMISSION: Card = {
  status: TaskStatus.Yours,
  word: 'Permission',
  kind: TaskKind.Change,
  at: '2m',
  title: 'Backfill idempotency keys on refunds created before PR 1184',
  why: 'Wants to run the backfill against the staging database, outside its worktree.',
  object: <CommandChip>bun run scripts/backfill-idempotency.ts --env staging --batch 500</CommandChip>,
}

export const CHANGE_QUESTION: Card = {
  status: TaskStatus.Yours,
  word: 'Question',
  kind: TaskKind.Change,
  at: '4m',
  title: 'Queue refunds that hit the rate limit',
  why: 'Which database should the refund queue live in?',
}

export const CHANGE_STUCK: Card = {
  status: TaskStatus.Yours,
  word: 'Stuck',
  kind: TaskKind.Change,
  at: '6m',
  title: 'Verify refunds made before PR 1184',
  why: 'Tried three ways round it. It needs the backfill in MER-231, or a word from you.',
}

export const REVIEW_RUNNING: Card = {
  status: TaskStatus.Running,
  word: 'Reading',
  kind: TaskKind.Review,
  at: '3m',
  title: 'Review #1202: Retry partner webhooks with jitter',
  object: <PullChip host={GITHUB} number={1202} add={64} del={12} by="okafor-dev" />,
  foot: <Fact>1 finding so far</Fact>,
}

export const REVIEW_DRAFTED: Card = {
  status: TaskStatus.Yours,
  word: 'Review drafted',
  kind: TaskKind.Review,
  at: '2m',
  title: 'Review #1199: Send back won’t restart a dead lead session',
  object: <PullChip host={GITHUB} number={1199} add={58} del={20} by="ninemate" />,
  foot: <Findings count={3} detail="1 blocking · request changes" />,
}

export const PLAIN_WORKING: Card = {
  status: TaskStatus.Running,
  word: 'Working',
  kind: TaskKind.Plain,
  at: '1m',
  title: 'Why do refunds fail fast when webhooks retry?',
}

export const PLAIN_FINISHED: Card = {
  status: TaskStatus.Yours,
  word: 'Finished',
  kind: TaskKind.Plain,
  at: '12m',
  title: 'Which partners still call the v1 webhook endpoint?',
}

export const PLAIN_PICTURES: Card = {
  status: TaskStatus.Yours,
  word: 'Finished',
  kind: TaskKind.Plain,
  at: '4m',
  title: 'Prototype the refunds page’s empty state',
  object: <Thumbs pictures={[picture(SHOT_BEFORE), picture(SHOT_AFTER), ...SHOT_RUN.slice(0, 1).map(picture)]} />,
}

/** One of its pictures still being made. */
export const PLAIN_PICTURES_MAKING: Card = {
  ...PLAIN_PICTURES,
  status: TaskStatus.Running,
  word: 'Working',
  object: <Thumbs pictures={[picture(SHOT_BEFORE), picture(SHOT_AFTER)]} making={1} />,
}

export const PLAIN_FILES: Card = {
  status: TaskStatus.Yours,
  word: 'Finished',
  kind: TaskKind.Plain,
  at: '40m',
  title: 'Draft the 0.4 release notes for the partner site',
  object: <FileChips files={[{ path: 'docs/releases/partners/release-notes-0.4.md', add: 64 }]} />,
}

/** Waiting for a free agent before any work: nothing has run, so there is no track, branch or clock. It starts on its own. */
export const CHANGE_QUEUED: Card = {
  status: TaskStatus.Queued,
  word: 'Waiting',
  kind: TaskKind.Change,
  at: '',
  title: 'Extract rate-limit policy into a shared module',
  why: '4 of 4 agents busy on this Mac',
}

/** Waiting for a free agent after real work: the step done and the branch with its diff stay; the step it waits for stands still and empty. */
export const CHANGE_QUEUED_MIDWAY: Card = {
  status: TaskStatus.Queued,
  word: 'Waiting',
  kind: TaskKind.Change,
  at: '31m',
  title: 'Extract rate-limit policy into a shared module',
  why: '4 of 4 agents busy on this Mac',
  track: trackOf(['Implement', 'Review'], 1),
  object: <BranchChip name="meridian/extract-rate-limit-policy" add={212} del={48} />,
}

export const CHANGE_STOPPED: Card = {
  status: TaskStatus.Stopped,
  word: 'Stopped',
  kind: TaskKind.Change,
  at: '22m',
  title: 'Reduce cold start on the checkout worker',
  why: 'Stopped when you interrupted it',
  track: trackOf(['Implement', 'Review'], 1),
}

/** Held until an agent's usage limit resets: still, and it carries on by itself. */
export const CHANGE_PAUSED: Card = {
  status: TaskStatus.Paused,
  word: 'Paused',
  kind: TaskKind.Change,
  at: '31m',
  title: 'Refunds rate-limit like charges',
  why: 'Waits for Codex, back at 14:00',
  track: trackOf(['Implement', 'Review'], 1),
}

/** Every kind's cards, in the order the board's lanes take them. */
export const KIND_CARDS: ReadonlyArray<{ readonly id: string; readonly card: Card }> = [
  { id: 'change running', card: CHANGE_RUNNING },
  { id: 'change running, its pull request', card: CHANGE_RUNNING_PR },
  { id: 'review running', card: REVIEW_RUNNING },
  { id: 'plain working', card: PLAIN_WORKING },
  { id: 'change ready', card: CHANGE_READY },
  { id: 'change in the merge queue', card: CHANGE_IN_MERGE_QUEUE },
  { id: 'merge conflict', card: CHANGE_CONFLICT },
  { id: 'permission', card: CHANGE_PERMISSION },
  { id: 'question', card: CHANGE_QUESTION },
  { id: 'stuck', card: CHANGE_STUCK },
  { id: 'review drafted', card: REVIEW_DRAFTED },
  { id: 'plain finished', card: PLAIN_FINISHED },
  { id: 'plain, its pictures', card: PLAIN_PICTURES },
  { id: 'plain, a picture being made', card: PLAIN_PICTURES_MAKING },
  { id: 'plain, its files', card: PLAIN_FILES },
  { id: 'waiting for an agent', card: CHANGE_QUEUED },
  { id: 'waiting for an agent, midway', card: CHANGE_QUEUED_MIDWAY },
  { id: 'paused', card: CHANGE_PAUSED },
  { id: 'stopped', card: CHANGE_STOPPED },
]
