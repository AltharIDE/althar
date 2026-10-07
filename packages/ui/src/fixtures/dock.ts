import { CHECKS_PASSED, GITHUB, PR_416 } from './outputs'
import { GEMINI_PRO, OPUS, SONNET } from './models'

/* A call of yours and a change to accept, as the dock opens them from the board. */
export const CALL = {
  title: 'Queue or fail when a refund retry hits the rate limit?',
  because: 'Two defensible behaviours, and no convention in the project covers it.',
  detail:
    'When the upstream limiter returns 429 during a refund retry, the repair step found no convention for whether the refund should queue or fail visibly to the caller.',
  options: [
    {
      id: 'queue',
      label: 'Queue and retry with backoff',
      note: 'The caller sees pending. Matches webhook retries. Delays a failure by up to 40s.',
    },
    { id: 'fail', label: 'Fail fast to the caller', note: 'The caller retries. Consistent with the rest of the refunds API.' },
  ],
  evidence: [
    'Three call sites: refunds, disputes, partial capture',
    'No project note covers 429s on write paths',
    'Task 402 chose fail-fast for reads, in February',
  ],
  releases: 'Releases task 422',
}

const PR = PR_416[0] ?? { repo: '', number: 0, url: undefined, files: [] }
export const ACCEPT = {
  title: 'Return 409 when a refund idempotency key is reused',
  because: 'Every check passed. Nothing merges until you accept it.',
  repo: PR.repo,
  number: PR.number ?? 0,
  host: GITHUB,
  url: PR.url,
  lead: OPUS,
  reviewers: [SONNET, GEMINI_PRO],
  files: PR.files,
  checks: CHECKS_PASSED.slice(0, 3),
}
