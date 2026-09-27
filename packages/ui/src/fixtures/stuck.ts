import { CODEX, GEMINI_PRO, OPUS, QWEN } from './models'

/* Task 419's Verify, stuck on one assertion after Charrette tried three ways round it. */
export const STUCK = {
  step: 'Verify',
  what: 'A reused idempotency key returns 200, not 409, on refunds created before PR 1184.',
  tried: [
    { what: 'Ran it again', result: 'failed the same way' },
    { what: 'Repaired the refund fixtures', result: 'regenerated them; still fails' },
    { what: 'Codex took the step', result: 'fails on the same assertion' },
  ],
  read: {
    by: OPUS,
    says: 'Refunds made before PR 1184 have no stored key, so the check never sees a reuse. That is the backfill in MER-231, which hasn’t run. Nothing in this task can fix it without writing to production data.',
  },
  output: {
    command: 'pnpm test refunds/idempotency',
    lines: [
      ' ✓ refunds/idempotency › returns 409 for a reused key (12 ms)',
      ' ✗ refunds/idempotency › returns 409 for a key reused on a pre-1184 refund',
      '   Expected status 409, received 200',
      '     at test/refunds/idempotency.test.ts:88:31',
      ' Tests: 1 failed, 23 passed, 24 total',
    ],
    exit: 1,
  },
  agents: [
    { model: GEMINI_PRO, note: 'Gemini CLI · API key, billed per token' },
    { model: QWEN, note: 'Ollama · this Mac, slower' },
    { model: CODEX, note: 'Tried already, on this step' },
  ],
}
