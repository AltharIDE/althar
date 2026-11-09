import { Brand } from '../../foundations/brands/brands'
import type { SealFacts } from '../../seal/seal'
import type { PlanPreviewSample } from './PlanPreview'
import type { PullRequestPreviewSample } from './PullRequestPreview'

/*
 * The one task the previews show, where there is no real one to show: its
 * plan, its review and the pull request it opens. A consumer passes its own
 * words where it has a project's facts (its branch, its repository's
 * default, its tracker's key), and these where it has none.
 */

/** The review its seals say. */
export const TASK_PREVIEW_SEAL: SealFacts = { model: 'GPT-6.1 Sol', sha: '4e1c07a', passes: 2, date: '2026-10-31' }

/** The plan, as proposed; who runs each step is the consumer's to add, from its own models. */
export const PLAN_PREVIEW_SAMPLE: PlanPreviewSample = {
  task: 'DEV-212',
  title: 'Retry the checkout call with backoff',
  steps: [
    { id: 'build', label: 'Wrap the upstream call in a jittered retry' },
    { id: 'test', label: 'Test 502, 503 and a timeout' },
    { id: 'review', label: 'Review' },
  ],
}

/** The pull request it opens, and the branch it pushes. */
export const PULL_REQUEST_PREVIEW_SAMPLE: PullRequestPreviewSample = {
  title: 'Retry the checkout call with backoff',
  number: '#212',
  author: 'balazs',
  commits: 3,
  base: 'main',
  branch: 'althar/dev-212-retry-checkout',
  body: 'The checkout call failed the whole order on one dropped connection. It now retries with jittered backoff, three tries at most.',
  pushed: '2 minutes ago',
  issue: { key: 'DEV-212', tracker: Brand.Linear },
  facts: TASK_PREVIEW_SEAL,
}
