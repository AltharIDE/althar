import { Brand } from '../foundations/brands/brands'
import { ReviewVerdict } from '../foundations/vocabulary'

/*
 * A review the task's lead drafted of someone else's pull request on
 * Meridian's API: ninemate's, from a fork, with three comments on its lines.
 */

export const REVIEW_DRAFT = {
  mark: Brand.GitHub,
  source: 'GitHub',
  repository: 'meridian/api',
  number: '#1212',
  title: 'Honour Retry-After on refund webhooks',
  author: 'ninemate',
  drafter: 'Claude Code',
  as: 'ada',
  suggested: ReviewVerdict.Changes,
  verdict: ReviewVerdict.Changes,
  summary:
    'The fix is right: a 429 from the partner now waits as long as Retry-After says, capped at five minutes. Before it merges it needs a test for the cap, and the retry count reads oddly once a wait is long.',
  comments: [
    {
      id: 'c1',
      path: 'src/webhooks/refunds.test.ts',
      line: 88,
      body: 'Nothing covers a Retry-After longer than the cap. Could you add one where the partner asks for an hour?',
      kept: true,
    },
    {
      id: 'c2',
      path: 'src/webhooks/retry.ts',
      line: 41,
      body: '`attempts` counts a long wait as one more try, so the third retry can come two hours in. A deadline would read better.',
      kept: true,
    },
    {
      id: 'c3',
      path: 'src/webhooks/retry.ts',
      line: 57,
      body: 'Nit: `waitMs` is seconds here.',
      kept: true,
    },
  ],
} as const

/** Where the posted review opens. */
export const POSTED_REVIEW = { href: 'https://github.com/meridian/api/pull/1212#pullrequestreview-2981' }

/** What a review of ninemate's pull request, from a fork, can reach, as the task's view says it. */
export const OUTSIDE_REACH = [
  {
    id: 'reads',
    words: 'Reads ninemate’s branch',
    means:
      'Althar fetched the pull request’s head into a copy of its own. The agent reads it there and can’t change it, or fetch anything itself.',
  },
  {
    id: 'runs',
    words: 'runs nothing of it',
    means: 'Nothing the pull request brings runs: no install, no build, no tests, no scripts. Commands that only look are allowed.',
  },
  {
    id: 'network',
    words: 'no network',
    means:
      'The agent has no network, and Althar refuses its fetches. What it knows of the pull request comes from its code and from Althar: its description, checks and comments.',
  },
  {
    id: 'posts',
    words: 'posts nothing until you do',
    means: 'It writes a review draft. Nothing reaches GitHub until you post it from the draft’s card.',
  },
] as const
